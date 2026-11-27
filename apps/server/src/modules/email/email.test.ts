import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { newId } from "@tickzy/shared";
import { schema, withWorkspace } from "@tickzy/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.ts";
import { auth, setupTestApp, testConfig } from "../../test-helpers.ts";
import { createIngestRegistry } from "../ingest/channel.ts";
import { processInboundEvent } from "../ingest/processor.ts";
import { postmarkInboundChannel } from "./inbound-channel.ts";
import type { PostmarkInbound } from "./parse.ts";

/** T-302a: email inbound end to end — Postmark webhook → ingest → processor → issues (ADR-033, threat model §6.3). */
const DOMAIN = "inbound.tickzy.test";
const USER = "postmark-inbound";
const PASS = "a-very-long-random-webhook-password-123";
const registry = createIngestRegistry([postmarkInboundChannel({ inboundDomain: DOMAIN, username: USER, password: PASS })]);
let t: Awaited<ReturnType<typeof setupTestApp>>;
let app: FastifyInstance;
let alice: string; let bob: string;
let ws: string; let otherWs: string;
let address = ""; let globexAccount = "";
let seq = 0;

const basic = (u = USER, p = PASS) => `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`;
function mail(over: Partial<PostmarkInbound> & { headers?: Record<string, string>; to?: string } = {}): PostmarkInbound {
  const { headers, to, ...rest } = over;
  seq++;
  return {
    MessageID: `pm-${seq}-${Date.now()}`,
    FromFull: { Email: "hank@globex.com", Name: "Hank Scorpio", MailboxHash: "" },
    ToFull: [{ Email: "support@acme.test", Name: "", MailboxHash: "" }],
    OriginalRecipient: to ?? address,
    Subject: "Export fails",
    TextBody: "Our CSV export times out.",
    HtmlBody: "",
    Headers: Object.entries({ "Message-ID": `<msg-${seq}@globex.com>`, "X-Spam-Status": "No", "X-Spam-Tests": "DKIM_SIGNED,DKIM_VALID,DKIM_VALID_AU,SPF_PASS", ...headers })
      .map(([Name, Value]) => ({ Name, Value })),
    Attachments: [],
    ...rest,
  };
}
const post = (payload: unknown, authz = basic()) => app.inject({ method: "POST", url: "/ingest/email", payload: JSON.stringify(payload), headers: { "content-type": "application/json", authorization: authz } });
/** Delivers a mail through the webhook and processes it like the worker would. */
async function deliver(p: PostmarkInbound, workspace = ws) {
  const res = await post(p);
  expect(res.statusCode).toBe(200);
  const [ev] = await withWorkspace(t.database.db, { workspaceId: workspace }, (tx) => tx.select().from(schema.inboundEvents).where(eq(schema.inboundEvents.providerEventId, p.MessageID!)));
  if (ev) await processInboundEvent(t.database.db, registry, { workspaceId: workspace, inboundEventId: ev.id, finalAttempt: true }, () => undefined);
  return ev ? (await withWorkspace(t.database.db, { workspaceId: workspace }, (tx) => tx.select().from(schema.inboundEvents).where(eq(schema.inboundEvents.id, ev.id))))[0] : undefined;
}
const messageOf = async (rfcId: string) => (await withWorkspace(t.database.db, { workspaceId: ws }, (tx) => tx.select().from(schema.messages).where(eq(schema.messages.externalId, rfcId))))[0];
const issue = async (id: string) => (await app.inject({ url: `/v1/issues/${id}`, headers: auth(alice, ws) })).json();

