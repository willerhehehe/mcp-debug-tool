import { BracketsCurly, Check, Copy, TreeStructure } from "@phosphor-icons/react";
import { useState } from "react";
import { normalizeLogPayload, stringifyLogPayload } from "../logPayload";

export function LogPayloadDetail({ payload }: { payload: unknown }) {
  const [view, setView] = useState<"tree" | "raw">("tree");
  const [copied, setCopied] = useState(false);
  const normalized = normalizeLogPayload(payload);
  const text = stringifyLogPayload(payload);
  const canUseTree = normalized !== undefined;

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="log-detail" onClick={(event) => event.stopPropagation()}>
      <div className="log-detail-toolbar">
        <div className="log-view-tabs" role="tablist" aria-label="Log payload view">
          <button role="tab" aria-selected={view === "tree"} className={view === "tree" ? "active" : ""} onClick={() => setView("tree")} disabled={!canUseTree}>
            <TreeStructure size={13} /> Tree
          </button>
          <button role="tab" aria-selected={view === "raw"} className={view === "raw" ? "active" : ""} onClick={() => setView("raw")}>
            <BracketsCurly size={13} /> Raw
          </button>
        </div>
        <button className="log-copy-button" onClick={copy} disabled={!text}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy full payload"}
        </button>
      </div>
      {view === "tree" ? (
        <div className="json-tree" role="tree" aria-label="JSON payload">
          <JsonTreeNode name="payload" value={normalized} depth={0} />
        </div>
      ) : (
        <pre className="log-raw">{text || "No payload"}</pre>
      )}
    </div>
  );
}

function JsonTreeNode({ name, value, depth }: { name: string; value: unknown; depth: number }) {
  const expandable = value !== null && typeof value === "object";
  const entries = expandable ? Object.entries(value as Record<string, unknown>) : [];
  const [expanded, setExpanded] = useState(depth < 2);

  if (!expandable) {
    return (
      <div className="json-tree-leaf" role="treeitem" style={{ paddingLeft: depth * 16 }}>
        <span className="tree-spacer" />
        <span className="json-key">{name}</span>
        <span className="json-colon">:</span>
        <JsonPrimitive value={value} />
      </div>
    );
  }

  const array = Array.isArray(value);
  const opening = array ? "[" : "{";
  const closing = array ? "]" : "}";

  return (
    <div className="json-tree-branch" role="treeitem" aria-expanded={expanded}>
      <button className="json-tree-toggle" onClick={() => setExpanded(!expanded)} style={{ paddingLeft: depth * 16 }}>
        <span className="tree-caret">{expanded ? "▾" : "▸"}</span>
        <span className="json-key">{name}</span>
        <span className="json-colon">:</span>
        <span className="json-punctuation">{opening}</span>
        {!expanded && <span className="json-count">{entries.length} {array ? "items" : "keys"}</span>}
        {!expanded && <span className="json-punctuation">{closing}</span>}
      </button>
      {expanded && (
        <div role="group">
          {entries.map(([key, child]) => <JsonTreeNode key={key} name={key} value={child} depth={depth + 1} />)}
          <div className="json-tree-close" style={{ paddingLeft: depth * 16 + 18 }}>{closing}</div>
        </div>
      )}
    </div>
  );
}

function JsonPrimitive({ value }: { value: unknown }) {
  if (value === null) return <span className="json-null">null</span>;
  if (typeof value === "string") return <span className="json-string">{JSON.stringify(value)}</span>;
  if (typeof value === "number") return <span className="json-number">{String(value)}</span>;
  if (typeof value === "boolean") return <span className="json-boolean">{String(value)}</span>;
  if (value === undefined) return <span className="json-null">undefined</span>;
  return <span className="json-string">{String(value)}</span>;
}
