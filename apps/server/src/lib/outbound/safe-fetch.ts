import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { isBlockedAddress } from "./ip-policy.ts";

/**
 * The only HTTP client for URLs that customers (or their content) control — webhook endpoints, knowledge-source
 * crawling, email images, provider file URLs (T-111, SEC-8, threat model §7 / TM-9).
 *
 * - DNS is resolved by us, and **every** returned address must be public; the socket then connects to the address
 *   we validated (validation runs inside the connection's own `lookup`), so a DNS answer cannot change between the
 *   check and the connection (no rebinding).
 * - Redirects are followed manually, at most `maxRedirects`, each hop re-validated; credentials are dropped when a
 *   redirect leaves the original origin.
 * - https only (http only when `allowHttp`, which is refused when NODE_ENV=production); no credentials in URLs;
 *   ports 443/80 or ≥ 1024.
 * - One deadline for the whole exchange, a response size cap, and no compression (no decompression bombs).
 */
export class OutboundBlockedError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = "OutboundBlockedError";
    this.reason = reason;
  }
}

export interface SafeFetchOptions {
  method?: "GET" | "HEAD" | "POST" | "PUT";
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** Total time for the whole exchange including redirects (default 10 s). */
  timeoutMs?: number;
  /** Response body cap (default 5 MB). */
  maxBytes?: number;
  /** Redirects followed (default 3; 0 = return the 3xx as is). */
  maxRedirects?: number;
  /** Allow plain http (development only — refused when NODE_ENV=production). */
  allowHttp?: boolean;
  /** Header names (any case) to drop if a redirect leaves the original origin, in addition to authorization/cookie. */
  sensitiveHeaders?: string[];
}
export interface SafeResponse { status: number; headers: http.IncomingHttpHeaders; body: Buffer; url: string; redirects: number }

/** Injection points for tests (DNS answers, which addresses are refused, TLS trust). Production uses the defaults. */
export interface SafeFetchDeps {
  resolve?: (host: string) => Promise<LookupAddress[]>;
  isBlocked?: (ip: string) => boolean;
  ca?: string | Buffer;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const ALWAYS_SENSITIVE = ["authorization", "cookie", "proxy-authorization"];
const USER_AGENT = "Tickzy-Fetcher/1.0";

const systemResolve = (host: string) => new Promise<LookupAddress[]>((resolve, reject) =>
  dnsLookup(host, { all: true, verbatim: true }, (err, addresses) => (err ? reject(err) : resolve(addresses))));

function checkUrl(raw: string | URL, allowHttp: boolean): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new OutboundBlockedError("invalid_url", "Not a valid URL"); }
  if (u.protocol !== "https:" && !(allowHttp && u.protocol === "http:")) throw new OutboundBlockedError("scheme", `Only https URLs are allowed (got ${u.protocol})`);
  if (u.username || u.password) throw new OutboundBlockedError("credentials_in_url", "URLs must not contain credentials");
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  if (port !== 443 && port !== 80 && port < 1024) throw new OutboundBlockedError("port", `Port ${port} is not allowed`);
  return u;
}

/** A `lookup` for http(s).request that validates the addresses it hands to the socket. */
function guardedLookup(resolve: NonNullable<SafeFetchDeps["resolve"]>, isBlocked: (ip: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then((addresses) => {
      if (!addresses.length) return callback(new OutboundBlockedError("dns", `${hostname} does not resolve`), "", 4);
      const bad = addresses.find((a) => isBlocked(a.address));
      // Refuse if ANY answer is non-public: an attacker controlling DNS could otherwise mix one public and one
      // internal address and let the OS pick.
      if (bad) return callback(new OutboundBlockedError("blocked_address", `${hostname} resolves to a non-public address`), "", 4);
      const chosen = addresses[0]!;
      if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, [chosen]);
      callback(null, chosen.address, chosen.family);
    }, (err: Error) => callback(Object.assign(new OutboundBlockedError("dns", `${hostname}: ${err.message}`), { cause: err }), "", 4));
  };
}

