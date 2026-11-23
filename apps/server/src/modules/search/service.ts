import { and, inArray, sql, type SQL } from "drizzle-orm";
import { isEmptySearch, parseSearch, type ParsedSearch } from "@tickzy/shared";
import { schema, withWorkspace, type Db, type Tx } from "@tickzy/db";
import type { MemberContext } from "../../http/auth.ts";
import { toDtos, type IssueDto } from "../issues/service.ts";

/** Highlight markers inside snippets (control characters; the client renders them as <mark>, never as HTML). */
export const HL_START = "\u0001";
export const HL_END = "\u0002";

export interface SearchResult {
  query: ParsedSearch;
  issues: { issue: IssueDto; match: { in: "title" | "message" | "filters"; message_id: string | null; snippet: string | null } }[];
  accounts: { id: string; name: string; domains: string[] }[];
}

const like = (s: string) => `%${s.replace(/[%_\\]/g, "\\$&")}%`;

/** Author ids (contacts and teammates) matching a `from:` value by email or name. */
async function authorsMatching(tx: Tx, values: string[]): Promise<{ contacts: string[]; users: string[] }> {
  if (!values.length) return { contacts: [], users: [] };
  const contactConds = values.map((v) => sql`(c.name ILIKE ${like(v)} OR EXISTS (SELECT 1 FROM contact_identities ci WHERE ci.contact_id = c.id AND ci.external_key ILIKE ${like(v)}))`);
  const contacts = (await tx.execute(sql`SELECT c.id FROM contacts c WHERE ${sql.join(contactConds, sql` OR `)}`)).rows.map((r) => String(r.id));
  const userConds = values.map((v) => sql`(u.email ILIKE ${like(v)} OR u.name ILIKE ${like(v)})`);
  const users = (await tx.execute(sql`SELECT u.id FROM users u JOIN memberships m ON m.user_id = u.id WHERE ${sql.join(userConds, sql` OR `)}`)).rows.map((r) => String(r.id));
  return { contacts, users };
}

