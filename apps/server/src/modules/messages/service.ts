import { and, desc, eq } from "drizzle-orm";
import { AppError, newId } from "@tickzy/shared";
import { schema, withWorkspace, type ChannelKind, type Db, type Tx } from "@tickzy/db";
import type { MemberContext } from "../../http/auth.ts";
import { resolveIssueRef } from "../issues/service.ts";
import { applyMessageToIssue } from "../issues/domain.ts";
import { QUEUE_RETRY_LIMIT } from "../../jobs/queue.ts";
import type { DeliveryRegistry } from "./delivery.ts";

export interface MessageDto {
  id: string; issue_id: string | null; conversation_id: string;
  visibility: "public" | "internal"; direction: "in" | "out";
  author: { type: "contact" | "member" | "ai" | "system"; id: string | null; name: string | null };
  body: { text: string; ast: unknown };
  source: ChannelKind; delivery_state: "pending" | "sent" | "failed" | "received" | null;
  attachments: never[]; created_at: string;
}

type MessageRow = typeof schema.messages.$inferSelect;

async function authorName(tx: Tx, m: MessageRow): Promise<string | null> {
  if (!m.authorId) return null;
  if (m.authorType === "member") {
    const [u] = await tx.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, m.authorId));
    return u ? u.name || u.email : null;
  }
  if (m.authorType === "contact") {
    const [c] = await tx.select({ name: schema.contacts.name }).from(schema.contacts).where(eq(schema.contacts.id, m.authorId));
    return c?.name || null;
  }
  if (m.authorType === "system" && m.authorId.startsWith("tok_")) {
    const [tk] = await tx.select({ name: schema.apiTokens.name }).from(schema.apiTokens).where(eq(schema.apiTokens.id, m.authorId));
    return tk ? `API: ${tk.name}` : null;
  }
  return null;
}

async function toDto(tx: Tx, m: MessageRow): Promise<MessageDto> {
  return {
    id: m.id, issue_id: m.issueId, conversation_id: m.conversationId, visibility: m.visibility, direction: m.direction,
    author: { type: m.authorType, id: m.authorId, name: await authorName(tx, m) },
    body: { text: m.bodyText, ast: m.bodyAst ?? null }, source: m.source, delivery_state: m.deliveryState,
    attachments: [], created_at: m.createdAt.toISOString(),
  };
}

/** The conversation a reply belongs to: the issue's most recently active one, or a new one in the issue's channel. */
async function replyConversation(tx: Tx, workspaceId: string, issue: typeof schema.issues.$inferSelect) {
  const [latest] = await tx.select({ c: schema.conversations }).from(schema.messages)
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
    .where(eq(schema.messages.issueId, issue.id)).orderBy(desc(schema.messages.createdAt)).limit(1);
  if (latest) return latest.c;
  const [created] = await tx.insert(schema.conversations).values({ id: newId("conversation"), workspaceId, channelKind: issue.channelKind }).returning();
  return created!;
}

export interface PostMessageInput {
  body: string;
  visibility: "public" | "internal";
}