beforeAll(async () => {
  t = await setupTestApp();
  app = await buildApp({ config: { ...testConfig, INBOUND_EMAIL_DOMAIN: DOMAIN }, database: t.database, email: t.email, ingest: registry });
  alice = await t.createUser("alice@example.com");
  bob = await t.createUser("bob@example.com");
  const mk = async (slug: string, prefix: string) => (await app.inject({ method: "POST", url: "/v1/workspaces", headers: auth(alice), payload: { name: slug, slug, issue_prefix: prefix } })).json().id as string;
  ws = await mk("acme", "ACME");
  otherWs = await mk("other", "OTH");
  await withWorkspace(t.database.db, { workspaceId: ws }, (tx) => tx.insert(schema.memberships).values({ id: newId("membership"), workspaceId: ws, userId: bob, role: "agent" }));
  globexAccount = (await app.inject({ method: "POST", url: "/v1/accounts", headers: auth(alice, ws), payload: { name: "Globex", domains: ["globex.com"] } })).json().id;
});
afterAll(async () => { await app.close(); await t.teardown(); });

describe("forwarding addresses (admin API)", () => {
  it("admins create addresses on the inbound domain; agents cannot; changes are audited", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/channels/email/addresses", headers: auth(alice, ws), payload: { name: "Support" } });
    expect(res.statusCode).toBe(201);
    address = res.json().address;
    // eslint-disable-next-line security/detect-non-literal-regexp -- built from a test constant
    expect(address).toMatch(new RegExp(`^acme-[a-z2-7]{8}@${DOMAIN.replace(/\./g, "\\.")}$`));
    expect((await app.inject({ method: "POST", url: "/v1/channels/email/addresses", headers: auth(bob, ws), payload: { name: "x" } })).statusCode).toBe(403);
    const list = (await app.inject({ url: "/v1/channels/email/addresses", headers: auth(alice, ws) })).json();
    expect(list).toMatchObject({ inbound_domain: DOMAIN, data: [{ address, name: "Support", status: "active", endpoint_type: "customer" }] });
    const audits = await withWorkspace(t.database.db, { workspaceId: ws }, (tx) => tx.select().from(schema.auditLog).where(eq(schema.auditLog.action, "email_address.created")));
    expect(audits).toHaveLength(1);
  });

  it("refuses to create addresses when inbound email is not configured on the server", async () => {
    const plain = await buildApp({ config: testConfig, database: t.database, email: t.email });
    try {
      const res = await plain.inject({ method: "POST", url: "/v1/channels/email/addresses", headers: auth(alice, ws), payload: { name: "x" } });
      expect(res.statusCode).toBe(409);
      expect((await plain.inject({ url: "/v1/channels/email/addresses", headers: auth(alice, ws) })).json().inbound_domain).toBeNull();
    } finally { await plain.close(); }
  });
});

describe("delivery capability", () => {
  it("reports no deliverable channel until an outbound adapter exists (email replies are saved, not sent, before T-303)", async () => {
    expect((await app.inject({ url: "/v1/channels/delivery", headers: auth(alice, ws) })).json()).toEqual({ deliverable: [] });
  });
});

