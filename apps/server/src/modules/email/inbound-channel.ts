import { createHash, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@tickzy/db";
import type { InboundChannel, StoredInboundEvent } from "../ingest/channel.ts";
import { recordInboundMessage } from "../messages/inbound.ts";
import { inboundRecipient, normalizeEmail, withoutAttachmentContent, type PostmarkInbound } from "./parse.ts";

/**
 * Email over Postmark inbound webhooks (T-302a, ADR-033, threat model §6.3).
 * - Authenticity: Postmark does not sign inbound webhooks; it recommends HTTP Basic credentials in the webhook URL
 *   (+ allow-listing its IP ranges at the edge). Both parts are compared in constant time.
 * - Routing: the address on our inbound domain (OriginalRecipient first, so mail forwarded from a customer's own
 *   support@ address works); plus-addressing carries the per-thread reply token.
 * - Threading: reply token → In-Reply-To/References (only for verified senders) → new thread. Automated mail that
 *   matches no thread is dropped (loop guard); on a thread it is stored but never reopens or changes status.
 */
export interface PostmarkInboundOptions { username: string; password: string; inboundDomain: string }

// Postmark caps attachments at 35 MB in total; base64 adds a third. Refusing larger bodies would make Postmark
// retry and finally drop the customer's email, so the limit is above what Postmark can send.
const MAX_BODY_BYTES = 50 * 1024 * 1024;
const digest = (s: string) => createHash("sha256").update(s).digest();
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

export function postmarkInboundChannel(opts: PostmarkInboundOptions): InboundChannel {
  return {
    kind: "email",
    maxBodyBytes: MAX_BODY_BYTES,

    verify({ headers }) {
      const header = String(headers.authorization ?? "");
      if (!header.startsWith("Basic ")) return false;
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
      const sep = decoded.indexOf(":");
      if (sep < 0) return false;
      // Both comparisons always run (no early exit that would reveal which part was wrong).
      const userOk = same(decoded.slice(0, sep), opts.username);
      const passOk = same(decoded.slice(sep + 1), opts.password);
      return userOk && passOk;
    },

    parse({ raw }) {
      const p = JSON.parse(raw.toString("utf8")) as PostmarkInbound;
      if (typeof p !== "object" || p === null || typeof p.MessageID !== "string" || !p.MessageID) throw new Error("not a Postmark inbound payload");
      const to = inboundRecipient(p, opts.inboundDomain);
      if (!to) return { kind: "ignore", reason: "no recipient on the inbound domain" };
      return {
        kind: "event", eventId: p.MessageID,
        route: { by: "endpoint", endpointKind: "email_address", externalId: to.address },
        payload: withoutAttachmentContent(p),
      };
    },

    async process(tx: Tx, ev: StoredInboundEvent) {
      const p = ev.payload as PostmarkInbound;
      const mail = normalizeEmail(p);
      if (!mail.from) return "ignored";
      const token = inboundRecipient(p, opts.inboundDomain)?.token ?? null;

      // 1. Reply token: unguessable, so it proves the reply belongs to the thread even for unverified senders.
      let conversation = token
        ? (await tx.select().from(schema.conversations).where(and(eq(schema.conversations.replyToken, token), eq(schema.conversations.channelKind, "email"))))[0]
        : undefined;
      // 2. Headers: only a verified sender may continue an existing thread this way (anyone can forge headers).
      let threadUnverified = false;
      if (!conversation && mail.replyTo.length) {
        const [earlier] = await tx.select({ conversationId: schema.messages.conversationId }).from(schema.messages)
          .where(and(eq(schema.messages.source, "email"), inArray(schema.messages.externalId, mail.replyTo)))
          .orderBy(desc(schema.messages.createdAt)).limit(1);
        if (earlier && mail.verified) {
          conversation = (await tx.select().from(schema.conversations).where(eq(schema.conversations.id, earlier.conversationId)))[0];
        } else if (earlier) {
          threadUnverified = true;
        }
      }
      // 3. Automated mail never starts an issue (loop guard).
      if (!conversation && mail.automated) return "ignored";

      const [endpoint] = ev.endpointId ? await tx.select().from(schema.channelEndpoints).where(eq(schema.channelEndpoints.id, ev.endpointId)) : [];
      await recordInboundMessage(tx, ev.workspaceId, {
        channel: "email",
        threadKey: conversation?.externalThreadKey ?? mail.messageId,
        conversationId: conversation?.id,
        endpointId: ev.endpointId,
        externalId: mail.messageId,
        sender: { kind: "email", key: mail.from.email, name: mail.from.name || undefined },
        body: mail.body || "(empty message)",
        title: mail.subject || undefined,
        endpointDefaultAccountId: endpoint?.defaultAccountId ?? null,
        automated: !!mail.automated,
        trustSenderDomain: mail.verified,
        meta: {
          subject: mail.subject,
          sender_verified: mail.verified,
          ...(mail.spam ? { spam: true } : {}),
          ...(mail.automated ? { automated_reason: mail.automated } : {}),
          ...(threadUnverified ? { thread_unverified: true } : {}),
          ...(mail.attachments.length ? { attachments: mail.attachments, attachments_imported: false } : {}),
        },
      });
      return "processed";
    },
  };
}
