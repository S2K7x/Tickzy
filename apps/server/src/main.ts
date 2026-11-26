import { createDatabase } from "@tickzy/db";
import { loadConfig } from "./config.ts";
import { buildApp } from "./app.ts";
import { createPgBossQueue } from "./jobs/queue.ts";
import { startWorker, type Worker } from "./worker.ts";
import { ConsoleEmailTransport } from "./lib/email.ts";
import { createDeliveryRegistry } from "./modules/messages/delivery.ts";
import { createIngestRegistry } from "./modules/ingest/channel.ts";
import { searchIndexAvailable } from "./modules/search/service.ts";

// Process roles (architecture §3): `api` (REST + WebSocket), `ingest` (provider webhooks), `worker` (jobs), or `all`
// (solo-stage default: one process runs everything).
const roleArg = process.argv.find((a) => a.startsWith("--role="))?.slice("--role=".length) ?? process.env.TICKZY_ROLE ?? "all";
if (!["api", "ingest", "worker", "all"].includes(roleArg)) {
  console.error(`unknown role "${roleArg}" (expected api | ingest | worker | all)`);
  process.exit(1);
}
const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
// One registry shared by the API (decides whether a reply is deliverable) and the worker (delivers it).
// Channel adapters are registered here as channels ship (Slack, email — M3).
const channels = createDeliveryRegistry([]);
// Inbound channels (provider webhooks), shared by the ingest role (receives) and the worker (processes).
const ingest = createIngestRegistry([]);
const app = await buildApp({
  config, database, email: new ConsoleEmailTransport(), channels, ingest,
  surfaces: { api: roleArg === "api" || roleArg === "all", ingest: roleArg === "ingest" || roleArg === "all" },
});
// ADR-028: without the tickzy_system role, search stays correct but scans instead of using its index.
void searchIndexAvailable(database.db).then((ok) => {
  if (!ok) app.log.warn("search runs WITHOUT its full-text index: the migration role could not create tickzy_system (BYPASSRLS). See ADR-028.");
}).catch((err: unknown) => app.log.error({ err }, "could not check search index mode"));
let worker: Worker | null = null;

if (roleArg === "worker" || roleArg === "all") {
  worker = await startWorker({
    database,
    queue: createPgBossQueue(config.DATABASE_URL),
    channels,
    ingest,
    inboundRetentionDays: config.INBOUND_RETENTION_DAYS,
    log: (msg, err) => app.log.error({ err }, msg),
  });
  app.log.info("worker started");
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await worker?.stop();
  await database.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

if (roleArg !== "worker") {
  await app.listen({ port: config.PORT, host: config.HOST });
}
