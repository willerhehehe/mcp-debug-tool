import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

const server = new McpServer({ name: "debug-demo", version: "1.0.0" });
const appUri = "ui://debug-demo/echo.html";

registerAppTool(server, "echo", {
  title: "Echo with UI",
  description: "Return the submitted message and expose a small MCP App.",
  inputSchema: { message: z.string().describe("Text to echo") },
  _meta: { ui: { resourceUri: appUri } },
}, async ({ message }) => ({
  content: [{ type: "text", text: message }],
  structuredContent: { message },
}));

registerAppResource(server, "Echo UI", appUri, {}, async () => ({
  contents: [{
    uri: appUri,
    mimeType: RESOURCE_MIME_TYPE,
    text: `<!doctype html>
      <html>
        <body style="margin:0;padding:24px;font:14px system-ui;background:#f7f8f5;color:#1a1d18">
          <main>
            <small style="color:#647064">MCP App preview</small>
            <h1 style="margin:8px 0 12px">Echo App</h1>
            <pre id="value" style="padding:12px;border:1px solid #d9ddd4;border-radius:8px;background:white">Waiting for tool result...</pre>
          </main>
          <script>
            const value = document.getElementById("value");
            addEventListener("message", (event) => {
              const message = event.data;
              if (message?.id === 1 && message?.result) {
                parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/initialized" }, "*");
              }
              if (message?.method === "ui/notifications/tool-result") {
                value.textContent = JSON.stringify(message.params.structuredContent, null, 2);
              }
            });
            parent.postMessage({
              jsonrpc: "2.0",
              id: 1,
              method: "ui/initialize",
              params: {
                appInfo: { name: "echo-app", version: "1.0.0" },
                appCapabilities: {},
                protocolVersion: "2026-01-26"
              }
            }, "*");
          </script>
        </body>
      </html>`,
  }],
}));

server.registerPrompt("review", {
  description: "Create a review prompt",
  argsSchema: { subject: z.string() },
}, async ({ subject }) => ({
  messages: [{ role: "user", content: { type: "text", text: `Review ${subject}` } }],
}));

await server.connect(new StdioServerTransport());
