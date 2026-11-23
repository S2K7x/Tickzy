import Fastify, { type FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import cookie from "@fastify/cookie";
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { sql } from "drizzle-orm";
import { newId } from "@tickzy/shared";
import type { Database } from "@tickzy/db";
import { allowedOrigins, trustProxySetting, type Config } from "./config.ts";
import { MemoryRateLimitStore, registerRateLimitAfterAuth, registerRateLimitBeforeAuth, type RateLimitStore } from "./http/rate-limit.ts";
import type { EmailTransport } from "./lib/email.ts";
import { createAuthService } from "./modules/auth/service.ts";
import { authRoutes } from "./modules/auth/routes.ts";
import { registerErrorHandling } from "./http/errors.ts";
import { registerAuth } from "./http/auth.ts";
import { workspaceRoutes } from "./modules/workspaces/routes.ts";
import { auditRoutes } from "./modules/audit/routes.ts";
import { memberRoutes } from "./modules/members/routes.ts";
import { apiTokenRoutes } from "./modules/api-tokens/routes.ts";
import { createApiTokenService } from "./modules/api-tokens/service.ts";

export interface AppDeps {
  config: Pick<Config, "LOG_LEVEL" | "AUTH_DEV_MODE" | "APP_ORIGIN" | "ALLOWED_ORIGINS" | "COOKIE_SECURE" | "TRUST_PROXY" | "RATE_LIMIT_PER_MIN" | "RATE_LIMIT_IP_PER_MIN" | "RATE_LIMIT_AUTH_PER_MIN">;
  database: Database;
  email: EmailTransport;
  rateLimitStore?: RateLimitStore;
  now?: () => number;
}

export async function buildApp({ config, database, email, rateLimitStore = new MemoryRateLimitStore(), now }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.LOG_LEVEL === "silent" ? false : { level: config.LOG_LEVEL, redact: ["req.headers.authorization", "req.headers.cookie"] },
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
  const auth = createAuthService({ db: database.db, email, appOrigin: new URL(config.APP_ORIGIN).origin });
  const limits = { perPrincipal: config.RATE_LIMIT_PER_MIN, perIp: config.RATE_LIMIT_IP_PER_MIN, authPerIp: config.RATE_LIMIT_AUTH_PER_MIN };
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
  app.get("/v1/openapi.json", { schema: { hide: true } }, async () => app.swagger());

  await app.register(authRoutes(database.db, auth, { cookieSecure: config.COOKIE_SECURE }));
  await app.register(workspaceRoutes(database.db));
  await app.register(auditRoutes(database.db));
  await app.register(memberRoutes(database.db, { email, appOrigin: new URL(config.APP_ORIGIN).origin }));
  await app.register(apiTokenRoutes(database.db, apiTokens));
  return app;
}
