import {
  Client,
  StreamableHTTPClientTransport,
  type JSONRPCMessage,
  type Transport,
  type TransportSendOptions,
} from "@modelcontextprotocol/client";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/client/stdio";
import type {
  Catalog,
  ConnectConfig,
  ConnectionStatus,
  LogEntry,
} from "../shared/types.js";

type MessageHandler = Transport["onmessage"];

class LoggingTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: MessageHandler;

  constructor(
    private readonly inner: Transport,
    private readonly log: (entry: Omit<LogEntry, "id" | "at">) => void,
  ) {
    inner.onclose = () => this.onclose?.();
    inner.onerror = (error) => {
      this.log({ direction: "system", label: "transport/error", payload: error.message });
      this.onerror?.(error);
    };
    inner.onmessage = (message, extra) => {
      this.log({ direction: "in", label: messageLabel(message), payload: message });
      this.onmessage?.(message, extra);
    };
  }

  get sessionId() {
    return this.inner.sessionId;
  }

  set sessionId(value: string | undefined) {
    this.inner.sessionId = value;
  }

  start() {
    return this.inner.start();
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions) {
    this.log({ direction: "out", label: messageLabel(message), payload: message });
    await this.inner.send(message, options);
  }

  close() {
    return this.inner.close();
  }

  setProtocolVersion(version: string) {
    this.inner.setProtocolVersion?.(version);
  }
}

function messageLabel(message: JSONRPCMessage | JSONRPCMessage[]) {
  if (Array.isArray(message)) return `batch (${message.length})`;
  if ("method" in message) return message.method;
  if ("error" in message) return `error #${String(message.id)}`;
  return `result #${String(message.id)}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function cleanRecord(value: Record<string, unknown> | undefined) {
  if (!value) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

export class McpConnection {
  private client?: Client;
  private transport?: Transport;
  private stdioTransport?: StdioClientTransport;
  private statusValue: ConnectionStatus = { connected: false };
  private logsValue: LogEntry[] = [];
  private nextLogId = 1;
  private catalogValue: Catalog = emptyCatalog();

  get status() {
    return this.statusValue;
  }

  get catalog() {
    return this.catalogValue;
  }

  logs(after = 0) {
    return this.logsValue.filter((entry) => entry.id > after);
  }

  clearLogs() {
    this.logsValue = [];
  }

  private addLog(entry: Omit<LogEntry, "id" | "at">) {
    this.logsValue.push({ ...entry, id: this.nextLogId++, at: new Date().toISOString() });
    if (this.logsValue.length > 500) this.logsValue.splice(0, this.logsValue.length - 500);
  }

  async connect(config: ConnectConfig) {
    await this.disconnect();
    this.catalogValue = emptyCatalog();

    const client = new Client(
      { name: "mcp-debug-tool", version: "0.1.0" },
      {
        capabilities: {
          extensions: {
            "io.modelcontextprotocol/ui": {
              mimeTypes: ["text/html;profile=mcp-app"],
            },
          },
        },
        versionNegotiation: { mode: "auto", probe: { timeoutMs: 1800 } },
      },
    );

    let rawTransport: Transport;
    let target: string;
    if (config.transport === "stdio") {
      if (!config.command.trim()) throw new Error("Command is required");
      const stdio = new StdioClientTransport({
        command: config.command.trim(),
        args: config.args ?? [],
        cwd: config.cwd?.trim() || undefined,
        env: {
          ...getDefaultEnvironment(),
          ...cleanRecord(config.env),
        },
        stderr: "pipe",
      });
      stdio.stderr?.on("data", (chunk) => {
        this.addLog({ direction: "stderr", label: "server/stderr", payload: String(chunk).trimEnd() });
      });
      this.stdioTransport = stdio;
      rawTransport = stdio;
      target = [config.command, ...(config.args ?? [])].join(" ");
    } else {
      const url = new URL(config.url);
      if (!/^https?:$/.test(url.protocol)) throw new Error("Only http:// and https:// URLs are supported");
      const headers = new Headers(cleanRecord(config.headers));
      if (config.bearerToken?.trim()) headers.set("authorization", `Bearer ${config.bearerToken.trim()}`);
      rawTransport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers },
      });
      target = url.toString();
    }

    const transport = new LoggingTransport(rawTransport, (entry) => this.addLog(entry));
    this.client = client;
    this.transport = transport;
    this.addLog({ direction: "system", label: "connection/start", payload: { transport: config.transport, target } });

    try {
      await client.connect(transport);
      const server = client.getServerVersion();
      this.statusValue = {
        connected: true,
        transport: config.transport,
        server: server ? { name: server.name, version: server.version } : undefined,
        capabilities: client.getServerCapabilities() as Record<string, unknown> | undefined,
        pid: this.stdioTransport?.pid,
        connectedAt: new Date().toISOString(),
        target,
      };
      this.addLog({ direction: "system", label: "connection/ready", payload: this.statusValue });
      await this.refreshCatalog();
      return { status: this.statusValue, catalog: this.catalogValue };
    } catch (error) {
      this.addLog({ direction: "system", label: "connection/failed", payload: errorMessage(error) });
      await this.disconnect();
      throw error;
    }
  }

  async disconnect() {
    if (this.client || this.transport) {
      try {
        await this.client?.close();
      } catch (error) {
        this.addLog({ direction: "system", label: "connection/close-error", payload: errorMessage(error) });
      }
    }
    this.client = undefined;
    this.transport = undefined;
    this.stdioTransport = undefined;
    this.statusValue = { connected: false };
  }

  requireClient() {
    if (!this.client || !this.statusValue.connected) throw new Error("No MCP server is connected");
    return this.client;
  }

  async refreshCatalog() {
    const client = this.requireClient();
    const next = emptyCatalog();

    const attempts = await Promise.allSettled([
      client.listTools(),
      client.listResources(),
      client.listResourceTemplates(),
      client.listPrompts(),
    ]);
    const keys = ["tools", "resources", "resourceTemplates", "prompts"] as const;
    attempts.forEach((attempt, index) => {
      const key = keys[index];
      if (attempt.status === "fulfilled") {
        next[key] = (attempt.value[key] ?? []) as Array<Record<string, unknown>>;
      } else {
        next.errors[key] = errorMessage(attempt.reason);
      }
    });
    this.catalogValue = next;
    return next;
  }

  callTool(name: string, args: Record<string, unknown>) {
    return this.requireClient().callTool({ name, arguments: args });
  }

  readResource(uri: string) {
    return this.requireClient().readResource({ uri });
  }

  getPrompt(name: string, args?: Record<string, string>) {
    return this.requireClient().getPrompt({ name, arguments: args });
  }
}

function emptyCatalog(): Catalog {
  return { tools: [], resources: [], resourceTemplates: [], prompts: [], errors: {} };
}
