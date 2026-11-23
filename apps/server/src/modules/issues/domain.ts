import { and, eq, sql } from "drizzle-orm";
import { AppError, canTransition, newId, timestampsForTransition, type Priority, type StatusCategory } from "@tickzy/shared";
import { schema, type ChannelKind, type Tx } from "@tickzy/db";
import type { Actor } from "../../http/auth.ts";

/**
 * Issue domain operations (T-202). They run inside a caller-provided tenant transaction (withWorkspace) so API
 * handlers, channel ingestion (M3) and jobs share one implementation. Status rules come from @tickzy/shared.
 */
export type Issue = typeof schema.issues.$inferSelect;

export const issueKey = (prefix: string, number: number) => `${prefix}-${number}`;

/** The workspace's default status for a category (seeded per workspace; exactly one per category). */
export async function defaultStatusId(tx: Tx, category: StatusCategory): Promise<string> {
  const [row] = await tx
    .select({ id: schema.statuses.id })
    .from(schema.statuses)
    .where(and(eq(schema.statuses.category, category), eq(schema.statuses.isDefault, true)));
  if (!row) throw new Error(`workspace has no default status for ${category}`);
  return row.id;
}

async function event(tx: Tx, workspaceId: string, issueId: string, type: string, actor: Actor | { type: "system" | "ai" | "contact"; id: string | null }, data: Record<string, unknown>) {
  await tx.insert(schema.issueEvents).values({ workspaceId, issueId, type, actorType: actor.type, actorId: actor.id, data });
}

export interface CreateIssueInput {
  title: string;
  channelKind: ChannelKind;
  priority?: Priority | undefined;
  category?: StatusCategory | undefined;   // default: triage
  accountId?: string | null | undefined;
  requesterContactId?: string | null | undefined;
}

export async function createIssue(tx: Tx, workspaceId: string, actor: Actor | { type: "system" | "ai" | "contact"; id: string | null }, input: CreateIssueInput): Promise<Issue> {
  const category = input.category ?? "triage";
  const numberRes = await tx.execute(sql`SELECT next_issue_number() AS n`);
  const number = Number(numberRes.rows[0]?.n);
  if (!Number.isInteger(number) || number < 1) throw new Error("issue counter missing for workspace");
  const [issue] = await tx.insert(schema.issues).values({
    id: newId("issue"),
    workspaceId,
    number,
    title: input.title,
    statusCategory: category,
    statusId: await defaultStatusId(tx, category),
    priority: input.priority ?? "normal",
    channelKind: input.channelKind,
    accountId: input.accountId ?? null,
    requesterContactId: input.requesterContactId ?? null,
  }).returning();
  await event(tx, workspaceId, issue!.id, "issue.created", actor, { number, category, channel: input.channelKind });
  await tx.insert(schema.outbox).values({ workspaceId, type: "issue.created", payload: { issue_id: issue!.id, number } });
  return issue!;
}

/**
 * Manual status change. `statusId` may name a custom status; its category decides the lifecycle.
 * `expectedVersion` enables optimistic concurrency (409 when someone changed the issue meanwhile).
 */
export async function changeStatus(tx: Tx, workspaceId: string, actor: Actor, issueId: string, target: { statusId?: string; category?: StatusCategory }, opts: { expectedVersion?: number; now?: Date } = {}): Promise<Issue> {
  const [issue] = await tx.select().from(schema.issues).where(eq(schema.issues.id, issueId)).for("update");
  if (!issue) throw new AppError("not_found", "Issue not found");
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== issue.version) {
    throw new AppError("conflict", "The issue was changed by someone else. Reload and try again.");
  }
  let statusId: string;
  let category: StatusCategory;
  if (target.statusId) {
    const [st] = await tx.select().from(schema.statuses).where(eq(schema.statuses.id, target.statusId));
    if (!st || st.archivedAt) throw new AppError("validation_failed", "Unknown status", [{ path: "status_id", issue: "not found" }]);
    statusId = st.id;
    category = st.category;
  } else if (target.category) {
    category = target.category;
    statusId = await defaultStatusId(tx, category);
  } else {
    throw new AppError("validation_failed", "A status or category is required");
  }
  if (statusId === issue.statusId) return issue;
  if (category !== issue.statusCategory && !canTransition(issue.statusCategory, category)) {
    throw new AppError("conflict", issue.statusCategory === "closed" ? "Closed issues cannot be reopened; a follow-up opens a new issue." : "Status change not allowed");
  }
  const now = opts.now ?? new Date();
  const clock = category === issue.statusCategory ? {} : timestampsForTransition({
    status_category: issue.statusCategory, first_response_at: issue.firstResponseAt, resolved_at: issue.resolvedAt,
    closed_at: issue.closedAt, last_customer_message_at: issue.lastCustomerMessageAt, last_team_message_at: issue.lastTeamMessageAt,
  }, category, now);
  const [updated] = await tx.update(schema.issues).set({
    statusId,
    statusCategory: category,
    ...("resolved_at" in clock ? { resolvedAt: clock.resolved_at ?? null } : {}),
    ...("closed_at" in clock ? { closedAt: clock.closed_at ?? null } : {}),
    updatedAt: now,
    version: issue.version + 1,
  }).where(eq(schema.issues.id, issueId)).returning();
  await event(tx, workspaceId, issueId, "issue.status_changed", actor, {
    from: { category: issue.statusCategory, status_id: issue.statusId }, to: { category, status_id: statusId }, reason: "manual",
  });
  await tx.insert(schema.outbox).values({ workspaceId, type: "issue.updated", payload: { issue_id: issueId, fields: ["status"] } });
  return updated!;
}
