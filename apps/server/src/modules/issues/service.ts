import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { AppError, type Priority, type StatusCategory } from "@tickzy/shared";
import { schema, withWorkspace, type ChannelKind, type Db, type Tx } from "@tickzy/db";
import type { MemberContext } from "../../http/auth.ts";
import { can } from "../../permissions.ts";
import { validateCustom } from "../../lib/custom-fields.ts";
import { after, decodeKeyset, encodeKeyset, type KeyColumn } from "../../lib/keyset.ts";
import { changeStatus, createIssue, issueKey, recordEvent, type Issue } from "./domain.ts";
import { authorName } from "../messages/service.ts";

export interface IssueDto {
  id: string; key: string; number: number; title: string;
  status: { category: StatusCategory; id: string; name: string };
  priority: Priority;
  assignee: { membership_id: string; user_id: string; name: string; email: string } | null;
  team_id: string | null;
  account: { id: string; name: string; tier: string | null } | null;
  requester: { id: string; name: string } | null;
  channel: ChannelKind; product_area: string | null;
  labels: { id: string; name: string; color: string }[];
  fields: Record<string, unknown>;
  sla: never[];
  first_response_at: string | null; resolved_at: string | null;
  created_at: string; updated_at: string; version: number;
}

export interface IssueFields {
  title?: string | undefined; priority?: Priority | undefined;
  assignee_membership_id?: string | null | undefined; team_id?: string | null | undefined;
  account_id?: string | null | undefined; requester_contact_id?: string | null | undefined;
  product_area?: string | null | undefined; labels?: string[] | undefined; custom?: Record<string, unknown> | undefined;
}

export const SORTS = ["updated", "newest", "oldest", "priority"] as const;
export type Sort = (typeof SORTS)[number];
export interface ListQuery {
  status?: StatusCategory[] | undefined; status_id?: string | undefined; assignee?: string | undefined; team?: string | undefined;
  account?: string | undefined; priority?: Priority[] | undefined; channel?: ChannelKind[] | undefined; label?: string | undefined;
  q?: string | undefined; sort?: Sort | undefined; cursor?: string | undefined; limit?: number | undefined;
}

const PRIORITY_RANK = sql<number>`CASE ${schema.issues.priority} WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END`;
const UPDATED_TEXT = sql<string>`${schema.issues.updatedAt}::text`;
const sortColumns = (sort: Sort): KeyColumn[] => {
  switch (sort) {
    case "updated": return [{ expr: schema.issues.updatedAt, dir: "desc" }, { expr: schema.issues.id, dir: "desc" }];
    case "newest": return [{ expr: schema.issues.id, dir: "desc" }];   // ULIDs are time-ordered: exact keyset
    case "oldest": return [{ expr: schema.issues.id, dir: "asc" }];
    case "priority": return [{ expr: PRIORITY_RANK, dir: "asc" }, { expr: schema.issues.id, dir: "desc" }];
  }
};
const order = (cols: KeyColumn[]) => cols.map((c) => (c.dir === "asc" ? asc(c.expr as SQLWrapper as never) : desc(c.expr as SQLWrapper as never)));
const likeEscape = (s: string) => s.replace(/[%_\\]/g, "\\$&");

async function workspacePrefix(tx: Tx): Promise<string> {
  const [w] = await tx.select({ p: schema.workspaces.issuePrefix }).from(schema.workspaces).limit(1);
  return w!.p;
}

/** Accepts `iss_…`, `ACME-12` (the workspace's prefix, any case) or `12`. */
export async function resolveIssueRef(tx: Tx, ref: string): Promise<Issue> {
  let where: SQL;
  if (ref.startsWith("iss_")) where = eq(schema.issues.id, ref);
  else {
    const m = /^(?:([A-Za-z]{2,5})-)?(\d{1,9})$/.exec(ref);
    if (!m) throw new AppError("not_found", "Issue not found");
    if (m[1] && m[1].toUpperCase() !== (await workspacePrefix(tx))) throw new AppError("not_found", "Issue not found");
    where = eq(schema.issues.number, Number(m[2]));
  }
  const [issue] = await tx.select().from(schema.issues).where(where);
  if (!issue) throw new AppError("not_found", "Issue not found");
  return issue;
}

