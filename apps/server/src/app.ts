import Fastify, { type FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { sql } from "drizzle-orm";
import { newId } from "@tickzy/shared";
import type { Database } from "@tickzy/db";
import { allowedOrigins, trustProxySetting, type Config } from "./config.ts";
import { MemoryRateLimitStore, registerRateLimitAfterAuth, registerRateLimitBeforeAuth, type RateLimitStore } from "./http/rate-limit.ts";
import type { EmailTransport } from "./lib/email.ts";
import { createAuthService } from "./modules/auth/service.ts";
import { authRoutes } from "./modules/auth/routes.ts";
import { oauthRoutes } from "./modules/auth/oauth-routes.ts";
import { createOidc } from "./modules/auth/oidc.ts";
import { registerErrorHandling } from "./http/errors.ts";
import { registerAuth } from "./http/auth.ts";
import { workspaceRoutes } from "./modules/workspaces/routes.ts";
import { auditRoutes } from "./modules/audit/routes.ts";
import { memberRoutes } from "./modules/members/routes.ts";
import { apiTokenRoutes } from "./modules/api-tokens/routes.ts";
import { customerRoutes } from "./modules/customers/routes.ts";
import { issueRoutes } from "./modules/issues/routes.ts";
import { searchRoutes } from "./modules/search/routes.ts";
import { registerSecurityHeaders } from "./http/security-headers.ts";
import { taxonomyRoutes } from "./modules/taxonomy/routes.ts";
import { ingestRoutes } from "./modules/ingest/routes.ts";
import { emailRoutes } from "./modules/email/routes.ts";
import { createIngestRegistry, type IngestRegistry } from "./modules/ingest/channel.ts";
import { viewRoutes } from "./modules/views/routes.ts";
import { realtimeGateway } from "./modules/realtime/gateway.ts";
import { messageRoutes } from "./modules/messages/routes.ts";
import { createDeliveryRegistry, type DeliveryRegistry } from "./modules/messages/delivery.ts";
import { createApiTokenService } from "./modules/api-tokens/service.ts";

export interface AppDeps {
  config: Pick<Config, "LOG_LEVEL" | "AUTH_DEV_MODE" | "APP_ORIGIN" | "ALLOWED_ORIGINS" | "COOKIE_SECURE" | "TRUST_PROXY" | "RATE_LIMIT_PER_MIN" | "RATE_LIMIT_IP_PER_MIN" | "RATE_LIMIT_AUTH_PER_MIN"> &
    Partial<Pick<Config, "INGEST_PER_WORKSPACE_PER_MIN" | "INBOUND_EMAIL_DOMAIN">> &
    Partial<Pick<Config, "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "GOOGLE_ISSUER" | "MICROSOFT_CLIENT_ID" | "MICROSOFT_CLIENT_SECRET" | "MICROSOFT_ISSUER">>;
  database: Database;
  email: EmailTransport;
  rateLimitStore?: RateLimitStore;
  /** Outbound channel adapters (ADR-012); none until the first channel ships (M3). */
  channels?: DeliveryRegistry;
  /** Inbound channels (T-301); none until the first channel ships (email T-302, Slack T-305). */
  ingest?: IngestRegistry;
  /** Which surfaces this process serves (process roles, architecture §3). Default: both. */
  surfaces?: { api?: boolean; ingest?: boolean };
  /** Realtime revalidation interval (tests use a short one). */
  realtimeSweepMs?: number;
  now?: () => number;
}

export async function buildApp({ config, database, email, rateLimitStore = new MemoryRateLimitStore(), now, channels = createDeliveryRegistry(), ingest = createIngestRegistry(), surfaces = {}, realtimeSweepMs }: AppDeps): Promise<FastifyInstance> {
  const serveApi = surfaces.api ?? true;
  const serveIngest = surfaces.ingest ?? true;
  const app = Fastify({
    // Never log credentials or provider signatures (threat model TM-5); request bodies are not logged at all.
    logger: config.LOG_LEVEL === "silent" ? false : { level: config.LOG_LEVEL, redact: ["req.headers.authorization", "req.headers.cookie", 'req.headers["x-slack-signature"]', 'req.headers["x-tickzy-signature"]'] },
    genReqId: () => newId("request"),
    requestIdHeader: false,
    trustProxy: trustProxySetting(config.TRUST_PROXY),
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook("onSend", async (req, reply) => {
    void reply.header("x-request-id", req.id);
  });

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: { title: "Tickzy API", version: "v1" },
      components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
      security: [{ bearer: [] }],
    },
    transform: jsonSchemaTransform,
  });

  registerErrorHandling(app);
  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 8192 } });
  const auth = createAuthService({ db: database.db, email, appOrigin: new URL(config.APP_ORIGIN).origin });
  const limits = { perPrincipal: config.RATE_LIMIT_PER_MIN, perIp: config.RATE_LIMIT_IP_PER_MIN, authPerIp: config.RATE_LIMIT_AUTH_PER_MIN };
  registerSecurityHeaders(app, { https: config.COOKIE_SECURE });
  registerRateLimitBeforeAuth(app, limits, rateLimitStore, now);
  const apiTokens = createApiTokenService(database.db);
  registerAuth(app, { devMode: config.AUTH_DEV_MODE, sessions: auth, apiTokens, cookieSecure: config.COOKIE_SECURE, allowedOrigins: allowedOrigins(config) });
  registerRateLimitAfterAuth(app, limits, rateLimitStore, now);

  app.get("/healthz", { schema: { hide: true } }, async () => ({ status: "ok" }));
  app.get("/readyz", { schema: { hide: true } }, async (_req, reply) => {
    try {
      await database.db.execute(sql`SELECT 1`);
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });
  if (serveIngest) {
    await app.register(ingestRoutes(database.db, ingest, { store: rateLimitStore, perWorkspacePerMin: config.INGEST_PER_WORKSPACE_PER_MIN ?? 600, ...(now ? { now } : {}) }));
  }
  if (!serveApi) return app;
  app.get("/v1/openapi.json", { schema: { hide: true } }, async () => app.swagger());

  await app.register(authRoutes(database.db, auth, { cookieSecure: config.COOKIE_SECURE }));
  const publicOrigin = new URL(config.APP_ORIGIN).origin;
  const provider = (id?: string, secret?: string, issuer?: string) => (id && secret && issuer ? { clientId: id, clientSecret: secret, issuer } : undefined);
  const oidc = createOidc(database.db, {
    publicOrigin,
    google: provider(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, config.GOOGLE_ISSUER ?? "https://accounts.google.com"),
    microsoft: provider(config.MICROSOFT_CLIENT_ID, config.MICROSOFT_CLIENT_SECRET, config.MICROSOFT_ISSUER ?? "https://login.microsoftonline.com/common/v2.0"),
  });
  await app.register(oauthRoutes(oidc, auth, { cookieSecure: config.COOKIE_SECURE, publicOrigin }));
  await app.register(workspaceRoutes(database.db));
  await app.register(auditRoutes(database.db));
  await app.register(memberRoutes(database.db, { email, appOrigin: new URL(config.APP_ORIGIN).origin }));
  await app.register(apiTokenRoutes(database.db, apiTokens));
  await app.register(customerRoutes(database.db));
  await app.register(issueRoutes(database.db));
  await app.register(searchRoutes(database.db));
  await app.register(taxonomyRoutes(database.db));
  await app.register(viewRoutes(database.db));
  await app.register(emailRoutes(database.db, { inboundDomain: config.INBOUND_EMAIL_DOMAIN }));
  const realtime = realtimeGateway({
    db: database.db, pool: database.pool, sessions: auth, allowedOrigins: allowedOrigins(config),
    log: (msg, err) => app.log.error({ err }, msg), ...(realtimeSweepMs ? { sweepMs: realtimeSweepMs } : {}),
  });
  await realtime.register(app);
  app.decorate("realtime", realtime);
  await app.register(messageRoutes(database.db, channels));
  return app;
}
