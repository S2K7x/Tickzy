import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { isBlockedAddress } from "./ip-policy.ts";
import { OutboundBlockedError, safeFetch, type SafeFetchDeps } from "./safe-fetch.ts";

/** T-111: SSRF-guarded outbound client (threat model §7). */
let server: http.Server; let port = 0;
const seen: { url: string; headers: http.IncomingHttpHeaders; method: string; body: string }[] = [];
// Test servers live on 127.0.0.1, so tests allow exactly that address; every other rule is the real policy.
const allowLoopback = (ip: string) => ip !== "127.0.0.1" && isBlockedAddress(ip);
const dnsTable: Record<string, string[]> = { "api.test": ["127.0.0.1"], "other.test": ["127.0.0.1"], "evil.test": ["10.0.0.5"], "mixed.test": ["127.0.0.1", "169.254.169.254"] };
const deps: SafeFetchDeps = {
  resolve: async (host) => {
    const ips = dnsTable[host];
    if (!ips) throw new Error("ENOTFOUND");
    return ips.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  },
  isBlocked: allowLoopback,
};
const base = (host = "api.test") => `http://${host}:${port}`;
const blocked = async (p: Promise<unknown>, reason: string) => {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(OutboundBlockedError);
  expect((err as OutboundBlockedError).reason).toBe(reason);
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ url: req.url!, headers: req.headers, method: req.method!, body });
      const u = new URL(req.url!, "http://x");
      if (u.pathname === "/ok") { res.setHeader("content-type", "text/plain"); return res.end("hello"); }
      if (u.pathname === "/redirect") { res.statusCode = Number(u.searchParams.get("code") ?? 302); res.setHeader("location", u.searchParams.get("to")!); return res.end(); }
      if (u.pathname === "/chain") { const n = Number(u.searchParams.get("n")); res.statusCode = 302; res.setHeader("location", n > 0 ? `/chain?n=${n - 1}` : "/ok"); return res.end(); }
      if (u.pathname === "/big") { res.setHeader("content-length", String(10_000)); return res.end("x".repeat(10_000)); }
      if (u.pathname === "/stream") { res.write("x".repeat(6000)); res.write("x".repeat(6000)); return res.end(); }
      if (u.pathname === "/hang") return; // never answers
      res.statusCode = 404; res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => { server.closeAllConnections(); server.close(); });

describe("IP policy", () => {
  it.each([
    "127.0.0.1", "10.0.0.1", "172.16.5.4", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1",
    "::1", "::", "fe80::1", "fd12::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a9fe:a9fe", "2002:a00:1::", "nonsense",
  ])("blocks %s", (ip) => expect(isBlockedAddress(ip)).toBe(true));
  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows %s", (ip) => expect(isBlockedAddress(ip)).toBe(false));
});

