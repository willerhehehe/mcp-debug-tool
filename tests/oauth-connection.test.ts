import { describe, expect, it } from "vitest";
import { McpConnection } from "../src/server/connection";

describe("McpConnection OAuth", () => {
  it("discovers OAuth, completes PKCE, and reconnects with the access token", async () => {
    const baseUrl = "https://auth.example";
    let tokenRequest = "";
    const fetchMock: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === "/.well-known/oauth-protected-resource/mcp" || url.pathname === "/.well-known/oauth-protected-resource") {
        return json(200, {
          resource: `${baseUrl}/mcp`,
          authorization_servers: [baseUrl],
          scopes_supported: ["mcp"],
        });
      }
      if (url.pathname.includes(".well-known/oauth-authorization-server") || url.pathname.includes(".well-known/openid-configuration")) {
        return json(200, {
          issuer: baseUrl,
          authorization_endpoint: `${baseUrl}/authorize`,
          token_endpoint: `${baseUrl}/token`,
          registration_endpoint: `${baseUrl}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
          scopes_supported: ["mcp"],
        });
      }
      if (url.pathname === "/register" && request.method === "POST") {
        const metadata = JSON.parse(await request.text()) as Record<string, unknown>;
        return json(201, { ...metadata, client_id: "debug-client", client_id_issued_at: Math.floor(Date.now() / 1000) });
      }
      if (url.pathname === "/token" && request.method === "POST") {
        tokenRequest = await request.text();
        return json(200, { access_token: "oauth-access-token", token_type: "Bearer", scope: "mcp" });
      }
      if (url.pathname === "/mcp" && request.method === "POST") {
        if (request.headers.get("authorization") !== "Bearer oauth-access-token") {
          return json(401, { error: "unauthorized" }, {
            "www-authenticate": `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource/mcp", scope="mcp"`,
          });
        }
        const message = JSON.parse(await request.text()) as { id?: string | number; method?: string };
        if (message.method === "notifications/initialized") return new Response(null, { status: 202 });
        if (message.method === "server/discover") {
          return json(200, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
        }
        if (message.method === "initialize") {
          return json(200, {
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: "2025-06-18",
              capabilities: { tools: {}, resources: {}, prompts: {} },
              serverInfo: { name: "oauth-test", version: "1.0.0" },
            },
          });
        }
        const resultByMethod: Record<string, Record<string, unknown>> = {
          "tools/list": { tools: [] },
          "resources/list": { resources: [] },
          "resources/templates/list": { resourceTemplates: [] },
          "prompts/list": { prompts: [] },
        };
        return json(200, { jsonrpc: "2.0", id: message.id, result: resultByMethod[message.method ?? ""] ?? {} });
      }
      return new Response(null, { status: 404 });
    };

    const connection = new McpConnection("http://127.0.0.1:3333/oauth/callback", fetchMock);
    const pending = await connection.connect({ transport: "http", url: `${baseUrl}/mcp` });
    expect(pending.status.auth?.state).toBe("required");
    const authorizationUrl = new URL(pending.status.auth?.authorizationUrl ?? "");
    expect(authorizationUrl.origin).toBe(baseUrl);
    expect(authorizationUrl.pathname).toBe("/authorize");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("resource")).toBe(`${baseUrl}/mcp`);

    const connected = await connection.completeOAuth(new URLSearchParams({
      code: "authorization-code",
      state: authorizationUrl.searchParams.get("state") ?? "",
    }));
    expect(connected.status.connected).toBe(true);
    expect(connected.status.server?.name).toBe("oauth-test");
    expect(tokenRequest).toContain("code_verifier=");
    expect(tokenRequest).toContain(`resource=${encodeURIComponent(`${baseUrl}/mcp`)}`);
    expect(connection.logs().some((entry) => entry.label === "oauth/token-ready")).toBe(true);
    await connection.disconnect();
  });
});

function json(status: number, value: unknown, headers?: HeadersInit) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
