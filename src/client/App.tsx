import {
  ArrowSquareOut,
  ArrowsClockwise,
  BracketsCurly,
  CaretDown,
  CaretRight,
  CirclesThreePlus,
  Code,
  Database,
  Globe,
  ListMagnifyingGlass,
  LockKeyOpen,
  Moon,
  Plugs,
  Power,
  Sun,
  TerminalWindow,
  Trash,
  Wrench,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { version as appVersion } from "../../package.json";
import { api } from "./api";
import { AppPreview } from "./components/AppPreview";
import { JsonView } from "./components/JsonView";
import { LogPayloadDetail } from "./components/LogPayloadDetail";
import { SchemaForm } from "./components/SchemaForm";
import { compactLogPayload } from "./logPayload";
import type { Catalog, ConnectConfig, ConnectionStatus, LogEntry } from "../shared/types";

type Kind = "tool" | "resource" | "prompt";
type Selection = { kind: Kind; item: Record<string, unknown> };
type OutputTab = "response" | "app" | "definition";

const emptyCatalog: Catalog = { tools: [], resources: [], resourceTemplates: [], prompts: [], errors: {} };
const DEFAULT_LOG_HEIGHT = 188;
const EXPANDED_LOG_HEIGHT = 360;
const MIN_LOG_HEIGHT = 96;

export default function App() {
  const [status, setStatus] = useState<ConnectionStatus>({ connected: false });
  const [catalog, setCatalog] = useState<Catalog>(emptyCatalog);
  const [selection, setSelection] = useState<Selection>();
  const [result, setResult] = useState<Record<string, unknown>>();
  const [toolArgs, setToolArgs] = useState<Record<string, unknown>>({});
  const [promptArgs, setPromptArgs] = useState<Record<string, string>>({});
  const [appHtml, setAppHtml] = useState<string>();
  const [outputTab, setOutputTab] = useState<OutputTab>("response");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsOpen, setLogsOpen] = useState(true);
  const [expandedLogId, setExpandedLogId] = useState<number>();
  const [logHeight, setLogHeight] = useState(DEFAULT_LOG_HEIGHT);
  const workbenchRef = useRef<HTMLElement>(null);
  const resizeCleanupRef = useRef<(() => void) | undefined>(undefined);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const maxLogHeight = useCallback(() => {
    const workbenchHeight = workbenchRef.current?.getBoundingClientRect().height ?? window.innerHeight - 58;
    return Math.max(MIN_LOG_HEIGHT, Math.min(window.innerHeight - 96, workbenchHeight - 96));
  }, []);

  const clampLogHeight = useCallback((height: number) =>
    Math.round(Math.min(Math.max(height, MIN_LOG_HEIGHT), maxLogHeight())), [maxLogHeight]);

  const resizeLogBy = useCallback((delta: number) => {
    setLogHeight((height) => clampLogHeight(height + delta));
  }, [clampLogHeight]);

  const resetLogHeight = useCallback(() => {
    setLogHeight(clampLogHeight(expandedLogId === undefined ? DEFAULT_LOG_HEIGHT : EXPANDED_LOG_HEIGHT));
  }, [clampLogHeight, expandedLogId]);

  const startLogResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizeCleanupRef.current?.();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startY = event.clientY;
    const startHeight = logHeight;
    handle.setPointerCapture(pointerId);
    document.body.classList.add("resizing-log-panel");

    const onMove = (moveEvent: PointerEvent) => {
      setLogHeight(clampLogHeight(startHeight + startY - moveEvent.clientY));
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      document.body.classList.remove("resizing-log-panel");
      if (resizeCleanupRef.current === cleanup) resizeCleanupRef.current = undefined;
    };

    resizeCleanupRef.current = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  }, [clampLogHeight, logHeight]);

  useEffect(() => {
    const onResize = () => setLogHeight((height) => clampLogHeight(height));
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      resizeCleanupRef.current?.();
    };
  }, [clampLogHeight]);

  useEffect(() => {
    void api.status().then(async (current) => {
      setStatus(current);
      if (current.connected) setCatalog(await api.catalog());
    });
  }, []);

  useEffect(() => {
    if (!status.connected && (!status.auth || status.auth.state === "error")) return;
    let active = true;
    const poll = async () => {
      try {
        const current = await api.status();
        if (!active) return;
        const becameConnected = !status.connected && current.connected;
        setStatus(current);
        if (becameConnected) {
          setCatalog(await api.catalog());
          setSelection(undefined);
          setResult(undefined);
          setAppHtml(undefined);
          setError(undefined);
        }
      } catch {
        // The local server may be restarting.
      }
    };
    const timer = window.setInterval(poll, 800);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [status.connected, status.auth?.state, status.auth?.authorizationUrl]);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      const after = logs.at(-1)?.id ?? 0;
      try {
        const response = await api.logs(after);
        if (active && response.logs.length) setLogs((current) => [...current, ...response.logs].slice(-500));
      } catch { /* server may be restarting */ }
    };
    const timer = window.setInterval(poll, 700);
    void poll();
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [logs]);

  const connect = async (config: ConnectConfig) => {
    setBusy(true);
    setError(undefined);
    try {
      const response = await api.connect(config);
      setStatus(response.status);
      setCatalog(response.catalog);
      setSelection(undefined);
      setResult(undefined);
      setAppHtml(undefined);
    } catch (nextError) {
      setError(errorText(nextError));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    await api.disconnect();
    setStatus({ connected: false });
    setCatalog(emptyCatalog);
    setSelection(undefined);
    setBusy(false);
  };

  const refresh = async () => {
    setBusy(true);
    setError(undefined);
    try { setCatalog(await api.refreshCatalog()); }
    catch (nextError) { setError(errorText(nextError)); }
    finally { setBusy(false); }
  };

  const select = (kind: Kind, item: Record<string, unknown>) => {
    setSelection({ kind, item });
    setResult(undefined);
    setAppHtml(undefined);
    setOutputTab("response");
    if (kind === "tool") setToolArgs(defaultArguments(item.inputSchema));
    if (kind === "prompt") setPromptArgs({});
  };

  const execute = async () => {
    if (!selection) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    setAppHtml(undefined);
    try {
      if (selection.kind === "tool") {
        const next = await api.callTool(String(selection.item.name), toolArgs);
        setResult(next);
        const uiUri = toolUiUri(selection.item);
        if (uiUri) {
          const resource = await api.readResource(uiUri);
          const html = resourceText(resource);
          if (!html) throw new Error(`UI resource ${uiUri} did not return HTML text`);
          setAppHtml(html);
          setOutputTab("app");
        }
      } else if (selection.kind === "resource") {
        setResult(await api.readResource(String(selection.item.uri)));
      } else {
        setResult(await api.getPrompt(String(selection.item.name), promptArgs));
      }
    } catch (nextError) {
      setError(errorText(nextError));
    } finally {
      setBusy(false);
    }
  };

  const appEvent = useCallback((label: string, payload: unknown) => {
    setLogs((current) => [...current, {
      id: Date.now(), at: new Date().toISOString(), direction: "system" as const, label, payload,
    }].slice(-500));
  }, []);

  const title = selection ? String(selection.item.title || selection.item.name || selection.item.uri) : "Select a capability";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><CirclesThreePlus size={19} weight="fill" /></div>
          <span>MCP Debug Tool</span>
          <code className="version-badge">v{appVersion}</code>
        </div>
        <div className="top-actions">
          {status.connected && (
            <div className="connection-chip" title={status.target}>
              <span className="status-dot" />
              <span>{status.server?.name || "Connected"}</span>
              {status.server?.version && <code>{status.server.version}</code>}
            </div>
          )}
          <button className="icon-button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle theme">
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          {status.connected && <button className="button subtle danger" onClick={disconnect} disabled={busy}><Power size={15} />Disconnect</button>}
        </div>
      </header>

      {!status.connected ? (
        <ConnectScreen onConnect={connect} busy={busy} error={error} status={status} />
      ) : (
        <main
          ref={workbenchRef}
          className={`workbench ${logsOpen ? (expandedLogId !== undefined ? "with-log-detail" : "with-logs") : ""}`}
          style={{ "--log-panel-height": `${logHeight}px` } as CSSProperties}
        >
          <aside className="sidebar">
            <div className="sidebar-head">
              <div>
                <span>Capabilities</span>
                <small>{catalog.tools.length + catalog.resources.length + catalog.prompts.length} discovered</small>
              </div>
              <button className="icon-button" onClick={refresh} disabled={busy} aria-label="Refresh capabilities"><ArrowsClockwise size={16} /></button>
            </div>
            <CapabilityGroup title="Tools" icon={<Wrench size={15} />} items={catalog.tools} kind="tool" selection={selection} onSelect={select} error={catalog.errors.tools} />
            <CapabilityGroup title="Resources" icon={<Database size={15} />} items={catalog.resources} kind="resource" selection={selection} onSelect={select} error={catalog.errors.resources} />
            <CapabilityGroup title="Prompts" icon={<ListMagnifyingGlass size={15} />} items={catalog.prompts} kind="prompt" selection={selection} onSelect={select} error={catalog.errors.prompts} />
          </aside>

          <section className="workspace">
            <div className="workspace-head">
              <div className="breadcrumb"><span>{selection?.kind || "workspace"}</span><CaretRight size={12} /><strong>{title}</strong></div>
              {selection && <button className="button primary" onClick={execute} disabled={busy}>{busy ? "Running..." : selection.kind === "tool" ? "Call tool" : selection.kind === "resource" ? "Read resource" : "Get prompt"}</button>}
            </div>

            {!selection ? (
              <div className="workspace-empty">
                <BracketsCurly size={32} />
                <h1>Pick something to inspect</h1>
                <p>Choose a tool, resource, or prompt from the capability list.</p>
              </div>
            ) : (
              <div className="inspector-grid">
                <section className="request-pane">
                  <PaneHeading title="Request" subtitle={selection.kind === "tool" ? "Arguments generated from inputSchema" : "Configure the request"} />
                  {selection.kind === "tool" && (
                    <SchemaForm schema={selection.item.inputSchema as never} value={toolArgs} onChange={setToolArgs} />
                  )}
                  {selection.kind === "resource" && <JsonView value={{ uri: selection.item.uri }} />}
                  {selection.kind === "prompt" && (
                    <PromptFields prompt={selection.item} value={promptArgs} onChange={setPromptArgs} />
                  )}
                  {error && <div className="error-box"><strong>Request failed</strong><span>{error}</span></div>}
                </section>

                <section className="output-pane">
                  <div className="output-tabs" role="tablist">
                    <Tab active={outputTab === "response"} onClick={() => setOutputTab("response")}>Response</Tab>
                    {toolUiUri(selection.item) && <Tab active={outputTab === "app"} onClick={() => setOutputTab("app")}><Globe size={14} />App</Tab>}
                    <Tab active={outputTab === "definition"} onClick={() => setOutputTab("definition")}><Code size={14} />Definition</Tab>
                  </div>
                  <div className="output-content">
                    {outputTab === "response" && <JsonView value={result} />}
                    {outputTab === "definition" && <JsonView value={selection.item} />}
                    {outputTab === "app" && (
                      appHtml && result ? (
                        <AppPreview html={appHtml} tool={selection.item} toolArguments={toolArgs} toolResult={result} catalog={catalog} onEvent={appEvent} />
                      ) : (
                        <div className="empty-inline">Call the tool to load its MCP App resource.</div>
                      )
                    )}
                  </div>
                </section>
              </div>
            )}
          </section>

          <LogPanel
            logs={logs}
            open={logsOpen}
            expandedLogId={expandedLogId}
            height={logHeight}
            maxHeight={maxLogHeight()}
            onToggle={() => setLogsOpen(!logsOpen)}
            onExpand={(id) => {
              const nextId = expandedLogId === id ? undefined : id;
              setExpandedLogId(nextId);
              if (nextId !== undefined) setLogHeight((height) => clampLogHeight(Math.max(height, EXPANDED_LOG_HEIGHT)));
            }}
            onResizeStart={startLogResize}
            onResizeBy={resizeLogBy}
            onResizeReset={resetLogHeight}
            onClear={async () => { await api.clearLogs(); setLogs([]); setExpandedLogId(undefined); }}
          />
        </main>
      )}
    </div>
  );
}

