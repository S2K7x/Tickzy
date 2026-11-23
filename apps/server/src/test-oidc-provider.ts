import { createServer, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

/**
 * Minimal OpenID provider for integration tests (T-101b): discovery, JWKS, token endpoint
 * (client_secret_basic/post), PKCE S256 verification and single-use codes. ID tokens are RS256-signed; per-code overrides let tests tamper.
 */
interface PendingCode {
  clientId: string;
  redirectUri: string;
  challenge: string;
  nonce: string;
  claims: Record<string, unknown>;
  override: { nonce?: string; aud?: string; iss?: string };
}

export async function startMockOidcProvider(clientId: string, clientSecret: string) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  const codes = new Map<string, PendingCode>();
  let nextClaims: Record<string, unknown> | null = null;
  let base = "";

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", base);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/.well-known/openid-configuration") {
      return json(200, {
        issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, jwks_uri: `${base}/jwks`,
        response_types_supported: ["code"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      });
    }
    if (url.pathname === "/jwks") return json(200, { keys: [jwk] });
    // Browser-driven E2E: auto-approve with the claims set via POST /control/claims (127.0.0.1 only).
    if (url.pathname === "/authorize" && req.method === "GET") {
      if (!nextClaims) return json(400, { error: "no claims configured" });
      if (nextClaims.__deny) {
        const cb = new URL(url.searchParams.get("redirect_uri")!);
        cb.searchParams.set("error", "access_denied");
        cb.searchParams.set("state", url.searchParams.get("state") ?? "");
        res.writeHead(302, { location: cb.href });
        return res.end();
      }
      const cb = api.approve(url.href, nextClaims);
      res.writeHead(302, { location: new URL(cb, url.searchParams.get("redirect_uri")!).href });
      return res.end();
    }
    if (url.pathname === "/control/claims" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => { nextClaims = JSON.parse(body) as Record<string, unknown>; json(200, { ok: true }); });
      return;
    }
    if (url.pathname === "/token" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        void (async () => {
          const form = new URLSearchParams(body);
          // client_secret_basic or client_secret_post, as real providers accept.
          const basic = req.headers.authorization?.startsWith("Basic ")
            ? Buffer.from(req.headers.authorization.slice(6), "base64").toString().split(":").map(decodeURIComponent)
            : [form.get("client_id"), form.get("client_secret")];
          const [id, secret] = basic;
          if (id !== clientId || secret !== clientSecret) return json(401, { error: "invalid_client" });
          const code = form.get("code") ?? "";
          const p = codes.get(code);
          codes.delete(code); // single use
          if (!p || form.get("grant_type") !== "authorization_code" || form.get("redirect_uri") !== p.redirectUri) return json(400, { error: "invalid_grant" });
          const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
          if (challenge !== p.challenge) return json(400, { error: "invalid_grant", error_description: "PKCE" });
          const idToken = await new SignJWT({ ...p.claims, nonce: p.override.nonce ?? p.nonce })
            .setProtectedHeader({ alg: "RS256", kid: "test-key" })
            .setIssuer(p.override.iss ?? base).setAudience(p.override.aud ?? p.clientId)
            .setIssuedAt().setExpirationTime("5m").sign(privateKey);
          json(200, { access_token: randomBytes(16).toString("hex"), token_type: "Bearer", expires_in: 300, id_token: idToken });
        })();
      });
      return;
    }
    json(404, { error: "not_found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const api = {
    get issuer() { return base; },
    /** Simulates the user approving at the provider: returns the callback URL path+query the browser would hit. */
    approve(authorizationUrl: string, claims: Record<string, unknown>, override: PendingCode["override"] = {}): string {
      const a = new URL(authorizationUrl);
      const code = randomBytes(12).toString("hex");
      codes.set(code, {
        clientId: a.searchParams.get("client_id")!, redirectUri: a.searchParams.get("redirect_uri")!,
        challenge: a.searchParams.get("code_challenge")!, nonce: a.searchParams.get("nonce")!, claims, override,
      });
      const cb = new URL(a.searchParams.get("redirect_uri")!);
      cb.searchParams.set("code", code);
      cb.searchParams.set("state", a.searchParams.get("state")!);
      return cb.pathname + cb.search;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  return api;
}
