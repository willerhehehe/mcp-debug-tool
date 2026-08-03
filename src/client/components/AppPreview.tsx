import { useEffect, useRef, useState } from "react";
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import { ArrowSquareOut, ShieldCheck } from "@phosphor-icons/react";
import { api } from "../api";
import type { Catalog } from "../../shared/types";

interface AppPreviewProps {
  html: string;
  tool: Record<string, unknown>;
  toolArguments: Record<string, unknown>;
  toolResult: Record<string, unknown>;
  catalog: Catalog;
  onEvent: (label: string, payload: unknown) => void;
}

export function AppPreview({ html, tool, toolArguments, toolResult, catalog, onEvent }: AppPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [height, setHeight] = useState(560);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;

    let cancelled = false;
    const bridge = new AppBridge(
      null,
      { name: "mcp-debug-tool", version: "0.1.0" },
      { openLinks: {}, serverTools: {}, serverResources: {}, logging: {} },
      {
        hostContext: {
          theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
          displayMode: "inline",
          availableDisplayModes: ["inline"],
          containerDimensions: { width: iframe.clientWidth || 800, maxHeight: 720 },
          locale: navigator.language,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          platform: "web",
          toolInfo: { tool: tool as never },
        },
      },
    );

    bridge.oncalltool = async ({ name, arguments: args }) => {
      onEvent(`app tools/call ${name}`, args);
      return (await api.callTool(name, (args ?? {}) as Record<string, unknown>)) as never;
    };
    bridge.onreadresource = async ({ uri }) => {
      onEvent(`app resources/read ${uri}`, {});
      return (await api.readResource(uri)) as never;
    };
    bridge.onlistresources = async () => ({ resources: catalog.resources } as never);
    bridge.onlistresourcetemplates = async () => ({ resourceTemplates: catalog.resourceTemplates } as never);
    bridge.onopenlink = async ({ url }) => {
      if (window.confirm(`Open this external link?\n\n${url}`)) {
        window.open(url, "_blank", "noopener,noreferrer");
        return {};
      }
      return { isError: true };
    };
    bridge.onmessage = async (params) => {
      onEvent("app ui/message", params);
      return {};
    };
    bridge.onupdatemodelcontext = async (params) => {
      onEvent("app ui/update-model-context", params);
      return {};
    };
    bridge.addEventListener("sizechange", ({ height: nextHeight }) => {
      if (nextHeight) setHeight(Math.min(720, Math.max(240, nextHeight)));
    });
    bridge.addEventListener("loggingmessage", (params) => onEvent("app log", params));
    bridge.addEventListener("initialized", async () => {
      if (cancelled) return;
      setState("ready");
      await bridge.sendToolInput({ arguments: toolArguments });
      await bridge.sendToolResult(toolResult as never);
    });
    bridge.onerror = (error) => {
      setState("error");
      onEvent("app bridge/error", error.message);
    };

    const transport = new PostMessageTransport(iframe.contentWindow, iframe.contentWindow);
    void bridge.connect(transport).then(() => {
      if (!cancelled) iframe.srcdoc = html;
    });

    return () => {
      cancelled = true;
      void bridge.close();
    };
  }, [catalog, html, onEvent, tool, toolArguments, toolResult]);

  return (
    <div className="app-preview">
      <div className="preview-notice">
        <ShieldCheck size={15} weight="bold" />
        <span>Sandboxed preview. App tool calls are proxied through this local host.</span>
        <span className={`preview-state preview-state-${state}`}>{state}</span>
      </div>
      <iframe
        ref={iframeRef}
        title="MCP App preview"
        className="app-frame"
        style={{ height }}
        sandbox="allow-scripts allow-forms allow-popups allow-downloads"
      />
      <div className="preview-footnote">
        <ArrowSquareOut size={14} /> External links require confirmation
      </div>
    </div>
  );
}