export async function toDtos(tx: Tx, rows: Issue[]): Promise<IssueDto[]> {
  if (rows.length === 0) return [];
  const prefix = await workspacePrefix(tx);
  const ids = rows.map((r) => r.id);
  const uniq = <T>(xs: (T | null)[]) => [...new Set(xs.filter((x): x is T => x !== null))];
  const statuses = await tx.select().from(schema.statuses).where(inArray(schema.statuses.id, uniq(rows.map((r) => r.statusId))));
  const memberIds = uniq(rows.map((r) => r.assigneeMembershipId));
  const members = memberIds.length ? await tx.select({ id: schema.memberships.id, userId: schema.users.id, name: schema.users.name, email: schema.users.email })
    .from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(inArray(schema.memberships.id, memberIds)) : [];
  const accountIds = uniq(rows.map((r) => r.accountId));
  const accounts = accountIds.length ? await tx.select().from(schema.accounts).where(inArray(schema.accounts.id, accountIds)) : [];
  const contactIds = uniq(rows.map((r) => r.requesterContactId));
  const contacts = contactIds.length ? await tx.select().from(schema.contacts).where(inArray(schema.contacts.id, contactIds)) : [];
  const labels = await tx.select({ issueId: schema.issueLabels.issueId, id: schema.labels.id, name: schema.labels.name, color: schema.labels.color })
    .from(schema.issueLabels).innerJoin(schema.labels, eq(schema.labels.id, schema.issueLabels.labelId))
    .where(inArray(schema.issueLabels.issueId, ids)).orderBy(asc(schema.labels.name));
  const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
  const [S, M, A, C] = [byId(statuses), byId(members), byId(accounts), byId(contacts)];
  return rows.map((r) => {
    const st = S.get(r.statusId)!;
    const m = r.assigneeMembershipId ? M.get(r.assigneeMembershipId) : undefined;
    const a = r.accountId ? A.get(r.accountId) : undefined;
    const c = r.requesterContactId ? C.get(r.requesterContactId) : undefined;
    return {
      id: r.id, key: issueKey(prefix, r.number), number: r.number, title: r.title,
      status: { category: r.statusCategory, id: st.id, name: st.name }, priority: r.priority,
      assignee: m ? { membership_id: m.id, user_id: m.userId, name: m.name, email: m.email } : null,
      team_id: r.teamId,
      account: a ? { id: a.id, name: a.name, tier: a.tier } : null,
      requester: c ? { id: c.id, name: c.name } : null,
      channel: r.channelKind, product_area: r.productArea,
      labels: labels.filter((l) => l.issueId === r.id).map(({ id, name, color }) => ({ id, name, color })),
      fields: r.custom, sla: [],
      first_response_at: r.firstResponseAt?.toISOString() ?? null, resolved_at: r.resolvedAt?.toISOString() ?? null,
      created_at: r.createdAt.toISOString(), updated_at: r.updatedAt.toISOString(), version: r.version,
    };
  });
}

