import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { schema, withWorkspace } from "@tickzy/db";
import { buildApp } from "../../app.ts";
import { auth, setupTestApp, testConfig, TEST_ORIGIN } from "../../test-helpers.ts";

let t: Awaited<ReturnType<typeof setupTestApp>>;
let app: FastifyInstance;
let url: string;
let alice: string; let bob: string; let carol: string;
let ws: string; let otherWs: string;
let issueKey: string; let issueId: string;
const open: WebSocket[] = [];

/** A test client: collects messages; `next` waits for the first message matching a predicate. */
function client(headers: Record<string, string>) {
  const sock = new WebSocket(url, { headers });
  open.push(sock);
  const inbox: Record<string, unknown>[] = [];
  const waiters: { pred: (m: Record<string, unknown>) => boolean; resolve: (m: Record<string, unknown>) => void }[] = [];
  sock.on("message", (d) => {
    const m = JSON.parse(String(d)) as Record<string, unknown>;
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  const next = (pred: (m: Record<string, unknown>) => boolean, ms = 2000) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const hit = inbox.find(pred);
    if (hit) { inbox.splice(inbox.indexOf(hit), 1); return resolve(hit); }
    const timer = setTimeout(() => reject(new Error("timed out waiting for message")), ms);
    waiters.push({ pred, resolve: (m) => { clearTimeout(timer); inbox.splice(inbox.indexOf(m), 1); resolve(m); } });
  });
  const send = (m: unknown) => sock.send(JSON.stringify(m));
  const ready = new Promise<void>((resolve, reject) => { sock.once("open", () => resolve()); sock.once("error", reject); });
  return { sock, inbox, next, send, ready };
}
const as = (user: string, extra: Record<string, string> = {}) => ({ ...auth(user), origin: TEST_ORIGIN, ...extra });
const H = (u = alice, w = ws) => auth(u, w);

beforeAll(async () => {
  t = await setupTestApp();
  app = await buildApp({ config: testConfig, database: t.database, email: t.email, realtimeSweepMs: 200 });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address() as { port: number };
  url = `ws://127.0.0.1:${addr.port}/v1/realtime`;
  alice = await t.createUser("alice@example.com");
  bob = await t.createUser("bob@example.com");
  carol = await t.createUser("carol@example.com");
  const mk = async (u: string, slug: string) => (await app.inject({ method: "POST", url: "/v1/workspaces", headers: auth(u), payload: { name: slug, slug, issue_prefix: "ACME" } })).json().id as string;
  ws = await mk(alice, "acme");
  otherWs = await mk(carol, "other");
  await withWorkspace(t.database.db, { workspaceId: ws }, (tx) => tx.insert(schema.memberships).values({ id: "mem_01JD000000000000000000BOB1", workspaceId: ws, userId: bob, role: "agent" }));
  const issue = (await app.inject({ method: "POST", url: "/v1/issues", headers: H(), payload: { title: "Realtime test" } })).json();
  issueKey = issue.key; issueId = issue.id;
});
afterAll(async () => {
  for (const s of open) s.terminate();
  await app.close();
  await t.teardown();
});