function ConnectScreen({ onConnect, busy, error, status }: {
  onConnect: (config: ConnectConfig) => void;
  busy: boolean;
  error?: string;
  status: ConnectionStatus;
}) {
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("npx");
  const [args, setArgs] = useState('["-y", "@modelcontextprotocol/server-everything"]');
  const [cwd, setCwd] = useState("");
  const [env, setEnv] = useState("{}");
  const [url, setUrl] = useState("http://127.0.0.1:3000/mcp");
  const [token, setToken] = useState("");
  const [headers, setHeaders] = useState("{}");
  const [formError, setFormError] = useState<string>();

  useEffect(() => {
    if (status.transport !== "http" || !status.target) return;
    setTransport("http");
    setUrl(status.target);
  }, [status.transport, status.target]);

  const submit = () => {
    setFormError(undefined);
    try {
      if (transport === "stdio") {
        onConnect({ transport, command, args: parseArray(args, "Arguments"), cwd: cwd || undefined, env: parseObject(env, "Environment") as Record<string, string> });
      } else {
        onConnect({ transport, url, bearerToken: token || undefined, headers: parseObject(headers, "Headers") as Record<string, string> });
      }
    } catch (nextError) {
      setFormError(errorText(nextError));
    }
  };

  const authorize = () => {
    if (!status.auth?.authorizationUrl) return;
    window.open(status.auth.authorizationUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <main className="connect-page">
      <section className="connect-copy">
        <div className="connect-glyph"><Plugs size={28} weight="duotone" /></div>
        <h1>Inspect an MCP server in seconds.</h1>
        <p>Connect, discover capabilities, call tools, read resources, and render MCP Apps from one local workbench.</p>
        <div className="feature-line"><TerminalWindow size={17} /><span>stdio process capture</span></div>
        <div className="feature-line"><Globe size={17} /><span>Streamable HTTP, OAuth, and bearer tokens</span></div>
        <div className="feature-line"><BracketsCurly size={17} /><span>Schema-driven requests and protocol logs</span></div>
      </section>
      <section className="connect-card">
        <div className="segmented">
          <button className={transport === "stdio" ? "active" : ""} onClick={() => setTransport("stdio")}><TerminalWindow size={16} />stdio</button>
          <button className={transport === "http" ? "active" : ""} onClick={() => setTransport("http")}><Globe size={16} />HTTP</button>
        </div>
        {transport === "stdio" ? (
          <div className="form-stack">
            <Field label="Command" helper="Executable used to launch the MCP server"><input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="npx" /></Field>
            <Field label="Arguments" helper="JSON string array"><textarea rows={3} value={args} onChange={(event) => setArgs(event.target.value)} /></Field>
            <Field label="Working directory" helper="Optional absolute path"><input value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="/path/to/server" /></Field>
            <Field label="Environment" helper="Optional JSON object. PATH is inherited safely."><textarea rows={3} value={env} onChange={(event) => setEnv(event.target.value)} /></Field>
          </div>
        ) : (
          <div className="form-stack">
            <Field label="Server URL" helper="Streamable HTTP endpoint"><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="http://127.0.0.1:3000/mcp" /></Field>
            <Field label="Bearer token" helper="Optional override. Leave empty for automatic OAuth discovery."><input type="password" value={token} onChange={(event) => setToken(event.target.value)} /></Field>
            <Field label="Headers" helper="Optional JSON object"><textarea rows={3} value={headers} onChange={(event) => setHeaders(event.target.value)} /></Field>
          </div>
        )}
        {status.auth?.state === "required" && status.auth.authorizationUrl && (
          <div className="oauth-box">
            <div className="oauth-copy">
              <LockKeyOpen size={17} />
              <div><strong>Authorization required</strong><span>Sign in with the server's authorization provider. Tokens stay in this process.</span></div>
            </div>
            <button className="button primary oauth-button" onClick={authorize}><ArrowSquareOut size={15} />Authorize in browser</button>
          </div>
        )}
        {status.auth?.state === "exchanging" && (
          <div className="oauth-box waiting">
            <div className="oauth-copy"><LockKeyOpen size={17} /><div><strong>Completing authorization</strong><span>Exchanging the authorization code and reconnecting to the MCP server.</span></div></div>
          </div>
        )}
        {status.auth?.state === "error" && <div className="error-box"><strong>Authorization failed</strong><span>{status.auth.message}</span></div>}
        {(formError || error) && <div className="error-box"><strong>Connection failed</strong><span>{formError || error}</span></div>}
        <button className="button primary connect-button" onClick={submit} disabled={busy || status.auth?.state === "exchanging"}>{busy ? "Connecting..." : status.auth?.state === "required" ? "Restart connection" : "Connect server"}</button>
        <p className="local-note">Runs locally on 127.0.0.1. Credentials stay in the current process.</p>
      </section>
    </main>
  );
}

function CapabilityGroup({ title, icon, items, kind, selection, onSelect, error }: {
  title: string; icon: React.ReactNode; items: Array<Record<string, unknown>>; kind: Kind; selection?: Selection;
  onSelect: (kind: Kind, item: Record<string, unknown>) => void; error?: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="capability-group">
      <button className="group-title" onClick={() => setOpen(!open)}>{open ? <CaretDown size={12} /> : <CaretRight size={12} />}{icon}<span>{title}</span><code>{items.length}</code></button>
      {open && <div className="capability-list">
        {items.map((item) => {
          const key = String(item.name || item.uri);
          const active = selection?.kind === kind && String(selection.item.name || selection.item.uri) === key;
          return <button key={key} className={active ? "active" : ""} onClick={() => onSelect(kind, item)}><span>{String(item.title || item.name || item.uri)}</span>{kind === "tool" && toolUiUri(item) && <Globe size={12} />}</button>;
        })}
        {!items.length && <span className="group-empty">{error ? "Unavailable" : "None exposed"}</span>}
      </div>}
    </div>
  );
}

function LogPanel({ logs, open, expandedLogId, height, maxHeight, onToggle, onExpand, onResizeStart, onResizeBy, onResizeReset, onClear }: {
  logs: LogEntry[];
  open: boolean;
  expandedLogId?: number;
  height: number;
  maxHeight: number;
  onToggle: () => void;
  onExpand: (id: number) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeBy: (delta: number) => void;
  onResizeReset: () => void;
  onClear: () => void;
}) {
  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 24;
    if (event.key === "ArrowUp") onResizeBy(step);
    else if (event.key === "ArrowDown") onResizeBy(-step);
    else if (event.key === "Home") onResizeReset();
    else return;
    event.preventDefault();
  };

  return (
    <section className={`log-panel ${open ? "open" : ""} ${expandedLogId !== undefined ? "with-detail" : ""}`}>
      {open && <div
        className="log-resize-handle"
        role="separator"
        aria-label="Resize protocol log"
        aria-orientation="horizontal"
        aria-valuemin={MIN_LOG_HEIGHT}
        aria-valuemax={Math.round(maxHeight)}
        aria-valuenow={Math.round(height)}
        tabIndex={0}
        title="Drag to resize"
        onPointerDown={onResizeStart}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={resizeWithKeyboard}
      />}
      <div className="log-heading">
        <TerminalWindow size={15} />
        <span>Protocol log</span>
        <code>{logs.length}</code>
        <button className="log-toggle" onClick={onToggle} aria-label={open ? "Collapse protocol log" : "Expand protocol log"}>
          {open ? <CaretDown size={13} /> : <CaretRight size={13} />}
        </button>
      </div>
      {open && <>
        <button className="icon-button log-clear" onClick={onClear} aria-label="Clear logs"><Trash size={14} /></button>
        <div className="log-list">
          {logs.map((entry) => {
            const expanded = expandedLogId === entry.id;
            return (
              <div className={`log-entry ${expanded ? "expanded" : ""}`} key={`${entry.id}-${entry.at}`}>
                <button className="log-row" onClick={() => onExpand(entry.id)} aria-expanded={expanded} aria-label={`${entry.label} log details`}>
                  <span className="log-row-caret">{expanded ? "▾" : "▸"}</span>
                  <time>{new Date(entry.at).toLocaleTimeString([], { hour12: false })}</time>
                  <span className={`direction ${entry.direction}`}>{entry.direction}</span>
                  <strong>{entry.label}</strong>
                  <code>{compactLogPayload(entry.payload)}</code>
                </button>
                {expanded && <LogPayloadDetail payload={entry.payload} />}
              </div>
            );
          })}
          {!logs.length && <div className="group-empty">No protocol traffic yet</div>}
        </div>
      </>}
    </section>
  );
}

function PaneHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return <div className="pane-heading"><h2>{title}</h2><p>{subtitle}</p></div>;
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button role="tab" aria-selected={active} className={active ? "active" : ""} onClick={onClick}>{children}</button>;
}

function Field({ label, helper, children }: { label: string; helper: string; children: React.ReactNode }) {
  return <label className="field-block"><span>{label}</span><p>{helper}</p>{children}</label>;
}

function PromptFields({ prompt, value, onChange }: { prompt: Record<string, unknown>; value: Record<string, string>; onChange: (value: Record<string, string>) => void }) {
  const args = Array.isArray(prompt.arguments) ? prompt.arguments as Array<Record<string, unknown>> : [];
  if (!args.length) return <div className="empty-inline compact">This prompt accepts no arguments.</div>;
  return <div className="schema-form">{args.map((arg) => <Field key={String(arg.name)} label={String(arg.name)} helper={String(arg.description || (arg.required ? "Required" : "Optional"))}><input value={value[String(arg.name)] ?? ""} onChange={(event) => onChange({ ...value, [String(arg.name)]: event.target.value })} /></Field>)}</div>;
}

function toolUiUri(tool: Record<string, unknown>) {
  const meta = tool._meta as Record<string, unknown> | undefined;
  const ui = meta?.ui as Record<string, unknown> | undefined;
  const uri = ui?.resourceUri ?? meta?.["ui/resourceUri"];
  return typeof uri === "string" && uri.startsWith("ui://") ? uri : undefined;
}

function resourceText(resource: Record<string, unknown>) {
  const contents = Array.isArray(resource.contents) ? resource.contents as Array<Record<string, unknown>> : [];
  const content = contents.find((item) => typeof item.text === "string" && String(item.mimeType || "").includes("html")) ?? contents.find((item) => typeof item.text === "string");
  return typeof content?.text === "string" ? content.text : undefined;
}

function defaultArguments(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return {};
  const properties = (schema as { properties?: Record<string, { default?: unknown }> }).properties ?? {};
  return Object.fromEntries(Object.entries(properties).filter(([, field]) => field.default !== undefined).map(([name, field]) => [name, field.default]));
}

function parseArray(value: string, label: string) {
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) throw new Error(`${label} must be a JSON string array`);
  return parsed as string[];
}

function parseObject(value: string, label: string) {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object`);
  return parsed as Record<string, unknown>;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
