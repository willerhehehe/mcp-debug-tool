import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import open from "open";
import { McpConnection } from "./connection.js";
import type { ConnectConfig } from "../shared/types.js";

function parseCli(argv: string[]) {
  const options = { port: 3333, host: "127.0.0.1", open: true, dev: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port") options.port = Number(argv[++index]);
    else if (arg === "--host") options.host = argv[++index] ?? options.host;
    else if (arg === "--no-open") options.open = false;
    else if (arg === "--dev") {
      options.dev = true;
      options.port = 3334;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`mcp-debug-tool

Usage:
  npx mcp-debug-tool [--port 3333] [--host 127.0.0.1] [--no-open]

Options:
  --port <number>  UI server port (default: 3333)
  --host <host>    Bind address (default: 127.0.0.1)
  --no-open        Do not open the browser automatically
  -h, --help       Show this help`);
      process.exit(0);
    }
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error("--port must be a valid TCP port");
  }
  return options;
}

const options = parseCli(process.argv.slice(2));
const app = express();
const oauthCallbackUrl = `http://127.0.0.1:${options.port}/oauth/callback`;
const uiUrl = options.dev ? "http://127.0.0.1:5173" : `http://127.0.0.1:${options.port}`;
const connection = new McpConnection(oauthCallbackUrl);

app.disable("x-powered-by");
app.use(express.json({ limit: "4mb" }));

app.get("/api/health", (_request, response) => response.json({ ok: true }));
app.get("/api/status", (_request, response) => response.json(connection.status));
app.get("/api/catalog", (_request, response) => response.json(connection.catalog));
app.get("/api/logs", (request, response) => {
  const after = Number(request.query.after ?? 0);
  response.json({ logs: connection.logs(Number.isFinite(after) ? after : 0) });
});
app.delete("/api/logs", (_request, response) => {
  connection.clearLogs();
  response.status(204).end();
});

app.get("/oauth/callback", async (request, response) => {
  try {
    const callback = new URL(request.originalUrl, oauthCallbackUrl);
    const result = await connection.completeOAuth(callback.searchParams);
    if (!result.status.connected) throw new Error("The MCP server still requires authorization");
    response.status(200).type("html").send(oauthCallbackPage(true, uiUrl));
  } catch {
    response.status(400).type("html").send(oauthCallbackPage(false, uiUrl));
  }
});

app.post("/api/connect", async (request, response, next) => {
  try {
    response.json(await connection.connect(request.body as ConnectConfig));
  } catch (error) {
    next(error);
  }
});
app.post("/api/disconnect", async (_request, response, next) => {
  try {
    await connection.disconnect();
    response.json({ connected: false });
  } catch (error) {
    next(error);
  }
});
app.post("/api/catalog/refresh", async (_request, response, next) => {
  try {
    response.json(await connection.refreshCatalog());
  } catch (error) {
    next(error);
  }
});
app.post("/api/tools/:name/call", async (request, response, next) => {
  try {
    response.json(await connection.callTool(request.params.name, request.body?.arguments ?? {}));
  } catch (error) {
    next(error);
  }
});
app.post("/api/resources/read", async (request, response, next) => {
  try {
    response.json(await connection.readResource(String(request.body?.uri ?? "")));
  } catch (error) {
    next(error);
  }
});
app.post("/api/prompts/:name/get", async (request, response, next) => {
  try {
    response.json(await connection.getPrompt(request.params.name, request.body?.arguments));
  } catch (error) {
    next(error);
  }
});

if (!options.dev) {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const clientDir = join(currentDir, "client");
  if (!existsSync(join(clientDir, "index.html"))) {
    throw new Error(`UI build not found at ${clientDir}. Run npm run build first.`);
  }
  app.use(express.static(clientDir));
  app.use((_request, response) => response.sendFile(join(clientDir, "index.html")));
}

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  response.status(400).json({ error: message });
});

const server = app.listen(options.port, options.host, async () => {
  const url = `http://${options.host}:${options.port}`;
  console.log(`MCP Debug Tool running at ${url}`);
  if (options.open) await open(url);
});

async function shutdown() {
  await connection.disconnect();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function oauthCallbackPage(success: boolean, returnUrl: string) {
  const title = success ? "Authorization complete" : "Authorization failed";
  const message = success
    ? "The MCP server is connected. You can close this tab and return to MCP Debug Tool."
    : "The authorization response could not be verified. Return to MCP Debug Tool and start a new connection.";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
    <title>${title}</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #f4f5f1; color: #1a1d18; }
      main { width: min(420px, calc(100% - 40px)); padding: 28px; border: 1px solid #d9ddd4; border-radius: 12px; background: #fbfcf8; box-shadow: 0 14px 40px rgba(38,49,34,.09); }
      .mark { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 10px; color: white; background: ${success ? "#185f36" : "#a63a36"}; font-weight: 700; }
      h1 { margin: 20px 0 8px; font-size: 22px; }
      p { margin: 0; color: #667064; line-height: 1.55; }
      a { display: inline-block; margin-top: 22px; color: #185f36; font-weight: 650; }
    </style>
  </head>
  <body>
    <main>
      <div class="mark">${success ? "✓" : "!"}</div>
      <h1>${title}</h1>
      <p>${message}</p>
      <a href="${returnUrl}">Return to MCP Debug Tool</a>
    </main>
  </body>
</html>`;
}
