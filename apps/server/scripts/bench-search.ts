// Search benchmark (FR-3.8: p95 < 300 ms on 1M messages). Builds a separate database, seeds a workspace with
// N messages (Zipf-like vocabulary + product terms) plus a second tenant, then times the real search service as
// the RLS-bound app role. Usage:
//   node scripts/bench-search.ts [--messages=200000] [--runs=30] [--owner-url=postgres://tickzy_owner:tickzy@localhost:5432/postgres]
import pg from "pg";
import { createDatabase, migrate } from "@tickzy/db";
import { newId } from "@tickzy/shared";
import { createSearchService, searchIndexAvailable } from "../src/modules/search/service.ts";

const arg = (name: string, def: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? def;
const N = Number(arg("messages", "200000"));
const RUNS = Number(arg("runs", "30"));
const adminUrl = arg("owner-url", "postgres://tickzy_owner:tickzy@localhost:5432/postgres");
const DB = "tickzy_bench";
const WS = newId("workspace");
const WS2 = newId("workspace");
const USER = newId("user");

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${DB}`);
await admin.end();
const ownerUrl = new URL(adminUrl); ownerUrl.pathname = `/${DB}`;
await migrate(ownerUrl.toString());
const owner = new pg.Client({ connectionString: ownerUrl.toString() });
await owner.connect();

const t0 = Date.now();
async function seed(ws: string, messages: number, slug: string) {
  await owner.query("BEGIN");
  await owner.query("SELECT set_config('app.workspace_id', $1, true)", [ws]);
  await owner.query("INSERT INTO workspaces (id, name, slug, issue_prefix) VALUES ($1, $2, $2, 'BEN')", [ws, slug]);
  await owner.query("INSERT INTO workspace_counters (workspace_id, name, value) VALUES ($1, 'issue', 0)", [ws]);
  await owner.query("SELECT seed_workspace_defaults()");
  await owner.query("COMMIT");
  const issues = Math.max(1, Math.floor(messages / 10));
  // Vocabulary: 3000 synthetic words (Zipf-like pick) + product terms that queries look for.
  await owner.query(`
    WITH vocab AS (SELECT array_agg(w) AS v FROM (
      SELECT 'w' || g AS w FROM generate_series(1, 3000) g
      UNION ALL SELECT unnest(ARRAY['webhook','signature','mismatch','export','csv','timeout','invoice','vat','sso','login','dashboard','deploy','refund','latency','billing']) ) x)
    INSERT INTO issues (id, workspace_id, number, title, status_category, status_id, priority, channel_kind, created_at, updated_at)
    SELECT 'iss_' || gen_ulid(), $1, g,
           (SELECT array_to_string(ARRAY(SELECT v[1 + floor(power(random(), 2.5) * array_length(v, 1))::int] FROM generate_series(1, 6) WHERE g > 0), ' ') FROM vocab),
           s.category, s.id, (ARRAY['urgent','high','normal','low'])[1 + (g % 4)], (ARRAY['email','slack','widget'])[1 + (g % 3)],
           now() - (g || ' minutes')::interval, now() - (g || ' minutes')::interval
    FROM generate_series(1, $2::int) g
    JOIN LATERAL (SELECT id, category FROM statuses WHERE workspace_id = $1 AND is_default ORDER BY position LIMIT 1 OFFSET (g % 6)) s ON true`, [ws, issues]);
  await owner.query(`INSERT INTO conversations (id, workspace_id, channel_kind) SELECT 'cnv_' || substr(id, 5), $1, channel_kind FROM issues WHERE workspace_id = $1`, [ws]);
  await owner.query(`
    WITH vocab AS (SELECT array_agg(w) AS v FROM (
      SELECT 'w' || g AS w FROM generate_series(1, 3000) g
      UNION ALL SELECT unnest(ARRAY['webhook','signature','mismatch','export','csv','timeout','invoice','vat','sso','login','dashboard','deploy','refund','latency','billing']) ) x),
    iss AS (SELECT id, row_number() OVER () AS rn FROM issues WHERE workspace_id = $1)
    INSERT INTO messages (id, workspace_id, conversation_id, issue_id, direction, visibility, author_type, author_id, body_text, source, delivery_state, created_at)
    SELECT 'msg_' || gen_ulid(), $1, 'cnv_' || substr(iss.id, 5), iss.id,
           CASE WHEN g % 2 = 0 THEN 'in' ELSE 'out' END, 'public', CASE WHEN g % 2 = 0 THEN 'contact' ELSE 'member' END, NULL,
           (SELECT array_to_string(ARRAY(SELECT v[1 + floor(power(random(), 2.5) * array_length(v, 1))::int] FROM generate_series(1, 18 + (g % 15)) WHERE g > 0), ' ') FROM vocab),
           'email', CASE WHEN g % 2 = 0 THEN 'received' END, now() - (g || ' seconds')::interval
    FROM generate_series(1, $2::int) g JOIN iss ON iss.rn = 1 + (g % $3::int)`, [ws, messages, issues]);
}
await seed(WS, N, "bench");
await seed(WS2, Math.floor(N / 4), "bench-other");
await owner.query("INSERT INTO users (id, email, name) VALUES ($1, 'bench@example.com', 'Bench')", [USER]);
await owner.query("ANALYZE");
const seededIn = (Date.now() - t0) / 1000;
const { rows: [counts] } = await owner.query("SELECT (SELECT count(*) FROM messages)::int AS messages, (SELECT count(*) FROM issues)::int AS issues, pg_size_pretty(pg_database_size(current_database())) AS size");
await owner.end();

const appUrl = new URL(ownerUrl); appUrl.username = "tickzy_app"; appUrl.password = process.env.TICKZY_APP_PASSWORD ?? "tickzy_app";
const database = createDatabase(appUrl.toString(), { max: 4 });
const service = createSearchService(database.db);
const ctx = { workspaceId: WS, userId: USER, role: "admin" as const, actor: { type: "user" as const, id: USER } };
const QUERIES = ["webhook", '"signature mismatch"', "export -csv", "timeout status:triage", "w7 w12", "w2999", "billing is:open priority:urgent", "channel:slack refund", "is:unassigned latency"];

console.log(`full-text index under RLS: ${(await searchIndexAvailable(database.db)) ? "yes (tickzy_system)" : "NO - fallback mode"}`);
console.log(`seeded ${counts.messages} messages / ${counts.issues} issues (2 workspaces, ${counts.size}) in ${seededIn.toFixed(0)} s; ${RUNS} runs per query`);
let worst = 0;
for (const q of QUERIES) {
  const times: number[] = [];
  let hits = 0;
  for (let i = 0; i < RUNS + 2; i++) {
    const s = performance.now();
    const r = await service.search(ctx, q, 20);
    const ms = performance.now() - s;
    if (i >= 2) times.push(ms); // two warm-up runs
    hits = r.issues.length;
  }
  times.sort((a, b) => a - b);
  const p = (x: number) => times[Math.min(times.length - 1, Math.floor(x * times.length))]!;
  worst = Math.max(worst, p(0.95));
  console.log(`${q.padEnd(36)} p50 ${p(0.5).toFixed(1).padStart(7)} ms   p95 ${p(0.95).toFixed(1).padStart(7)} ms   (${hits} results)`);
}
console.log(`worst p95: ${worst.toFixed(1)} ms (target < 300 ms at 1M messages)`);
await database.close();
