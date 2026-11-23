import { monotonicFactory } from "ulid";

/**
 * Prefixed, time-sortable identifiers (ADR-018): `<prefix>_<26-char Crockford ULID>`.
 * Globally unique so tenants can move between shards/cells without id collisions.
 */
export const ID_PREFIXES = {
  workspace: "ws",
  user: "usr",
  membership: "mem",
  invitation: "inv",
  identity: "idn",
  auditLog: "aud",
  apiToken: "tok",
  account: "acc",
  contact: "con",
  issue: "iss",
  message: "msg",
  conversation: "cnv",
  event: "evt",
  request: "req",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;
export type IdPrefix = (typeof ID_PREFIXES)[IdKind];

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const PREFIXES = new Set<string>(Object.values(ID_PREFIXES));
const nextUlid = monotonicFactory();

export function newId(kind: IdKind, now: number = Date.now()): string {
  return `${ID_PREFIXES[kind]}_${nextUlid(now)}`;
}

export function parseId(value: string): { prefix: IdPrefix; ulid: string } | null {
  const sep = value.indexOf("_");
  if (sep <= 0) return null;
  const prefix = value.slice(0, sep);
  const ulid = value.slice(sep + 1);
  if (!PREFIXES.has(prefix) || !ULID_RE.test(ulid)) return null;
  return { prefix: prefix as IdPrefix, ulid };
}

export function isId(value: unknown, kind?: IdKind): value is string {
  if (typeof value !== "string") return false;
  const parsed = parseId(value);
  if (!parsed) return false;
  return kind === undefined || parsed.prefix === ID_PREFIXES[kind];
}