export function createMessagesService(db: Db, channels: DeliveryRegistry) {
  return {
    /**
     * Posts a reply (public) or internal note on an issue. Public replies on a channel with a delivery adapter are
     * queued (`pending`) via the outbox; internal notes are never queued — and the database refuses it anyway.
     * The caller checks the permission for the visibility (issues:reply / issues:note).
     */
    async post(ctx: MemberContext, issueRef: string, input: PostMessageInput): Promise<MessageDto> {
      return withWorkspace(db, ctx, async (tx) => {
        const issue = await resolveIssueRef(tx, issueRef);
        const conversation = await replyConversation(tx, ctx.workspaceId, issue);
        const deliverable = input.visibility === "public" && channels.adapterFor(conversation.channelKind) !== null;
        const now = new Date();
        const [m] = await tx.insert(schema.messages).values({
          id: newId("message"), workspaceId: ctx.workspaceId, conversationId: conversation.id, issueId: issue.id,
          direction: "out", visibility: input.visibility,
          authorType: ctx.actor.type === "user" ? "member" : "system", authorId: ctx.actor.id,
          bodyText: input.body, source: ctx.actor.type === "api_token" ? "api" : "ui",
          deliveryState: deliverable ? "pending" : null, createdAt: now,
        }).returning();
        await tx.update(schema.conversations).set({ lastMessageAt: now }).where(eq(schema.conversations.id, conversation.id));
        // T-206: a public reply hands the turn to the customer and stamps first response; notes change nothing.
        await applyMessageToIssue(tx, ctx.workspaceId, issue.id, input.visibility === "public" ? "team_public" : "team_internal", m!.id, now);
        await tx.insert(schema.outbox).values({
          workspaceId: ctx.workspaceId, type: "message.created",
          payload: { message_id: m!.id, issue_id: issue.id, visibility: input.visibility, deliver: deliverable },
        });
        return toDto(tx, m!);
      });
    },

    /** Re-queues a failed public message (FR-2.4: failures visible with retry). */
    async retry(ctx: MemberContext, messageId: string): Promise<MessageDto> {
      return withWorkspace(db, ctx, async (tx) => {
        const [m] = await tx.update(schema.messages).set({ deliveryState: "pending" })
          .where(and(eq(schema.messages.id, messageId), eq(schema.messages.deliveryState, "failed"), eq(schema.messages.visibility, "public")))
          .returning();
        if (!m) {
          const [exists] = await tx.select({ id: schema.messages.id }).from(schema.messages).where(eq(schema.messages.id, messageId));
          if (!exists) throw new AppError("not_found", "Message not found");
          throw new AppError("conflict", "Only failed messages can be retried");
        }
        await tx.insert(schema.outbox).values({ workspaceId: ctx.workspaceId, type: "message.retry_requested", payload: { message_id: m.id, issue_id: m.issueId, visibility: "public", deliver: true } });
        return toDto(tx, m);
      });
    },
  };
}

/**
 * Worker side (queue `deliver-message`): sends one pending public message through its channel adapter.
 * Idempotent: anything not public+pending is skipped, so replays and retries never double-send a delivered message.
 * On the final failed attempt the message is marked `failed` (visible, retryable) instead of retrying forever.
 */
export async function deliverPendingMessage(
  db: Db, channels: DeliveryRegistry,
  job: { workspaceId: string; messageId: string; retryCount: number },
  log: (msg: string, err?: unknown) => void = () => undefined,
): Promise<"sent" | "failed" | "skipped"> {
  const loaded = await withWorkspace(db, { workspaceId: job.workspaceId }, async (tx) => {
    const [row] = await tx.select({ m: schema.messages, c: schema.conversations }).from(schema.messages)
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
      .where(eq(schema.messages.id, job.messageId));
    return row;
  });
  if (!loaded || loaded.m.visibility !== "public" || loaded.m.deliveryState !== "pending") {
    if (loaded?.m.visibility === "internal") log(`refused to deliver internal note ${job.messageId}`);
    return "skipped";
  }
  const adapter = channels.adapterFor(loaded.c.channelKind);
  if (!adapter) return "skipped";
  try {
    const { externalId } = await adapter.deliver({
      workspaceId: job.workspaceId, messageId: loaded.m.id, conversationId: loaded.c.id, externalThreadKey: loaded.c.externalThreadKey,
      endpointId: loaded.c.endpointId, bodyText: loaded.m.bodyText, bodyAst: loaded.m.bodyAst,
    });
    await withWorkspace(db, { workspaceId: job.workspaceId }, (tx) =>
      tx.update(schema.messages).set({ deliveryState: "sent", externalId }).where(and(eq(schema.messages.id, loaded.m.id), eq(schema.messages.deliveryState, "pending"))));
    return "sent";
  } catch (err) {
    if (job.retryCount < QUEUE_RETRY_LIMIT) throw err; // let the queue retry with backoff
    log(`delivery of ${job.messageId} failed after ${job.retryCount + 1} attempts`, err);
    await withWorkspace(db, { workspaceId: job.workspaceId }, async (tx) => {
      await tx.update(schema.messages).set({ deliveryState: "failed" }).where(and(eq(schema.messages.id, loaded.m.id), eq(schema.messages.deliveryState, "pending")));
      await tx.insert(schema.outbox).values({ workspaceId: job.workspaceId, type: "message.delivery_failed", payload: { message_id: loaded.m.id, issue_id: loaded.m.issueId } });
    });
    return "failed";
  }
}

