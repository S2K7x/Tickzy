import { describe, expect, it } from "vitest";
import { isId, newId, parseId } from "./ids.ts";

describe("ids", () => {
  it("generates prefixed 26-char ULIDs", () => {
    const id = newId("workspace");
    expect(id).toMatch(/^ws_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("is lexicographically sortable by creation time", () => {
    const a = newId("issue", 1_700_000_000_000);
    const b = newId("issue", 1_700_000_000_001);
    const c = newId("issue", 1_700_000_000_001); // same ms → monotonic
    expect([c, b, a].sort()).toEqual([a, b, c]);
  });

  it("parses and validates ids", () => {
    const id = newId("account");
    expect(parseId(id)?.prefix).toBe("acc");
    expect(isId(id, "account")).toBe(true);
    expect(isId(id, "issue")).toBe(false);
  });

  it("rejects malformed values", () => {
    for (const bad of ["", "ws", "ws_", "xx_01HZZZZZZZZZZZZZZZZZZZZZZZ", "ws_01hzzzzzzzzzzzzzzzzzzzzzzz", "ws_ILOU0000000000000000000000", 42, null]) {
      expect(isId(bad)).toBe(false);
    }
  });
});
