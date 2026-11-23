import { createDatabase } from "@tickzy/db";
import { loadConfig } from "./config.ts";
import { buildApp } from "./app.ts";
import { createPgBossQueue } from "./jobs/queue.ts";
import { startWorker, type Worker } from "./worker.ts";
import { ConsoleEmailTransport } from "./lib/email.ts";

// Process roles (architecture §3): `api`, `worker`, or `all` (solo-stage default: one process runs both).
const roleArg = process.argv.find((a) => a.startsWith("--role="))?.slice("--role=".length) ?? process.env.TICKZY_ROLE ?? "all";
if (!["api", "worker", "all"].includes(roleArg)) {
  console.error(`unknown role "${roleArg}" (expected api | worker | all)`);
  process.exit(1);
}
const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const app = await buildApp({ config, database, email: new ConsoleEmailTransport() });
let worker: Worker | null = null;

if (roleArg === "worker" || roleArg === "all") {
  worker = await startWorker({
    database,
    queue: createPgBossQueue(config.DATABASE_URL),
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

if (roleArg === "api" || roleArg === "all") {
  await app.listen({ port: config.PORT, host: config.HOST });
}