describe("realtime gateway (T-208, FR-3.9)", () => {
  it("requires a signed-in user and an allowed Origin", async () => {
    const anon = new WebSocket(url, { headers: { origin: TEST_ORIGIN } });
    const status = await new Promise<number>((resolve) => anon.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0)));
    expect(status).toBe(401);
    const evil = new WebSocket(url, { headers: as(alice, { origin: "https://evil.example" }) });
    expect(await new Promise<number>((resolve) => evil.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0)))).toBe(403);
  });

  it("authorises topics: members only; issues only within a subscribed workspace", async () => {
    const c = client(as(carol));
    await c.ready;
    await c.next((m) => m.op === "ready");
    c.send({ op: "sub", topic: `workspace:${ws}:inbox` });
    expect(await c.next((m) => m.op === "error")).toMatchObject({ error: "forbidden" });
    c.send({ op: "sub", topic: `issue:${issueId}` });
    expect(await c.next((m) => m.op === "error")).toMatchObject({ error: "forbidden" });
    c.send({ op: "sub", topic: "nonsense" });
    expect(await c.next((m) => m.op === "error")).toMatchObject({ error: "unknown_topic" });
    c.sock.close();
  });

  it("pushes ids-only invalidations within a second of an API change, to subscribers of that workspace only", async () => {
    const a = client(as(alice));
    const other = client(as(carol));
    await Promise.all([a.ready, other.ready]);
    a.send({ op: "sub", topic: `workspace:${ws}:inbox` });
    await a.next((m) => m.op === "subscribed");
    other.send({ op: "sub", topic: `workspace:${otherWs}:inbox` });
    await other.next((m) => m.op === "subscribed");
    const started = Date.now();
    await app.inject({ method: "PATCH", url: `/v1/issues/${issueKey}`, headers: H(), payload: { priority: "urgent" } });
    const ev = await a.next((m) => m.op === "event" && m.type === "issue.updated", 1000);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(ev).toEqual({ op: "event", topic: `workspace:${ws}:inbox`, type: "issue.updated", issue_id: issueId, message_id: null });
    expect(JSON.stringify(ev)).not.toContain("urgent"); // no content in pushes
    await new Promise((r) => setTimeout(r, 150));
    expect(other.inbox.filter((m) => m.op === "event")).toEqual([]);
    a.sock.close(); other.sock.close();
  });

  it("issue topic receives message events; rolled-back changes are never announced", async () => {
    const a = client(as(alice));
    await a.ready;
    a.send({ op: "sub", topic: `workspace:${ws}:inbox` });
    await a.next((m) => m.op === "subscribed");
    a.send({ op: "sub", topic: `issue:${issueId}` });
    await a.next((m) => m.op === "subscribed" && m.topic === `issue:${issueId}`);
    await app.inject({ method: "POST", url: `/v1/issues/${issueKey}/messages`, headers: H(), payload: { body: "hello", visibility: "internal" } });
    const ev = await a.next((m) => m.op === "event" && m.topic === `issue:${issueId}` && m.type === "message.created");
    expect(ev.message_id).toMatch(/^msg_/);
    await expect(withWorkspace(t.database.db, { workspaceId: ws }, async (tx) => {
      await tx.insert(schema.outbox).values({ workspaceId: ws, type: "issue.updated", payload: { issue_id: issueId, rolled: true } });
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    await new Promise((r) => setTimeout(r, 200));
    expect(a.inbox.filter((m) => m.op === "event" && m.type === "issue.updated")).toEqual([]);
    a.sock.close();
  });

  it("presence: viewers and typing are shared on the issue topic; leaving and disconnecting clear them", async () => {
    const a = client(as(alice));
    const b = client(as(bob));
    await Promise.all([a.ready, b.ready]);
    for (const c of [a, b]) {
      c.send({ op: "sub", topic: `workspace:${ws}:inbox` });
      await c.next((m) => m.op === "subscribed");
      c.send({ op: "sub", topic: `issue:${issueId}` });
      await c.next((m) => m.op === "subscribed" && m.topic === `issue:${issueId}`);
    }
    a.send({ op: "presence", issue_id: issueId, state: "viewing" });
    expect(await b.next((m) => m.op === "presence" && (m.viewers as unknown[]).length === 1)).toMatchObject({ viewers: [{ user_id: alice, name: "alice@example.com", state: "viewing" }] });
    a.send({ op: "presence", issue_id: issueId, state: "typing" });
    expect(await b.next((m) => m.op === "presence" && (m.viewers as { state: string }[])[0]?.state === "typing")).toBeTruthy();
    a.send({ op: "presence", issue_id: issueId, state: "left" });
    expect(await b.next((m) => m.op === "presence" && (m.viewers as unknown[]).length === 0)).toBeTruthy();
    a.send({ op: "presence", issue_id: issueId, state: "viewing" });
    await b.next((m) => m.op === "presence" && (m.viewers as unknown[]).length === 1);
    a.sock.close();
    expect(await b.next((m) => m.op === "presence" && (m.viewers as unknown[]).length === 0)).toBeTruthy();
    b.sock.close();
  });

  it("handles a connection's messages in order: workspace sub, issue sub and presence sent back-to-back all succeed", async () => {
    const a = client(as(alice));
    const b = client(as(bob));
    await Promise.all([a.ready, b.ready]);
    b.send({ op: "sub", topic: `workspace:${ws}:inbox` });
    b.send({ op: "sub", topic: `issue:${issueId}` });
    await b.next((m) => m.op === "subscribed" && m.topic === `issue:${issueId}`);
    // No waiting between these: the issue sub depends on the workspace sub, and presence on the issue sub.
    a.send({ op: "sub", topic: `workspace:${ws}:inbox` });
    a.send({ op: "sub", topic: `issue:${issueId}` });
    a.send({ op: "presence", issue_id: issueId, state: "viewing" });
    expect(await a.next((m) => m.op === "subscribed" && m.topic === `issue:${issueId}`)).toBeTruthy();
    expect(await b.next((m) => m.op === "presence" && (m.viewers as { user_id: string }[]).some((v) => v.user_id === alice))).toBeTruthy();
    expect(a.inbox.filter((m) => m.op === "error")).toEqual([]);
    a.sock.close(); b.sock.close();
  });

  it("revalidation drops a workspace subscription after the member is removed", async () => {
    const b = client(as(bob));
    await b.ready;
    b.send({ op: "sub", topic: `workspace:${ws}:inbox` });
    await b.next((m) => m.op === "subscribed");
    await withWorkspace(t.database.db, { workspaceId: ws }, (tx) => tx.update(schema.memberships).set({ status: "deactivated" }).where(eq(schema.memberships.userId, bob)));
    expect(await b.next((m) => m.op === "error" && m.error === "forbidden", 3000)).toBeTruthy();
    await app.inject({ method: "PATCH", url: `/v1/issues/${issueKey}`, headers: H(), payload: { priority: "low" } });
    await new Promise((r) => setTimeout(r, 200));
    expect(b.inbox.filter((m) => m.op === "event")).toEqual([]);
    b.sock.close();
  });

  it("answers pings and enforces message limits", async () => {
    const a = client(as(alice));
    await a.ready;
    a.send({ op: "ping" });
    expect(await a.next((m) => m.op === "pong")).toBeTruthy();
    a.sock.send("not json");
    expect(await a.next((m) => m.op === "error")).toMatchObject({ error: "bad_json" });
    const closed = new Promise<number>((resolve) => a.sock.on("close", (code) => resolve(code)));
    for (let i = 0; i < 30; i++) a.send({ op: "ping" });
    expect(await closed).toBe(1008);
  });
});
