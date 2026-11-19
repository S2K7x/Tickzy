import { createDatabase } from "@tickzy/db";
import { loadConfig } from "./config.ts";
import { buildApp } from "./app.ts";

// Process roles (architecture §3): only `api` exists in M0; `worker` arrives with T-009.
const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const app = await buildApp({ config, database });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await database.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: config.PORT, host: config.HOST });
