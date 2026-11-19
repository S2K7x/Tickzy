import Fastify, { type FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { sql } from "drizzle-orm";
import { newId } from "@tickzy/shared";
import type { Database } from "@tickzy/db";
import type { Config } from "./config.ts";
import { registerErrorHandling } from "./http/errors.ts";
import { registerAuth } from "./http/auth.ts";
import { workspaceRoutes } from "./modules/workspaces/routes.ts";
import { auditRoutes } from "./modules/audit/routes.ts";

export interface AppDeps {
  config: Pick<Config, "LOG_LEVEL" | "AUTH_DEV_MODE">;
  database: Database;
}

export async function buildApp({ config, database }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.LOG_LEVEL === "silent" ? false : { level: config.LOG_LEVEL, redact: ["req.headers.authorization", "req.headers.cookie"] },
    genReqId: () => newId("request"),
    requestIdHeader: false,
    trustProxy: true,
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
  registerAuth(app, { devMode: config.AUTH_DEV_MODE });

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

  await app.register(workspaceRoutes(database.db));
  await app.register(auditRoutes(database.db));
  return app;
}