/** Validates references with friendly 422s (composite FKs already guarantee they are in this workspace). */
async function checkRefs(tx: Tx, f: IssueFields) {
  const bad = (path: string, issue: string) => { throw new AppError("validation_failed", "Invalid issue fields", [{ path, issue }]); };
  if (f.assignee_membership_id) {
    const [m] = await tx.select().from(schema.memberships).where(eq(schema.memberships.id, f.assignee_membership_id));
    if (!m || m.status !== "active") bad("assignee_membership_id", "not an active member");
    if (!can(m!.role, "issues:write")) bad("assignee_membership_id", "this member's role cannot be assigned issues");
  }
  if (f.team_id) {
    const [tm] = await tx.select().from(schema.teams).where(and(eq(schema.teams.id, f.team_id), isNull(schema.teams.archivedAt)));
    if (!tm) bad("team_id", "not found");
  }
  if (f.account_id) {
    const [a] = await tx.select().from(schema.accounts).where(and(eq(schema.accounts.id, f.account_id), isNull(schema.accounts.deletedAt)));
    if (!a) bad("account_id", "not found");
  }
  if (f.requester_contact_id) {
    const [c] = await tx.select().from(schema.contacts).where(and(eq(schema.contacts.id, f.requester_contact_id), isNull(schema.contacts.deletedAt)));
    if (!c) bad("requester_contact_id", "not found");
  }
  if (f.labels?.length) {
    const found = await tx.select({ id: schema.labels.id }).from(schema.labels).where(and(inArray(schema.labels.id, f.labels), isNull(schema.labels.archivedAt)));
    const missing = f.labels.filter((id) => !found.some((l) => l.id === id));
    if (missing.length) bad("labels", `unknown labels: ${missing.join(", ")}`);
  }
}

async function customDefs(tx: Tx) {
  return tx.select({ key: schema.customFieldDefs.key, type: schema.customFieldDefs.type, options: schema.customFieldDefs.options, required: schema.customFieldDefs.required, archivedAt: schema.customFieldDefs.archivedAt })
    .from(schema.customFieldDefs).where(eq(schema.customFieldDefs.entity, "issue"));
}

async function setLabels(tx: Tx, workspaceId: string, issueId: string, labels: string[]): Promise<{ added: string[]; removed: string[] }> {
  const current = (await tx.select({ id: schema.issueLabels.labelId }).from(schema.issueLabels).where(eq(schema.issueLabels.issueId, issueId))).map((l) => l.id);
  const wanted = [...new Set(labels)];
  const removed = current.filter((l) => !wanted.includes(l));
  const added = wanted.filter((l) => !current.includes(l));
  if (removed.length) await tx.delete(schema.issueLabels).where(and(eq(schema.issueLabels.issueId, issueId), inArray(schema.issueLabels.labelId, removed)));
  if (added.length) await tx.insert(schema.issueLabels).values(added.map((labelId) => ({ workspaceId, issueId, labelId })));
  return { added, removed };
}

export type UpdateInput = IssueFields & {
  status_id?: string | undefined; status?: StatusCategory | undefined; version?: number | undefined;
  /** Bulk-friendly label edits, applied on top of the current set (after `labels` if both are given). */
  add_labels?: string[] | undefined; remove_labels?: string[] | undefined;
};
export type BulkInput = Omit<UpdateInput, "version" | "title" | "custom" | "requester_contact_id" | "account_id" | "labels">;
export type BulkResult = { ref: string; ok: true; issue: IssueDto } | { ref: string; ok: false; error: { code: string; message: string } };

