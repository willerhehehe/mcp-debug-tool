export function normalizeLogPayload(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

export function stringifyLogPayload(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function compactLogPayload(value: unknown, maxLength = 220): string {
  const text = typeof value === "string" ? value : stringifyLogPayload(value).replaceAll("\n", " ");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
