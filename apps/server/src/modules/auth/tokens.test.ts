import { describe, expect, it } from "vitest";
import { constantTimeEqual, newToken, parseToken, randomBase32, sha256 } from "./tokens.ts";

describe("auth tokens", () => {
  it("produces id.secret tokens with 120-bit ids and 256-bit secrets", () => {
    const t = newToken();
    expect(t.token).toMatch(/^[a-z2-7]{24}\.[a-z2-7]{52}$/);
    expect(parseToken(t.token)).toEqual({ id: t.id, secret: t.secret });
    expect(constantTimeEqual(sha256(t.secret), t.secretHash)).toBe(true);
  });
  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 1000 }, () => randomBase32(15)));
    expect(seen.size).toBe(1000);
  });
  it("rejects malformed tokens", () => {
    for (const bad of ["", "abc", "a.b", `${"a".repeat(24)}.${"A".repeat(52)}`, `${"a".repeat(24)}.${"a".repeat(51)}`, `${"a".repeat(24)}.${"a".repeat(52)}x`]) {
      expect(parseToken(bad)).toBeNull();
    }
  });
  it("compares hashes of different length safely", () => {
    expect(constantTimeEqual(Buffer.from("ab"), Buffer.from("abc"))).toBe(false);
  });
});
