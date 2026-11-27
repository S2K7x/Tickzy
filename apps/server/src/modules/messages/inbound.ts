import { and, desc, eq, isNotNull } from "drizzle-orm";
import { newId, notifies, type StatusCategory } from "@tickzy/shared";
import { schema, type ChannelKind, type Tx } from "@tickzy/db";
import { applyMessageToIssue, createIssue, issueKey, recordEvent, type Issue } from "../issues/domain.ts";
import { resolveContact, type IdentityKind } from "../customers/resolution.ts";
import { randomBase32 } from "../../lib/tokens.ts";

/**
 * Inbound customer messages (T-206; the entry point channel ingestion calls in M3). Runs in the caller's tenant
 * transaction. Steps: dedupe by provider id → resolve the sender to a contact (+ account) → find or open the
 * conversation → attach to its issue (or open one) → apply the whose-turn / reopen rules (FR-3.1, FR-3.2).
 */
export interface InboundMessage {
  channel: Exclude<ChannelKind, "api" | "ui">;
  /** Provider thread (Slack thread_ts, email root Message-ID) — messages in the same thread share an issue. */
  threadKey: string;
  endpointId?: string | null | undefined;
  /** Provider message id (Slack ts, email Message-ID): the dedupe key. */
  externalId: string;
  sender: { kind: IdentityKind; key: string; name?: string | undefined };
  body: string;
  /** Account of the channel endpoint (e.g. a Slack Connect channel mapped to one customer). */
  endpointDefaultAccountId?: string | null | undefined;
  receivedAt?: Date | undefined;
  /** Issue title when this message opens one (email: the subject); default: first meaningful line of the body. */
  title?: string | undefined;
  /** Continue this exact conversation (the channel already resolved the thread, e.g. by an email reply token). */
  conversationId?: string | undefined;
  /** Channel facts shown with the message (automated, unverified sender, spam, subject, attachments…). */
  meta?: Record<string, unknown> | undefined;
  /** Auto-replies, bounces, bulk mail: stored on the thread but never reopen, follow up or change status (FR-2.7). */
  automated?: boolean | undefined;
  /** False for unverified senders: no account mapping by the claimed email domain (threat model TM-6). */
  trustSenderDomain?: boolean | undefined;
}

export interface InboundResult {
  messageId: string;
  issueId: string;
  duplicate: boolean;
  /** What the message did: new issue, follow-up of a closed one, status change, or nothing. */
  effect: "issue_opened" | "followup_opened" | "status_changed" | "none";
  notify: boolean;
}

/** Issue title from the first meaningful line of the message. */
export function titleFrom(body: string, fallback: string): string {
  const greeting = /^(hi|hello|hey|dear|good (morning|afternoon|evening))\b[^.?!\n]{0,25}[,.!:]?$/i;
  const line = body.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0 && !(l.length <= 40 && greeting.test(l)));
  if (!line) return fallback;
  return line.length > 120 ? `${line.slice(0, 117).trimEnd()}…` : line;
}

export async function recordInboundMessage(tx: Tx, workspaceId: string, input: InboundMessage): Promise<InboundResult> {
  const now = input.receivedAt ?? new Date();
  const [dup] = await tx.select().from(schema.messages)
    .where(and(eq(schema.messages.source, input.channel), eq(schema.messages.externalId, input.externalId)));
  if (dup) return { messageId: dup.id, issueId: dup.issueId!, duplicate: true, effect: "none", notify: false };

  const contact = await resolveContact(tx, workspaceId, {
    kind: input.sender.kind, externalKey: input.sender.key, name: input.sender.name, defaultAccountId: input.endpointDefaultAccountId, trustDomain: input.trustSenderDomain,
  });

  let [conversation] = input.conversationId
    ? await tx.select().from(schema.conversations).where(eq(schema.conversations.id, input.conversationId))
    : await tx.select().from(schema.conversations).where(and(
      eq(schema.conversations.channelKind, input.channel), eq(schema.conversations.externalThreadKey, input.threadKey),
      input.endpointId ? eq(schema.conversations.endpointId, input.endpointId) : undefined,
    ));
  if (!conversation) {
    [conversation] = await tx.insert(schema.conversations).values({
      id: newId("conversation"), workspaceId, channelKind: input.channel, endpointId: input.endpointId ?? null, externalThreadKey: input.threadKey,
      // Email threads get an unguessable reply token for our Reply-To address (threat model TM-6).
      replyToken: input.channel === "email" ? randomBase32(20) : null,
    }).returning();
  }

  // The thread's current issue = the issue of its latest attached message.
  const [latest] = await tx.select({ issueId: schema.messages.issueId }).from(schema.messages)
    .where(and(eq(schema.messages.conversationId, conversation!.id), isNotNull(schema.messages.issueId)))
    .orderBy(desc(schema.messages.createdAt)).limit(1);
  let issue: Issue | undefined = latest?.issueId ? (await tx.select().from(schema.issues).where(eq(schema.issues.id, latest.issueId)))[0] : undefined;

  const contactActor = { type: "contact" as const, id: contact.contactId };
  const open = async (title: string) => createIssue(tx, workspaceId, contactActor, {
    title, channelKind: input.channel, accountId: contact.accountId, requesterContactId: contact.contactId,
  });

  let effect: InboundResult["effect"] = "none";
  const messageId = newId("message");
  if (!issue) {
    issue = await open(input.title?.trim() ? input.title.trim().slice(0, 300) : titleFrom(input.body, `Message from ${input.sender.name || input.sender.key}`));
    effect = "issue_opened";
  } else if (issue.statusCategory === "closed" && !input.automated) {
    // FR-3.1: a customer message on a closed issue starts a new issue, linked both ways on the timelines.
    const [ws] = await tx.select({ p: schema.workspaces.issuePrefix }).from(schema.workspaces).limit(1);
    const previous = issue;
    issue = await open(titleFrom(input.body, `Follow-up to ${issueKey(ws!.p, previous.number)}`));
    await recordEvent(tx, workspaceId, issue.id, "issue.followup_of", { type: "system", id: null }, { issue_id: previous.id, key: issueKey(ws!.p, previous.number) });
    await recordEvent(tx, workspaceId, previous.id, "issue.followup_opened", { type: "system", id: null }, { issue_id: issue.id, key: issueKey(ws!.p, issue.number) });
    effect = "followup_opened";
  }

  await tx.insert(schema.messages).values({
    id: messageId, workspaceId, conversationId: conversation!.id, issueId: issue.id, direction: "in", visibility: "public",
    authorType: "contact", authorId: contact.contactId, bodyText: input.body, source: input.channel, externalId: input.externalId,
    deliveryState: "received", createdAt: now, meta: { ...(input.meta ?? {}), ...(input.automated ? { automated: true } : {}) },
  });
  await tx.update(schema.conversations).set({ lastMessageAt: now }).where(eq(schema.conversations.id, conversation!.id));
  let category: StatusCategory = issue.statusCategory;
  if (!input.automated) {
    const applied = await applyMessageToIssue(tx, workspaceId, issue.id, "customer_public", messageId, now);
    if (effect === "none" && applied.outcome.action === "transition") effect = "status_changed";
    category = applied.issue.statusCategory;
  }
  // Automated mail never notifies (it is not a person waiting for an answer).
  const notify = !input.automated && notifies(category);
  await tx.insert(schema.outbox).values({ workspaceId, type: "message.created", payload: { message_id: messageId, issue_id: issue.id, visibility: "public", deliver: false, notify } });
  return { messageId, issueId: issue.id, duplicate: false, effect, notify };
}
