import { describe, expect, it } from "vitest";
import { compactLogPayload, normalizeLogPayload, stringifyLogPayload } from "../src/client/logPayload";

describe("log payload helpers", () => {
  it("keeps the full formatted JSON while only truncating the row summary", () => {
    const payload = { method: "tools/call", params: { message: "x".repeat(240) } };
    expect(compactLogPayload(payload)).toHaveLength(223);
    expect(stringifyLogPayload(payload)).toContain("x".repeat(240));
  });

  it("parses JSON-looking stderr strings for the tree view", () => {
    expect(normalizeLogPayload('{"level":"error","code":500}')).toEqual({ level: "error", code: 500 });
    expect(normalizeLogPayload("plain stderr text")).toBe("plain stderr text");
  });
});
