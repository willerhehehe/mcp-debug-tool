# MCP Debug Tool

A local browser workbench for quickly testing MCP servers and MCP Apps.

## Start

```bash
npx mcp-debug-tool
```

The command starts a local server at `http://127.0.0.1:3333` and opens it in your browser. Use `--no-open` in terminals or CI:

```bash
npx mcp-debug-tool --no-open --port 3333
```

Node.js 20 or newer is required.

## What it supports

- stdio servers launched from a command, arguments, working directory, and environment
- Streamable HTTP servers with custom headers or a bearer token
- Tools, Resources, Resource Templates, and Prompts discovery
- Schema-driven tool argument forms
- Tool calls, resource reads, and prompt retrieval
- MCP JSON-RPC traffic and server stderr logs with expandable tree and raw payload views
- MCP App discovery through `_meta.ui.resourceUri`
- Sandboxed MCP App preview with Host Bridge support for tool calls, resource reads, host context, sizing, messages, and model-context updates
- Light and dark themes, responsive layout, and full request error states

## Examples

For a local Node MCP server:

```text
Transport: stdio
Command:   node
Arguments: ["dist/server.js"]
```

For an npm-distributed MCP server:

```text
Transport: stdio
Command:   npx
Arguments: ["-y", "@modelcontextprotocol/server-everything"]
```

For Streamable HTTP:

```text
Transport: HTTP
Server URL: http://127.0.0.1:3000/mcp
```

## Local development

```bash
npm install
npm run dev
```

The UI runs at `http://127.0.0.1:5173` and proxies API calls to `http://127.0.0.1:3334`.

Run all checks:

```bash
npm run check
```

Build and inspect the publish package:

```bash
npm run build
npm pack --dry-run
```

## Release

Releases are published to npm by GitHub Actions when a version tag is pushed. The tag must exactly match the version in `package.json` and use the `v<version>` format.

For the next patch release:

```bash
npm version patch
git push origin main --follow-tags
```

The `Publish to npm` workflow runs the full check and build, then publishes through npm Trusted Publishing with short-lived OIDC credentials. No `NPM_TOKEN` repository secret is required.

## Security notes

- The server binds to `127.0.0.1` by default.
- Bearer tokens remain in process memory and are not written to disk.
- MCP App content runs in a sandboxed iframe without same-origin access.
- External links requested by an MCP App require confirmation.
- The tool intentionally starts local commands and connects to URLs you provide. Treat untrusted MCP servers like untrusted code.

## Current MVP boundaries

- OAuth browser authorization is not implemented yet. Use a bearer token or custom header.
- Legacy HTTP plus SSE fallback is not implemented yet.
- MCP App sampling and file download host capabilities are not advertised.
- The MCP App preview uses a direct sandboxed iframe. A hardened double-iframe sandbox proxy is planned before calling the host implementation specification-complete.
