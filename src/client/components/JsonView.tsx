import { Check, Copy } from "@phosphor-icons/react";
import { useState } from "react";

export function JsonView({ value, empty = "No result yet" }: { value: unknown; empty?: string }) {
  const [copied, setCopied] = useState(false);
  if (value === undefined) return <div className="empty-inline">{empty}</div>;
  const text = JSON.stringify(value, null, 2);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="json-view">
      <button className="icon-button json-copy" onClick={copy} aria-label="Copy JSON">
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
      <pre>{text}</pre>
    </div>
  );
}
