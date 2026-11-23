import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// RFC 4648 base32 alphabet, lowercase — URL/cookie-safe, case-insensitive-friendly.
const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export function randomBase32(bytes: number): string {
  const buf = randomBytes(bytes);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function sha256(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export interface SplitToken {
  id: string;
  secret: string;
}

/** Token = "<id>.<secret>": the id locates the row, only SHA-256(secret) is stored (ADR-021). */
export function newToken(): SplitToken & { token: string; secretHash: Buffer } {
  const id = randomBase32(15); // 120 bits
  const secret = randomBase32(32); // 256 bits
  return { id, secret, token: `${id}.${secret}`, secretHash: sha256(secret) };
}

const TOKEN_RE = /^([a-z2-7]{24})\.([a-z2-7]{52})$/;

export function parseToken(token: string): SplitToken | null {
  const m = TOKEN_RE.exec(token);
  return m ? { id: m[1]!, secret: m[2]! } : null;
}

export function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