async function applyUpdate(tx: Tx, ctx: MemberContext, ref: string, input: UpdateInput): Promise<IssueDto> {
  const found = await resolveIssueRef(tx, ref);
  const [issue] = await tx.select().from(schema.issues).where(eq(schema.issues.id, found.id)).for("update");
  if (input.version !== undefined && input.version !== issue!.version) throw new AppError("conflict", "The issue was changed by someone else. Reload and try again.");
  await checkRefs(tx, input);
  if (input.add_labels?.length) await checkRefs(tx, { labels: input.add_labels });
  let current = issue!;
  if (input.status_id || input.status) {
    current = await changeStatus(tx, ctx.workspaceId, ctx.actor, current.id, { ...(input.status_id ? { statusId: input.status_id } : {}), ...(input.status ? { category: input.status } : {}) });
  }
  const set: Partial<typeof schema.issues.$inferInsert> = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const field = <K extends keyof typeof current>(name: string, key: K, value: (typeof current)[K] | undefined) => {
    if (value === undefined || value === current[key]) return;
    changes[name] = { from: current[key], to: value };
    (set as Record<string, unknown>)[key as string] = value;
  };
  field("title", "title", input.title);
  field("priority", "priority", input.priority);
  field("team_id", "teamId", input.team_id);
  field("account_id", "accountId", input.account_id);
  field("requester_contact_id", "requesterContactId", input.requester_contact_id);
  field("product_area", "productArea", input.product_area);
  if (input.custom !== undefined) {
    const merged = validateCustom(await customDefs(tx), current.custom, input.custom);
    if (JSON.stringify(merged) !== JSON.stringify(current.custom)) { changes.fields = { from: current.custom, to: merged }; set.custom = merged; }
  }
  const reassigned = input.assignee_membership_id !== undefined && input.assignee_membership_id !== current.assigneeMembershipId;
  if (reassigned) set.assigneeMembershipId = input.assignee_membership_id;
  let labelDiff: { added: string[]; removed: string[] } = { added: [], removed: [] };
  if (input.labels !== undefined || input.add_labels?.length || input.remove_labels?.length) {
  const base = input.labels ?? (await tx.select({ id: schema.issueLabels.labelId }).from(schema.issueLabels).where(eq(schema.issueLabels.issueId, current.id))).map((l) => l.id);
  const remove = new Set(input.remove_labels ?? []);
  labelDiff = await setLabels(tx, ctx.workspaceId, current.id, [...base, ...(input.add_labels ?? [])].filter((l) => !remove.has(l)));
}
  const touched = Object.keys(set).length > 0 || labelDiff.added.length + labelDiff.removed.length > 0;
  if (touched) {
    await tx.update(schema.issues).set({ ...set, updatedAt: new Date(), version: current.version + 1 }).where(eq(schema.issues.id, current.id));
    if (reassigned) await recordEvent(tx, ctx.workspaceId, current.id, "issue.assigned", ctx.actor, { from: current.assigneeMembershipId, to: input.assignee_membership_id });
    if (Object.keys(changes).length) await recordEvent(tx, ctx.workspaceId, current.id, "issue.updated", ctx.actor, { changes });
    if (labelDiff.added.length + labelDiff.removed.length) await recordEvent(tx, ctx.workspaceId, current.id, "issue.labels_changed", ctx.actor, labelDiff);
    await tx.insert(schema.outbox).values({ workspaceId: ctx.workspaceId, type: "issue.updated", payload: { issue_id: current.id, fields: [...Object.keys(changes), ...(reassigned ? ["assignee"] : []), ...(labelDiff.added.length + labelDiff.removed.length ? ["labels"] : [])] } });
  }
  const [fresh] = await tx.select().from(schema.issues).where(eq(schema.issues.id, current.id));
  return (await toDtos(tx, [fresh!]))[0]!;
}

export interface IssueStats {
  counts: { open: number; waiting_on_us: number; waiting_on_customer: number; mine: number | null; unassigned: number; done: number };
  kpis: {
    new_today: number; new_yesterday: number;
    waiting_on_us: number; avg_wait_seconds: number | null;
    waiting_on_customer: number;
    resolved_7d: number; resolved_prev_7d: number;
    median_first_response_seconds_7d: number | null;
  };
  /** Last 14 UTC days, oldest first. */
  series: { day: string; created: number; resolved: number; first_responses: number; customer_messages: number; team_replies: number }[];
}

