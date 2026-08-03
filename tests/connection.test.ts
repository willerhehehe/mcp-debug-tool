import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { McpConnection } from "../src/server/connection";

describe("McpConnection", () => {
  it("discovers and invokes a stdio MCP server", async () => {
    const connection = new McpConnection();
    const fixture = fileURLToPath(new URL("../fixtures/demo-server.mjs", import.meta.url));

    try {
      const connected = await connection.connect({
        transport: "stdio",
        command: process.execPath,
        args: [fixture],
      });

      expect(connected.status.connected).toBe(true);
      expect(connected.status.server?.name).toBe("debug-demo");
      expect(connected.catalog.tools.some((tool) => tool.name === "echo")).toBe(true);
      expect(connected.catalog.prompts.some((prompt) => prompt.name === "review")).toBe(true);

      const result = await connection.callTool("echo", { message: "hello" });
      expect(result.structuredContent).toEqual({ message: "hello" });

      const resource = await connection.readResource("ui://debug-demo/echo.html");
      expect(resource.contents[0]).toMatchObject({ mimeType: "text/html;profile=mcp-app" });
      expect(connection.logs().some((entry) => entry.label === "tools/call")).toBe(true);
    } finally {
      await connection.disconnect();
    }
  }, 15_000);
});