describe("webhook authentication", () => {
  it("requires Postmark's Basic credentials (wrong user, wrong password, none → 401)", async () => {
    expect((await post(mail(), basic("someone", PASS))).statusCode).toBe(401);
    expect((await post(mail(), basic(USER, "wrong-password-wrong-password"))).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/ingest/email", payload: "{}", headers: { "content-type": "application/json" } })).statusCode).toBe(401);
    expect((await post({ not: "postmark" })).statusCode).toBe(422);
  });
});

describe("inbound email → issues", () => {
  it("opens an issue titled by the subject, with the quoted history stripped; a verified sender joins their company's account", async () => {
    const p = mail({ Subject: "RE: Export fails", TextBody: "Our CSV export times out.\n\nOn Tue, Maya wrote:\n> anything else?" });
    expect((await deliver(p))!.status).toBe("processed");
    const m = (await messageOf(`<msg-${seq}@globex.com>`))!;
    expect(m.bodyText).toBe("Our CSV export times out.");
    expect(m.meta).toMatchObject({ subject: "Export fails", sender_verified: true });
    const i = await issue(m.issueId!);
    expect(i).toMatchObject({ title: "Export fails", channel: "email", account: { id: globexAccount } });
    const conv = (await withWorkspace(t.database.db, { workspaceId: ws }, (tx) => tx.select().from(schema.conversations).where(eq(schema.conversations.id, m.conversationId))))[0]!;
    expect(conv.replyToken).toMatch(/^[a-z2-7]{32}$/);
  });

  it("threads a verified reply by In-Reply-To onto the same issue", async () => {
    const first = mail({ Subject: "SSO loop" });
    await deliver(first);
    const firstId = `<msg-${seq}@globex.com>`;
    const reply = mail({ Subject: "Re: SSO loop", TextBody: "Any news?", headers: { "In-Reply-To": firstId, References: firstId } });
    await deliver(reply);
    expect((await messageOf(`<msg-${seq}@globex.com>`))!.issueId).toBe((await messageOf(firstId))!.issueId);
  });

  it("an UNVERIFIED sender cannot continue a thread through headers, is not mapped by domain, and is flagged", async () => {
    const first = mail({ Subject: "Invoice question" });
    await deliver(first);
    const firstId = `<msg-${seq}@globex.com>`;
    const spoof = mail({ FromFull: { Email: "ceo@globex.com", Name: "The CEO" }, Subject: "Re: Invoice question", TextBody: "Wire the refund to IBAN X", headers: { "In-Reply-To": firstId, "X-Spam-Tests": "SPF_SOFTFAIL" } });
    await deliver(spoof);
    const m = (await messageOf(`<msg-${seq}@globex.com>`))!;
    expect(m.issueId).not.toBe((await messageOf(firstId))!.issueId); // a new, separate issue
    expect(m.meta).toMatchObject({ sender_verified: false, thread_unverified: true });
    expect((await issue(m.issueId!)).account).toBeNull(); // not placed into Globex by the claimed domain
  });

  it("the per-thread reply token threads even an unverified sender (it is unguessable)", async () => {
    const first = mail({ Subject: "Token thread" });
    await deliver(first);
    const firstMsg = (await messageOf(`<msg-${seq}@globex.com>`))!;
    const conv = (await withWorkspace(t.database.db, { workspaceId: ws }, (tx) => tx.select().from(schema.conversations).where(eq(schema.conversations.id, firstMsg.conversationId))))[0]!;
    const [local, domain] = address.split("@");
    const reply = mail({ to: `${local}+${conv.replyToken}@${domain}`, TextBody: "Replying from my phone", headers: { "X-Spam-Tests": "" } });
    await deliver(reply);
    expect((await messageOf(`<msg-${seq}@globex.com>`))!.issueId).toBe(firstMsg.issueId);
  });

  it("auto-replies are stored on the thread without changing status or reopening; alone they open nothing", async () => {
    const first = mail({ Subject: "Webhook retries" });
    await deliver(first);
    const firstId = `<msg-${seq}@globex.com>`;
    const issueId = (await messageOf(firstId))!.issueId!;
    await app.inject({ method: "PATCH", url: `/v1/issues/${issueId}`, headers: auth(alice, ws), payload: { status: "resolved" } });
    const ooo = mail({ Subject: "Automatic reply: Webhook retries", TextBody: "I'm out until Monday.", headers: { "Auto-Submitted": "auto-replied", "In-Reply-To": firstId } });
    await deliver(ooo);
    const m = (await messageOf(`<msg-${seq}@globex.com>`))!;
    expect(m.issueId).toBe(issueId);
    expect(m.meta).toMatchObject({ automated: true, automated_reason: "Auto-Submitted: auto-replied" });
    expect((await issue(issueId)).status.category).toBe("resolved"); // not reopened
    const before = (await app.inject({ url: "/v1/issues?status=triage&limit=100", headers: auth(alice, ws) })).json().data.length;
    const lone = await deliver(mail({ FromFull: { Email: "mailer-daemon@mx.globex.com" }, Subject: "Undelivered Mail Returned to Sender" }));
    expect(lone!.status).toBe("ignored");
    expect((await app.inject({ url: "/v1/issues?status=triage&limit=100", headers: auth(alice, ws) })).json().data.length).toBe(before);
  });

  it("an auto-reply processed before its original still lands on the thread (in-order processing)", async () => {
    const original = mail({ Subject: "Ordering check" });
    const originalId = `<msg-${seq}@globex.com>`;
    const ooo = mail({ Subject: "Automatic reply: Ordering check", TextBody: "Away", headers: { "Auto-Submitted": "auto-replied", "In-Reply-To": originalId } });
    expect((await post(original)).statusCode).toBe(200);
    expect((await post(ooo)).statusCode).toBe(200);
    const [oooEvent] = await withWorkspace(t.database.db, { workspaceId: ws }, (tx) => tx.select().from(schema.inboundEvents).where(eq(schema.inboundEvents.providerEventId, ooo.MessageID!)));
    await processInboundEvent(t.database.db, registry, { workspaceId: ws, inboundEventId: oooEvent!.id, finalAttempt: false }, () => undefined);
    const autoMsg = (await messageOf(`<msg-${seq}@globex.com>`))!;
    expect(autoMsg).toBeDefined(); // before the fix: dropped as "automated mail without a thread"
    expect(autoMsg.issueId).toBe((await messageOf(originalId))!.issueId);
  });

  it("deduplicates the same email delivered twice (Postmark retry with a new id) and keeps attachment metadata only", async () => {
    const p = mail({ Subject: "Logs attached", Attachments: [{ Name: "app.log", Content: "c2VjcmV0LWxvZw==", ContentType: "text/plain", ContentLength: 10, ContentID: "" }] });
    await deliver(p);
    const rfc = `<msg-${seq}@globex.com>`;
    await deliver({ ...p, MessageID: `${p.MessageID}-retry` });
    const all = await withWorkspace(t.database.db, { workspaceId: ws }, (tx) => tx.select().from(schema.messages).where(eq(schema.messages.externalId, rfc)));
    expect(all).toHaveLength(1);
    expect(all[0]!.meta).toMatchObject({ attachments: [{ name: "app.log", type: "text/plain", size: 10, inline: false }], attachments_imported: false });
    const stored = await t.owner.query("SELECT payload::text AS p FROM inbound_events WHERE provider_event_id = $1", [p.MessageID]);
    expect(stored.rows[0].p).not.toContain("c2VjcmV0LWxvZw==");
  });

  it("the timeline API exposes the flags the inbox shows", async () => {
    const m = (await messageOf(`<msg-${seq}@globex.com>`))!;
    const tl = (await app.inject({ url: `/v1/issues/${m.issueId}/timeline`, headers: auth(alice, ws) })).json();
    const item = tl.data.find((x: { kind: string; id: string }) => x.kind === "message" && x.id === m.id);
    expect(item.message.meta).toMatchObject({ sender_verified: true, attachments_imported: false });
  });

  it("mail for unknown or disabled addresses is acknowledged and dropped; other workspaces never see it", async () => {
    const before = Number((await t.owner.query("SELECT count(*)::int AS n FROM inbound_events")).rows[0].n);
    expect((await post(mail({ to: `nobody-xxxx@${DOMAIN}` }))).json()).toEqual({ ok: true });
    expect((await post(mail({ to: "support@elsewhere.com", ToFull: [{ Email: "support@elsewhere.com" }] }))).json()).toEqual({ ok: true });
    const id = (await app.inject({ url: "/v1/channels/email/addresses", headers: auth(alice, ws) })).json().data[0].id;
    await app.inject({ method: "PATCH", url: `/v1/channels/email/addresses/${id}`, headers: auth(alice, ws), payload: { status: "disabled" } });
    await post(mail());
    expect(Number((await t.owner.query("SELECT count(*)::int AS n FROM inbound_events")).rows[0].n)).toBe(before);
    await app.inject({ method: "PATCH", url: `/v1/channels/email/addresses/${id}`, headers: auth(alice, ws), payload: { status: "active" } });
    expect((await app.inject({ url: "/v1/issues?q=Export", headers: auth(alice, otherWs) })).json().data).toEqual([]);
  });
});