export async function safeFetch(url: string | URL, opts: SafeFetchOptions = {}, deps: SafeFetchDeps = {}): Promise<SafeResponse> {
  // Plain http is a development convenience only; production never sends customer-bound requests unencrypted.
  if (opts.allowHttp && process.env.NODE_ENV === "production") throw new OutboundBlockedError("scheme", "http is not allowed in production");
  const resolve = deps.resolve ?? systemResolve;
  const isBlocked = deps.isBlocked ?? isBlockedAddress;
  const maxRedirects = opts.maxRedirects ?? 3;
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
  const sensitive = new Set([...ALWAYS_SENSITIVE, ...(opts.sensitiveHeaders ?? []).map((h) => h.toLowerCase())]);
  const origin = checkUrl(url, !!opts.allowHttp).origin;
  let current = checkUrl(url, !!opts.allowHttp);
  let method = opts.method ?? "GET";
  let body = opts.body;
  let headers: Record<string, string> = { "user-agent": USER_AGENT, "accept-encoding": "identity", ...lower(opts.headers ?? {}) };

  for (let hop = 0; ; hop++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new OutboundBlockedError("timeout", "The request timed out");
    // Literal IPs never go through DNS: judge them directly.
    const host = current.hostname.replace(/^\[|\]$/g, "");
    if (/^[\d.]+$|:/.test(host) && isBlocked(host)) throw new OutboundBlockedError("blocked_address", "The address is not public");
    const res = await requestOnce(current, { method, headers, body, maxBytes, timeoutMs: remaining, lookup: guardedLookup(resolve, isBlocked), ca: deps.ca });
    if (!REDIRECTS.has(res.status) || maxRedirects === 0) return { ...res, url: current.toString(), redirects: hop };
    if (hop >= maxRedirects) throw new OutboundBlockedError("too_many_redirects", `More than ${maxRedirects} redirects`);
    const location = res.headers.location;
    if (!location) return { ...res, url: current.toString(), redirects: hop };
    const next = checkUrl(new URL(location, current), !!opts.allowHttp);
    if (next.protocol === "http:" && current.protocol === "https:") throw new OutboundBlockedError("scheme", "Redirect from https to http refused");
    if (next.origin !== origin) headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !sensitive.has(k)));
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
      method = "GET";
      body = undefined;
      delete headers["content-type"];
      delete headers["content-length"];
    }
    current = next;
  }
}

const lower = (h: Record<string, string>) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));

function requestOnce(u: URL, o: { method: string; headers: Record<string, string>; body: string | Buffer | undefined; maxBytes: number; timeoutMs: number; lookup: LookupFunction; ca: string | Buffer | undefined }) {
  return new Promise<Omit<SafeResponse, "url" | "redirects">>((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(u, {
      method: o.method, headers: { ...o.headers, ...(o.body !== undefined ? { "content-length": String(Buffer.byteLength(o.body)) } : {}) },
      lookup: o.lookup, agent: false, ...(o.ca ? { ca: o.ca } : {}),
    }, (res) => {
      const declared = Number(res.headers["content-length"] ?? 0);
      if (declared > o.maxBytes) { req.destroy(); return reject(new OutboundBlockedError("too_large", `Response larger than ${o.maxBytes} bytes`)); }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > o.maxBytes) { req.destroy(); reject(new OutboundBlockedError("too_large", `Response larger than ${o.maxBytes} bytes`)); return; }
        chunks.push(c);
      });
      res.on("end", () => { clearTimeout(timer); resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }); });
      res.on("error", (e) => { clearTimeout(timer); reject(e); });
    });
    const timer = setTimeout(() => { req.destroy(new OutboundBlockedError("timeout", "The request timed out")); }, o.timeoutMs);
    req.on("error", (e) => { clearTimeout(timer); reject(e instanceof OutboundBlockedError ? e : (e as { cause?: unknown }).cause instanceof OutboundBlockedError ? (e as { cause: Error }).cause : e); });
    if (o.body !== undefined) req.write(o.body);
    req.end();
  });
}