/** Accounts whose name contains the words or whose domain starts with them. */
async function matchingAccounts(tx: Tx, text: string): Promise<SearchResult["accounts"]> {
  const words = text.replace(/["-]/g, " ").trim();
  if (!words) return [];
  const found = await tx.select().from(schema.accounts)
    .where(and(sql`${schema.accounts.deletedAt} IS NULL`, sql`(${schema.accounts.name} ILIKE ${like(words)} OR EXISTS (SELECT 1 FROM account_domains d WHERE d.account_id = ${schema.accounts.id} AND d.domain LIKE ${`${words.toLowerCase().replace(/[%_\\]/g, "\\$&")}%`}))`))
    .limit(5);
  const doms = found.length ? await tx.select().from(schema.accountDomains).where(inArray(schema.accountDomains.accountId, found.map((a) => a.id))) : [];
  return found.map((a) => ({ id: a.id, name: a.name, domains: doms.filter((d) => d.accountId === a.id).map((d) => d.domain) }));
}

/** Whether full-text search runs with its index (ADR-028); false means a correct but slow fallback. */
export async function searchIndexAvailable(db: Db): Promise<boolean> {
  const r = await db.execute(sql`SELECT search_index_available() AS ok`);
  return r.rows[0]?.ok === true;
}

export function createSearchService(db: Db) {
  return {
    async search(ctx: MemberContext, raw: string, limit = 20): Promise<SearchResult> {
      const query = parseSearch(raw);
      if (isEmptySearch(query)) return { query, issues: [], accounts: [] };
      const f = query.filters;
      return withWorkspace(db, ctx, async (tx) => {
        const hasText = query.text.length > 0;
        const tsq = sql`websearch_to_tsquery('simple', ${query.text})`;

        // Message-level conditions: text match, author, internal notes.
        const msgConds: SQL[] = [sql`m.issue_id IS NOT NULL`, sql`m.deleted_at IS NULL`]; // used by the no-text path
        let needsMessage = false;
        if (f.from.length) {
          const a = await authorsMatching(tx, f.from);
          const parts: SQL[] = [];
          if (a.contacts.length) parts.push(sql`(m.author_type = 'contact' AND m.author_id IN (${sql.join(a.contacts.map((x) => sql`${x}`), sql`, `)}))`);
          if (a.users.length) parts.push(sql`(m.author_type = 'member' AND m.author_id IN (${sql.join(a.users.map((x) => sql`${x}`), sql`, `)}))`);
          msgConds.push(parts.length ? sql`(${sql.join(parts, sql` OR `)})` : sql`false`);
          needsMessage = true;
        }
        if (f.is.includes("internal")) { msgConds.push(sql`m.visibility = 'internal'`); needsMessage = true; }

        // Issue-level filters.
        const issueConds: SQL[] = [];
        if (f.status.length) issueConds.push(sql`i.status_category IN (${sql.join(f.status.map((s) => sql`${s}`), sql`, `)})`);
        if (f.is.includes("open")) issueConds.push(sql`i.status_category IN ('triage','waiting_on_us','waiting_on_customer','blocked')`);
        if (f.is.includes("unassigned")) issueConds.push(sql`i.assignee_membership_id IS NULL`);
        if (f.is.includes("mine")) {
          issueConds.push(ctx.userId ? sql`i.assignee_membership_id IN (SELECT id FROM memberships WHERE user_id = ${ctx.userId})` : sql`false`);
        }
        if (f.channel.length) issueConds.push(sql`i.channel_kind IN (${sql.join(f.channel.map((s) => sql`${s}`), sql`, `)})`);
        if (f.priority.length) issueConds.push(sql`i.priority IN (${sql.join(f.priority.map((s) => sql`${s}`), sql`, `)})`);
        if (f.account.length) {
          const acc = f.account.map((v) => sql`(a.name ILIKE ${like(v)} OR EXISTS (SELECT 1 FROM account_domains d WHERE d.account_id = a.id AND d.domain LIKE ${`${v.toLowerCase().replace(/[%_\\]/g, "\\$&")}%`}))`);
          issueConds.push(sql`i.account_id IN (SELECT a.id FROM accounts a WHERE a.deleted_at IS NULL AND (${sql.join(acc, sql` OR `)}))`);
        }
        if (!f.status.length && !f.is.includes("open")) issueConds.push(sql`i.status_category <> 'ignored'`); // FR-3.1: ignored issues stay out unless asked for

        const where = issueConds.length ? sql.join(issueConds, sql` AND `) : sql`true`;
        type Row = { id: string; message_id: string | null; title_hit: boolean };
        let rows: Row[];
        if (hasText) {
          // Full text through the narrow SECURITY DEFINER functions (ADR-028: the index is unusable under RLS).
          const authors = f.from.length ? await authorsMatching(tx, f.from) : null;
          const json = (v: unknown) => sql`${JSON.stringify(v)}::jsonb`;
          const arr = (v: string[] | null) => (v === null ? sql`NULL::text[]` : sql`ARRAY(SELECT jsonb_array_elements_text(${json(v)}))`);
          const msgHits = (await tx.execute(sql`SELECT issue_id, message_id, rank FROM search_message_hits(${query.text}, ${f.is.includes("internal")},
              ${arr(authors ? authors.contacts : null)}, ${arr(authors ? authors.users : null)}, 5000)`)).rows as { issue_id: string; message_id: string; rank: number }[];
          const titleHits = needsMessage ? [] : (await tx.execute(sql`SELECT issue_id FROM search_issue_title_hits(${query.text}, 5000)`)).rows.map((r) => String(r.issue_id));
          if (msgHits.length + titleHits.length === 0) return { query, issues: [], accounts: await matchingAccounts(tx, query.text) };
          rows = (await tx.execute(sql`
            WITH mh AS (SELECT * FROM jsonb_to_recordset(${json(msgHits)}) AS t(issue_id text, message_id text, rank real)),
                 th AS (SELECT jsonb_array_elements_text(${json(titleHits)}) AS issue_id)
            SELECT i.id, mh.message_id, (th.issue_id IS NOT NULL) AS title_hit,
                   (CASE WHEN th.issue_id IS NOT NULL THEN 1 ELSE 0 END + coalesce(mh.rank, 0)) AS score
            FROM issues i LEFT JOIN mh ON mh.issue_id = i.id LEFT JOIN th ON th.issue_id = i.id
            WHERE i.id IN (SELECT issue_id FROM mh UNION SELECT issue_id FROM th) AND ${where}
            ORDER BY score DESC, i.updated_at DESC, i.id DESC
            LIMIT ${Math.min(Math.max(limit, 1), 50)}`)).rows as Row[];
        } else if (needsMessage) {
          // Message filters without text (from:, is:internal): author/visibility indexes work under RLS.
          rows = (await tx.execute(sql`
            WITH msg AS (SELECT DISTINCT ON (m.issue_id) m.issue_id, m.id AS message_id FROM messages m
                         WHERE ${sql.join(msgConds, sql` AND `)} ORDER BY m.issue_id, m.created_at DESC)
            SELECT i.id, msg.message_id, false AS title_hit FROM issues i JOIN msg ON msg.issue_id = i.id
            WHERE ${where} ORDER BY i.updated_at DESC, i.id DESC LIMIT ${Math.min(Math.max(limit, 1), 50)}`)).rows as Row[];
        } else {
          rows = (await tx.execute(sql`SELECT i.id, NULL AS message_id, false AS title_hit FROM issues i WHERE ${where}
            ORDER BY i.updated_at DESC, i.id DESC LIMIT ${Math.min(Math.max(limit, 1), 50)}`)).rows as Row[];
        }

        const issueRows = rows.length ? await tx.select().from(schema.issues).where(inArray(schema.issues.id, rows.map((r) => r.id))) : [];
        const byId = new Map(issueRows.map((r) => [r.id, r]));
        const dtos = await toDtos(tx, rows.map((r) => byId.get(r.id)!));
        const msgIds = rows.map((r) => r.message_id).filter((x): x is string => !!x);
        const snippets = new Map<string, string>();
        if (msgIds.length) {
          const headline = hasText
            ? sql`ts_headline('simple', m.body_text, ${tsq}, ${`StartSel=${HL_START}, StopSel=${HL_END}, MaxWords=24, MinWords=10, ShortWord=2, MaxFragments=1`})`
            : sql`left(m.body_text, 160)`;
          for (const r of (await tx.execute(sql`SELECT m.id, ${headline} AS snippet FROM messages m WHERE m.id IN (${sql.join(msgIds.map((x) => sql`${x}`), sql`, `)})`)).rows) {
            snippets.set(String(r.id), String(r.snippet));
          }
        }
        const issues = rows.map((r, idx) => ({
          issue: dtos[idx]!,
          match: { in: (r.title_hit ? "title" : r.message_id ? "message" : "filters") as "title" | "message" | "filters", message_id: r.message_id, snippet: r.message_id ? snippets.get(r.message_id) ?? null : null },
        }));

        const accounts = await matchingAccounts(tx, query.text);
        return { query, issues, accounts };
      });
    },
  };
}