describe("safeFetch (T-111)", () => {
  it("fetches a public host through the validated address, without compression", async () => {
    const res = await safeFetch(`${base()}/ok`, { allowHttp: true }, deps);
    expect(res).toMatchObject({ status: 200, redirects: 0 });
    expect(res.body.toString()).toBe("hello");
    const req = seen.at(-1)!;
    expect(req.headers.host).toBe(`api.test:${port}`); // Host keeps the name; the socket used the validated IP
    expect(req.headers["accept-encoding"]).toBe("identity");
  });

  it("refuses non-https, credentials in URLs and low ports", async () => {
    await blocked(safeFetch(`${base()}/ok`, {}, deps), "scheme");
    await blocked(safeFetch("ftp://api.test/x", {}, deps), "scheme");
    await blocked(safeFetch(`http://user:pw@api.test:${port}/ok`, { allowHttp: true }, deps), "credentials_in_url");
    await blocked(safeFetch("https://api.test:22/", {}, deps), "port");
    await blocked(safeFetch("not a url", {}, deps), "invalid_url");
  });

  it("never allows plain http in production, whatever the caller asks", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try { await blocked(safeFetch(`${base()}/ok`, { allowHttp: true }, deps), "scheme"); } finally { process.env.NODE_ENV = prev; }
  });

  it("refuses literal internal addresses in every notation, with the real policy", async () => {
    for (const u of ["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://[::ffff:169.254.169.254]/", "http://0x7f000001/", "http://2130706433/", "http://10.0.0.1/"]) {
      await blocked(safeFetch(u, { allowHttp: true }), "blocked_address");
    }
  });

  it("refuses names that resolve to internal addresses — including a mix of public and internal answers", async () => {
    await blocked(safeFetch(`${base("evil.test")}/ok`, { allowHttp: true }, deps), "blocked_address");
    await blocked(safeFetch(`${base("mixed.test")}/ok`, { allowHttp: true }, deps), "blocked_address");
    await blocked(safeFetch(`${base("nowhere.test")}/ok`, { allowHttp: true }, deps), "dns");
    await blocked(safeFetch("http://localhost/", { allowHttp: true }), "blocked_address"); // real DNS, real policy
  });

  it("validates at connection time: a DNS answer that changes after an earlier check is judged again (no rebinding)", async () => {
    let calls = 0;
    const rebinding: SafeFetchDeps = { ...deps, resolve: async () => [{ address: ++calls === 1 ? "127.0.0.1" : "169.254.169.254", family: 4 }] };
    expect((await safeFetch(`${base()}/ok`, { allowHttp: true }, rebinding)).status).toBe(200);
    await blocked(safeFetch(`${base()}/ok`, { allowHttp: true }, rebinding), "blocked_address");
  });

  it("follows up to 3 redirects, re-checking every hop", async () => {
    expect((await safeFetch(`${base()}/chain?n=2`, { allowHttp: true }, deps)).redirects).toBe(3);
    await blocked(safeFetch(`${base()}/chain?n=3`, { allowHttp: true }, deps), "too_many_redirects");
    await blocked(safeFetch(`${base()}/redirect?to=${encodeURIComponent("http://169.254.169.254/latest/meta-data/")}`, { allowHttp: true }, deps), "blocked_address");
    await blocked(safeFetch(`${base()}/redirect?to=${encodeURIComponent(`${base("evil.test")}/ok`)}`, { allowHttp: true }, deps), "blocked_address");
    expect((await safeFetch(`${base()}/redirect?to=/ok`, { allowHttp: true, maxRedirects: 0 }, deps)).status).toBe(302);
  });

  it("drops credentials when a redirect leaves the origin, keeps them on the same origin", async () => {
    const h = { authorization: "Bearer secret", "x-api-key": "k", "x-trace": "t" };
    await safeFetch(`${base()}/redirect?to=${encodeURIComponent(`${base("other.test")}/ok`)}`, { allowHttp: true, headers: h, sensitiveHeaders: ["X-Api-Key"] }, deps);
    const cross = seen.at(-1)!.headers;
    expect(cross.authorization).toBeUndefined();
    expect(cross["x-api-key"]).toBeUndefined();
    expect(cross["x-trace"]).toBe("t");
    await safeFetch(`${base()}/redirect?to=/ok`, { allowHttp: true, headers: h }, deps);
    expect(seen.at(-1)!.headers.authorization).toBe("Bearer secret");
  });

  it("303 turns a POST into a GET without body", async () => {
    await safeFetch(`${base()}/redirect?code=303&to=/ok`, { allowHttp: true, method: "POST", body: '{"a":1}', headers: { "content-type": "application/json" } }, deps);
    const last = seen.at(-1)!;
    expect(last).toMatchObject({ method: "GET", body: "" });
    expect(last.headers["content-type"]).toBeUndefined();
  });

  it("caps response size (declared and streamed) and enforces the deadline", async () => {
    await blocked(safeFetch(`${base()}/big`, { allowHttp: true, maxBytes: 1000 }, deps), "too_large");
    await blocked(safeFetch(`${base()}/stream`, { allowHttp: true, maxBytes: 8000 }, deps), "too_large");
    const t0 = Date.now();
    await blocked(safeFetch(`${base()}/hang`, { allowHttp: true, timeoutMs: 300 }, deps), "timeout");
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe("safeFetch over https", () => {
  let dir = ""; let tls: https.Server; let tlsPort = 0; let cert: Buffer;
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "tz-tls-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=api.test", "-addext", "subjectAltName=DNS:api.test",
      "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem")], { stdio: "ignore" });
    // Paths are inside the temporary directory this test just created (mkdtempSync), not input.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    cert = readFileSync(path.join(dir, "cert.pem"));
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const key = readFileSync(path.join(dir, "key.pem"));
    tls = https.createServer({ key, cert }, (req, res) => {
      if (req.url === "/down") { res.statusCode = 302; res.setHeader("location", `http://api.test:${port}/ok`); return res.end(); }
      res.end("secure");
    });
    await new Promise<void>((r) => tls.listen(0, "127.0.0.1", () => r()));
    tlsPort = (tls.address() as AddressInfo).port;
  });
  afterAll(() => { tls.closeAllConnections(); tls.close(); rmSync(dir, { recursive: true, force: true }); });

  it("verifies the certificate against the hostname (SNI kept although the IP is pinned)", async () => {
    const res = await safeFetch(`https://api.test:${tlsPort}/`, {}, { ...deps, ca: cert });
    expect(res.body.toString()).toBe("secure");
    // Same server, name not in the certificate → TLS error (hostname verification is not bypassed by pinning).
    await expect(safeFetch(`https://other.test:${tlsPort}/`, {}, { ...deps, ca: cert })).rejects.toThrow(/altnames|certificate|Hostname/i);
    await expect(safeFetch(`https://api.test:${tlsPort}/`, {}, deps)).rejects.toThrow(/self-signed|certificate/i); // untrusted CA
  });

  it("refuses an https → http downgrade on redirect", async () => {
    await blocked(safeFetch(`https://api.test:${tlsPort}/down`, { allowHttp: true }, { ...deps, ca: cert }), "scheme");
  });
});