export function createIssuesService(db: Db) {
  return {
    /** Real counts and 14-day series for the Overview and inbox tabs (UTC days until workspace time zones, M4). Ignored issues are excluded (FR-3.1). */
    async stats(ctx: MemberContext): Promise<IssueStats> {
      return withWorkspace(db, ctx, async (tx) => {
        let mineId: string | null = null;
        if (ctx.userId) {
          const [m] = await tx.select({ id: schema.memberships.id }).from(schema.memberships).where(eq(schema.memberships.userId, ctx.userId));
          mineId = m?.id ?? null;
        }
        const OPEN = sql`status_category IN ('triage','waiting_on_us','waiting_on_customer','blocked')`;
        const c = (await tx.execute(sql`SELECT
            count(*) FILTER (WHERE ${OPEN})::int AS open,
            count(*) FILTER (WHERE status_category IN ('triage','waiting_on_us'))::int AS on_us,
            count(*) FILTER (WHERE status_category = 'waiting_on_customer')::int AS on_customer,
            count(*) FILTER (WHERE ${OPEN} AND assignee_membership_id = ${mineId ?? ""})::int AS mine,
            count(*) FILTER (WHERE ${OPEN} AND assignee_membership_id IS NULL)::int AS unassigned,
            count(*) FILTER (WHERE status_category IN ('resolved','closed'))::int AS done,
            count(*) FILTER (WHERE status_category <> 'ignored' AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS new_today,
            count(*) FILTER (WHERE status_category <> 'ignored' AND created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '1 day') AT TIME ZONE 'UTC'
                             AND created_at < date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS new_yesterday,
            extract(epoch FROM avg(now() - coalesce(last_customer_message_at, created_at)) FILTER (WHERE status_category IN ('triage','waiting_on_us')))::float AS avg_wait,
            count(*) FILTER (WHERE resolved_at >= now() - interval '7 days')::int AS resolved_7d,
            count(*) FILTER (WHERE resolved_at >= now() - interval '14 days' AND resolved_at < now() - interval '7 days')::int AS resolved_prev_7d,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM first_response_at - created_at))
              FILTER (WHERE first_response_at >= now() - interval '7 days')::float AS median_frt
          FROM issues`)).rows[0] as Record<string, number | null>;
        const series = (await tx.execute(sql`
          WITH days AS (SELECT generate_series(date_trunc('day', now() AT TIME ZONE 'UTC') - interval '13 days', date_trunc('day', now() AT TIME ZONE 'UTC'), interval '1 day') AS d)
          SELECT to_char(d, 'YYYY-MM-DD') AS day,
            (SELECT count(*) FROM issues i WHERE i.status_category <> 'ignored' AND (i.created_at AT TIME ZONE 'UTC') >= d AND (i.created_at AT TIME ZONE 'UTC') < d + interval '1 day')::int AS created,
            (SELECT count(*) FROM issues i WHERE (i.resolved_at AT TIME ZONE 'UTC') >= d AND (i.resolved_at AT TIME ZONE 'UTC') < d + interval '1 day')::int AS resolved,
            (SELECT count(*) FROM issues i WHERE (i.first_response_at AT TIME ZONE 'UTC') >= d AND (i.first_response_at AT TIME ZONE 'UTC') < d + interval '1 day')::int AS first_responses,
            (SELECT count(*) FROM messages m WHERE m.direction = 'in' AND (m.created_at AT TIME ZONE 'UTC') >= d AND (m.created_at AT TIME ZONE 'UTC') < d + interval '1 day')::int AS customer_messages,
            (SELECT count(*) FROM messages m WHERE m.direction = 'out' AND m.visibility = 'public' AND (m.created_at AT TIME ZONE 'UTC') >= d AND (m.created_at AT TIME ZONE 'UTC') < d + interval '1 day')::int AS team_replies
          FROM days ORDER BY d`)).rows as IssueStats["series"];
        const n = (v: unknown) => Number(v ?? 0);
        return {
          counts: { open: n(c.open), waiting_on_us: n(c.on_us), waiting_on_customer: n(c.on_customer), mine: mineId ? n(c.mine) : null, unassigned: n(c.unassigned), done: n(c.done) },
          kpis: {
            new_today: n(c.new_today), new_yesterday: n(c.new_yesterday),
            waiting_on_us: n(c.on_us), avg_wait_seconds: c.avg_wait === null ? null : Math.round(Number(c.avg_wait)),
            waiting_on_customer: n(c.on_customer),
            resolved_7d: n(c.resolved_7d), resolved_prev_7d: n(c.resolved_prev_7d),
            median_first_response_seconds_7d: c.median_frt === null ? null : Math.round(Number(c.median_frt)),
          },
          series: series.map((r) => ({ day: r.day, created: n(r.created), resolved: n(r.resolved), first_responses: n(r.first_responses), customer_messages: n(r.customer_messages), team_replies: n(r.team_replies) })),
        };
      });
    },

    async create(ctx: MemberContext, input: IssueFields & { title: string; category?: StatusCategory | undefined }): Promise<IssueDto> {
      return withWorkspace(db, ctx, async (tx) => {
        await checkRefs(tx, input);
        const custom = validateCustom(await customDefs(tx), {}, input.custom);
        const issue = await createIssue(tx, ctx.workspaceId, ctx.actor, {
          title: input.title, channelKind: ctx.actor.type === "api_token" ? "api" : "ui", priority: input.priority, category: input.category,
          accountId: input.account_id, requesterContactId: input.requester_contact_id,
        });
        const extra: Partial<typeof schema.issues.$inferInsert> = { custom };
        if (input.assignee_membership_id) extra.assigneeMembershipId = input.assignee_membership_id;
        if (input.team_id) extra.teamId = input.team_id;
        if (input.product_area) extra.productArea = input.product_area;
        await tx.update(schema.issues).set(extra).where(eq(schema.issues.id, issue.id));
        if (input.labels?.length) await setLabels(tx, ctx.workspaceId, issue.id, input.labels);
        if (input.assignee_membership_id) await recordEvent(tx, ctx.workspaceId, issue.id, "issue.assigned", ctx.actor, { from: null, to: input.assignee_membership_id });
        const [fresh] = await tx.select().from(schema.issues).where(eq(schema.issues.id, issue.id));
        return (await toDtos(tx, [fresh!]))[0]!;
      });
    },

    async list(ctx: MemberContext, q: ListQuery): Promise<{ data: IssueDto[]; next_cursor: string | null }> {
      const limit = Math.min(q.limit ?? 50, 100);
      const sort = q.sort ?? "updated";
      const cols = sortColumns(sort);
      return withWorkspace(db, ctx, async (tx) => {
        const conds: (SQL | undefined)[] = [];
        if (q.status?.length) conds.push(inArray(schema.issues.statusCategory, q.status));
        if (q.status_id) conds.push(eq(schema.issues.statusId, q.status_id));
        if (q.assignee === "none") conds.push(isNull(schema.issues.assigneeMembershipId));
        else if (q.assignee === "me") {
          if (!ctx.userId) throw new AppError("validation_failed", "assignee=me needs a signed-in user", [{ path: "assignee", issue: "not available to API tokens" }]);
          const [m] = await tx.select({ id: schema.memberships.id }).from(schema.memberships).where(eq(schema.memberships.userId, ctx.userId));
          conds.push(eq(schema.issues.assigneeMembershipId, m?.id ?? ""));
        } else if (q.assignee) conds.push(eq(schema.issues.assigneeMembershipId, q.assignee));
        if (q.team) conds.push(eq(schema.issues.teamId, q.team));
        if (q.account) conds.push(eq(schema.issues.accountId, q.account));
        if (q.priority?.length) conds.push(inArray(schema.issues.priority, q.priority));
        if (q.channel?.length) conds.push(inArray(schema.issues.channelKind, q.channel));
        if (q.label) conds.push(sql`EXISTS (SELECT 1 FROM issue_labels il WHERE il.issue_id = ${schema.issues.id} AND il.label_id = ${q.label})`);
        const term = q.q?.trim();
        if (term) {
          const key = /^(?:[A-Za-z]{2,5}-)?(\d{1,9})$/.exec(term);
          conds.push(or(ilike(schema.issues.title, `%${likeEscape(term)}%`), key ? eq(schema.issues.number, Number(key[1])) : undefined));
        }
        const cursor = decodeKeyset(q.cursor, cols.length);
        if (cursor) conds.push(after(cols, cursor));
        const rows = await tx.select({ issue: schema.issues, updatedText: UPDATED_TEXT, rank: PRIORITY_RANK })
          .from(schema.issues).where(and(...conds)).orderBy(...order(cols)).limit(limit + 1);
        const page = rows.slice(0, limit);
        const last = page.at(-1);
        const keyOf = (r: (typeof rows)[number]): (string | number)[] => {
          switch (sort) {
            case "updated": return [r.updatedText, r.issue.id];
            case "priority": return [Number(r.rank), r.issue.id];
            default: return [r.issue.id];
          }
        };
        return { data: await toDtos(tx, page.map((r) => r.issue)), next_cursor: rows.length > limit && last ? encodeKeyset(keyOf(last)) : null };
      });
    },

    get: (ctx: MemberContext, ref: string) => withWorkspace(db, ctx, async (tx) => (await toDtos(tx, [await resolveIssueRef(tx, ref)]))[0]!),

    /** Partial update; each kind of change is recorded on the timeline. `version` (optional) guards concurrent edits. */
    update: (ctx: MemberContext, ref: string, input: UpdateInput): Promise<IssueDto> => withWorkspace(db, ctx, (tx) => applyUpdate(tx, ctx, ref, input)),

    /**
     * Same change applied to up to 100 issues (FR-3.10). Each issue runs in its own savepoint, so one refusal (e.g. a
     * status move the lifecycle forbids, or an issue someone else deleted) is reported without undoing the others.
     */
    async bulkUpdate(ctx: MemberContext, refs: string[], input: BulkInput): Promise<{ results: BulkResult[] }> {
      return withWorkspace(db, ctx, async (tx) => {
        // Request-wide problems (unknown label, unassignable member…) fail the whole request with a 422, not per issue.
        await checkRefs(tx, { ...input, labels: input.add_labels });
        const results: BulkResult[] = [];
        for (const ref of [...new Set(refs)]) {
          try {
            const issue = await tx.transaction((sp) => applyUpdate(sp, ctx, ref, input));
            results.push({ ref, ok: true, issue });
          } catch (err) {
            if (!(err instanceof AppError)) throw err;
            results.push({ ref, ok: false, error: { code: err.code, message: err.message } });
          }
        }
        return { results };
      });
    },

    /** Messages and events in chronological order (FR-3.1 timeline). Capped; paging arrives with long-lived issues. */
    async timeline(ctx: MemberContext, ref: string) {
      const CAP = 1000;
      return withWorkspace(db, ctx, async (tx) => {
        const issue = await resolveIssueRef(tx, ref);
        const msgs = await tx.select().from(schema.messages).where(and(eq(schema.messages.issueId, issue.id), isNull(schema.messages.deletedAt))).orderBy(asc(schema.messages.createdAt)).limit(CAP + 1);
        const evts = await tx.select().from(schema.issueEvents).where(eq(schema.issueEvents.issueId, issue.id)).orderBy(asc(schema.issueEvents.id)).limit(CAP + 1);
        const names = new Map<string, string | null>();
        for (const m of msgs) {
          const k = `${m.authorType}:${m.authorId}`;
          if (!names.has(k)) names.set(k, await authorName(tx, m));
        }
        const items = [
          ...msgs.map((m) => ({ kind: "message" as const, id: m.id, created_at: m.createdAt.toISOString(), message: {
            id: m.id, visibility: m.visibility, direction: m.direction, author: { type: m.authorType, id: m.authorId, name: names.get(`${m.authorType}:${m.authorId}`) ?? null }, body: { text: m.bodyText, ast: m.bodyAst },
            source: m.source, delivery_state: m.deliveryState, edited_at: m.editedAt?.toISOString() ?? null,
          } })),
          ...evts.map((e) => ({ kind: "event" as const, id: String(e.id), created_at: e.createdAt.toISOString(), event: { type: e.type, actor: { type: e.actorType, id: e.actorId }, data: e.data } })),
        ].sort((a, b) => a.created_at.localeCompare(b.created_at) || (a.kind === b.kind ? 0 : a.kind === "event" ? -1 : 1));
        return { data: items.slice(0, CAP), truncated: msgs.length > CAP || evts.length > CAP || items.length > CAP };
      });
    },
  };
}

