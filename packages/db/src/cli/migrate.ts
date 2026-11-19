import { migrate } from "../migrate.ts";

const url = process.env.DATABASE_OWNER_URL;
if (!url) {
  console.error("DATABASE_OWNER_URL is required");
  process.exit(1);
}
const result = await migrate(url);
console.log(`applied: ${result.applied.join(", ") || "none"}; already applied: ${result.skipped.length}`);
