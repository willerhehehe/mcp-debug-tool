import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
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
import { InMemoryOAuthProvider } from "./oauth-provider.js";

type HttpConnectConfig = Extract<ConnectConfig, { transport: "http" }>;

interface PendingOAuth {
  config: HttpConnectConfig;
  provider: InMemoryOAuthProvider;
  transport: StreamableHTTPClientTransport;
  target: string;
}

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
  private pendingOAuth?: PendingOAuth;

  constructor(
    private readonly oauthCallbackUrl = "http://127.0.0.1:3333/oauth/callback",
    private readonly fetchImpl?: typeof fetch,
  ) {}

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

  async connect(config: ConnectConfig, existingOAuthProvider?: InMemoryOAuthProvider) {
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
    let httpTransport: StreamableHTTPClientTransport | undefined;
    let oauthProvider: InMemoryOAuthProvider | undefined;
    let authorizationUrl: URL | undefined;
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
      const hasManualAuthorization = headers.has("authorization");
      oauthProvider = hasManualAuthorization
        ? undefined
        : existingOAuthProvider ?? new InMemoryOAuthProvider(this.oauthCallbackUrl, () => undefined);
      oauthProvider?.setRedirectHandler((urlToOpen) => {
          authorizationUrl = urlToOpen;
          if (httpTransport && this.statusValue.connected) {
            this.pendingOAuth = { config, provider: oauthProvider!, transport: httpTransport, target };
            this.statusValue = {
              connected: false,
              transport: "http",
              target,
              auth: { state: "required", authorizationUrl: urlToOpen.toString() },
            };
            this.addLog({
              direction: "system",
              label: "oauth/authorization-required",
              payload: { target, authorizationServer: urlToOpen.origin, reason: "credentials expired" },
            });
          }
        });
      httpTransport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers },
        authProvider: oauthProvider,
        fetch: this.fetchImpl,
      });
      rawTransport = httpTransport;
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
      if (config.transport === "http" && httpTransport && oauthProvider && authorizationUrl && UnauthorizedError.isInstance(error)) {
        try {
          await client.close();
        } catch {
          // The failed handshake may already have closed the transport.
        }
        this.client = undefined;
        this.transport = undefined;
        this.pendingOAuth = { config, provider: oauthProvider, transport: httpTransport, target };
        this.statusValue = {
          connected: false,
          transport: "http",
          target,
          auth: { state: "required", authorizationUrl: authorizationUrl.toString() },
        };
        this.addLog({
          direction: "system",
          label: "oauth/authorization-required",
          payload: { target, authorizationServer: authorizationUrl.origin },
        });
        return { status: this.statusValue, catalog: this.catalogValue };
      }
      this.addLog({ direction: "system", label: "connection/failed", payload: errorMessage(error) });
      await this.disconnect();
      throw error;
    }
  }

  async completeOAuth(params: URLSearchParams) {
    const pending = this.pendingOAuth;
    if (!pending) throw new Error("No OAuth authorization is pending");
    if (!pending.provider.matchesState(params.get("state"))) {
      this.addLog({ direction: "system", label: "oauth/callback-rejected", payload: "State validation failed" });
      throw new Error("OAuth callback could not be verified");
    }

    this.statusValue = {
      connected: false,
      transport: "http",
      target: pending.target,
      auth: { state: "exchanging" },
    };
    this.addLog({ direction: "system", label: "oauth/callback", payload: { target: pending.target } });

    try {
      await pending.transport.finishAuth(params);
      this.addLog({ direction: "system", label: "oauth/token-ready", payload: { target: pending.target } });
      this.pendingOAuth = undefined;
      return await this.connect(pending.config, pending.provider);
    } catch (error) {
      this.pendingOAuth = undefined;
      this.statusValue = {
        connected: false,
        transport: "http",
        target: pending.target,
        auth: {
          state: "error",
          message: "OAuth authorization could not be completed. Start a new connection to retry.",
        },
      };
      this.addLog({ direction: "system", label: "oauth/failed", payload: safeOAuthError(error) });
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
    if (this.pendingOAuth) {
      try {
        await this.pendingOAuth.transport.close();
      } catch {
        // Best-effort cleanup of an interrupted authorization flow.
      }
    }
    this.pendingOAuth = undefined;
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

function safeOAuthError(error: unknown) {
  if (!error || typeof error !== "object") return "OAuth flow failed";
  const name = "name" in error && typeof error.name === "string" ? error.name : "OAuthError";
  return { name, message: "OAuth flow failed; sensitive callback details were not logged" };
}

function emptyCatalog(): Catalog {
  return { tools: [], resources: [], resourceTemplates: [], prompts: [], errors: {} };
}
