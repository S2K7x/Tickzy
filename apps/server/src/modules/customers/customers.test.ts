import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { newId } from "@tickzy/shared";
import { schema, withWorkspace } from "@tickzy/db";
import { auth, setupTestApp } from "../../test-helpers.ts";
import { createIssue } from "../issues/domain.ts";
import { resolveContact } from "./resolution.ts";

let t: Awaited<ReturnType<typeof setupTestApp>>;
let alice: string; // admin
let carl: string; // collaborator
let ws: string;
let otherWs: string;
let aliceMembership: string;

const H = (ws_: string, u = alice) => auth(u, ws_);
const post = (url: string, payload: unknown, w = ws, u = alice) => t.app.inject({ method: "POST", url, headers: H(w, u), payload: payload as Record<string, unknown> });
const patch = (url: string, payload: unknown, w = ws, u = alice) => t.app.inject({ method: "PATCH", url, headers: H(w, u), payload: payload as Record<string, unknown> });
const get = (url: string, w = ws, u = alice) => t.app.inject({ url, headers: H(w, u) });
const auditActions = () => withWorkspace(t.database.db, { workspaceId: ws }, async (tx) => (await tx.select().from(schema.auditLog)).map((a) => a.action));

beforeAll(async () => {
  t = await setupTestApp();
  alice = await t.createUser("alice@example.com");
  carl = await t.createUser("carl@example.com");
  const mk = async (slug: string) => (await t.app.inject({ method: "POST", url: "/v1/workspaces", headers: auth(alice), payload: { name: slug, slug, issue_prefix: "ACME" } })).json().id as string;
  ws = await mk("acme");
  otherWs = await mk("other");
  await withWorkspace(t.database.db, { workspaceId: ws }, async (tx) => {
    await tx.insert(schema.memberships).values({ id: newId("membership"), workspaceId: ws, userId: carl, role: "collaborator" });
    aliceMembership = (await tx.select().from(schema.memberships).where(eq(schema.memberships.userId, alice)))[0]!.id;
  });
});
afterAll(async () => { await t.teardown(); });

describe("accounts (FR-4.1)", () => {
  let globex: string;

  it("creates an account with normalised domains, owner, external ids; audited", async () => {
    const res = await post("/v1/accounts", { name: "Globex", domains: ["https://www.Globex.com/", "globex.io"], tier: "Enterprise", owner_membership_id: aliceMembership, external_ids: { hubspot: "123" } });
    expect(res.statusCode).toBe(201);
    const a = res.json();
    globex = a.id;
    expect(a).toMatchObject({ name: "Globex", domains: ["globex.com", "globex.io"], tier: "Enterprise", owner_membership_id: aliceMembership, external_ids: { hubspot: "123" }, contact_count: 0, open_issue_count: 0 });
    expect(await auditActions()).toContain("account.created");
  });

  it("rejects public email domains, malformed domains, taken domains and invalid owners", async () => {
    const pub = await post("/v1/accounts", { name: "X", domains: ["gmail.com", "not a domain"] });
    expect(pub.statusCode).toBe(422);
    expect(pub.json().error.details.map((d: { issue: string }) => d.issue)).toEqual(["public email provider; it cannot identify one company", "not a domain"]);
    expect((await post("/v1/accounts", { name: "Copycat", domains: ["globex.com"] })).statusCode).toBe(409);
    expect((await post("/v1/accounts", { name: "Y", owner_membership_id: newId("membership") })).statusCode).toBe(422);
    const otherMembership = await withWorkspace(t.database.db, { workspaceId: otherWs }, async (tx) => (await tx.select().from(schema.memberships))[0]!.id);
    expect((await post("/v1/accounts", { name: "Z", owner_membership_id: otherMembership })).statusCode).toBe(422);
  });

  it("validates custom fields against the workspace's definitions", async () => {
    await withWorkspace(t.database.db, { workspaceId: ws }, (tx) => tx.insert(schema.customFieldDefs).values({ id: newId("customField"), workspaceId: ws, entity: "account", key: "arr", label: "ARR", type: "number" }));
    expect((await patch(`/v1/accounts/${globex}`, { custom: { arr: "lots" } })).statusCode).toBe(422);
    expect((await patch(`/v1/accounts/${globex}`, { custom: { nope: 1 } })).statusCode).toBe(422);
    const ok = await patch(`/v1/accounts/${globex}`, { custom: { arr: 250000 } });
    expect(ok.json().custom).toEqual({ arr: 250000 });
  });

  it("lists by name with exact keyset pagination and searches name or domain prefix", async () => {
    for (const n of ["acme", "Bravo", "charlie", "Delta", "echo", "Foxtrot"]) await post("/v1/accounts", { name: n });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await get(`/v1/accounts?limit=3${cursor ? `&cursor=${cursor}` : ""}`);
      const body = res.json();
      seen.push(...body.data.map((a: { name: string }) => a.name));
      cursor = body.next_cursor;
    } while (cursor);
    expect(seen).toEqual(["acme", "Bravo", "charlie", "Delta", "echo", "Foxtrot", "Globex"]);
    expect((await get("/v1/accounts?q=globex.i")).json().data.map((a: { name: string }) => a.name)).toEqual(["Globex"]);
    expect((await get("/v1/accounts?q=ELT")).json().data.map((a: { name: string }) => a.name)).toEqual(["Delta"]);
    expect((await get("/v1/accounts?q=%25")).json().data).toEqual([]); // LIKE wildcards are literal
    expect((await get("/v1/accounts?cursor=garbage")).statusCode).toBe(422);
  });

  it("reports contact and open-issue counts", async () => {
    await post("/v1/contacts", { name: "Hank", email: "hank@globex.com" });
    await withWorkspace(t.database.db, { workspaceId: ws }, async (tx) => {
      await createIssue(tx, ws, { type: "user", id: alice }, { title: "open one", channelKind: "api", accountId: globex });
    });
    expect((await get(`/v1/accounts/${globex}`)).json()).toMatchObject({ contact_count: 1, open_issue_count: 1 });
  });

  it("collaborators read but cannot write; tokens need accounts:write; outsiders get 404", async () => {
    expect((await get("/v1/accounts", ws, carl)).statusCode).toBe(200);
    expect((await post("/v1/accounts", { name: "nope" }, ws, carl)).statusCode).toBe(403);
    const readTok = (await post("/v1/api-tokens", { name: "r", scopes: ["issues:read"], expires_in_days: null })).json().token;
    const writeTok = (await post("/v1/api-tokens", { name: "w", scopes: ["accounts:write"], expires_in_days: null })).json().token;
    expect((await t.app.inject({ url: "/v1/accounts", headers: { authorization: `Bearer ${readTok}` } })).statusCode).toBe(200);
    expect((await t.app.inject({ method: "POST", url: "/v1/accounts", headers: { authorization: `Bearer ${readTok}` }, payload: { name: "x" } })).statusCode).toBe(403);
    expect((await t.app.inject({ method: "POST", url: "/v1/accounts", headers: { authorization: `Bearer ${writeTok}` }, payload: { name: "Via token" } })).statusCode).toBe(201);
    expect((await get(`/v1/accounts/${globex}`, otherWs)).statusCode).toBe(404);
    expect((await get("/v1/accounts", otherWs)).json().data).toEqual([]);
  });
});

describe("contacts & identity mapping (FR-4.2)", () => {
  let initech: string;
  beforeAll(async () => {
    initech = (await post("/v1/accounts", { name: "Initech", domains: ["initech.com"] })).json().id;
  });

  it("maps a company email to its account automatically; public emails stay unassigned", async () => {
    const peter = (await post("/v1/contacts", { name: "Peter", email: "Peter@Initech.com" })).json();
    expect(peter).toMatchObject({ account_id: initech, account_source: "auto", identities: [{ kind: "email", external_key: "peter@initech.com" }] });
    const gm = (await post("/v1/contacts", { name: "Joanna", email: "joanna@gmail.com" })).json();
    expect(gm).toMatchObject({ account_id: null, account_source: "auto" });
    expect((await post("/v1/contacts", { email: "PETER@initech.com" })).statusCode).toBe(409);
  });

  it("an explicit account is a manual choice; foreign or unknown accounts are rejected", async () => {
    const m = (await post("/v1/contacts", { name: "Milton", email: "milton@initech.com", account_id: null })).json();
    expect(m).toMatchObject({ account_id: null, account_source: "manual" });
    const foreignAcc = (await post("/v1/accounts", { name: "Theirs" }, otherWs)).json().id;
    expect((await post("/v1/contacts", { name: "x", account_id: foreignAcc })).statusCode).toBe(422);
    expect((await post("/v1/contacts", { name: "x", account_id: newId("account") })).statusCode).toBe(422);
  });

  it("adding a domain attaches unassigned automatic contacts — never manual ones", async () => {
    const samir = (await post("/v1/contacts", { name: "Samir", email: "samir@initrode.com" })).json();
    const bill = (await post("/v1/contacts", { name: "Bill", email: "bill@initrode.com", account_id: null })).json();
    const initrode = (await post("/v1/accounts", { name: "Initrode", domains: ["initrode.com"] })).json();
    expect((await get(`/v1/contacts/${samir.id}`)).json().account_id).toBe(initrode.id);
    expect((await get(`/v1/contacts/${bill.id}`)).json().account_id).toBeNull();
    expect(initrode.contact_count).toBe(1);
  });

  it("manual overrides are audited and survive automation; auto_account hands back and re-resolves", async () => {
    const peter = (await get(`/v1/contacts?q=peter@`)).json().data[0];
    const other = (await post("/v1/accounts", { name: "Penetrode" })).json().id;
    const moved = (await patch(`/v1/contacts/${peter.id}`, { account_id: other })).json();
    expect(moved).toMatchObject({ account_id: other, account_source: "manual" });
    expect(await auditActions()).toContain("contact.account_changed");
    await patch(`/v1/accounts/${initech}`, { domains: ["initech.com", "initech.net"] }); // automation runs again
    expect((await get(`/v1/contacts/${peter.id}`)).json().account_id).toBe(other);
    const back = (await patch(`/v1/contacts/${peter.id}`, { auto_account: true })).json();
    expect(back).toMatchObject({ account_id: initech, account_source: "auto" });
    expect((await patch(`/v1/contacts/${peter.id}`, { auto_account: true, account_id: null })).statusCode).toBe(422);
  });

  it("links and unlinks identities; a Slack key cannot belong to two contacts", async () => {
    const c = (await post("/v1/contacts", { name: "Lumbergh" })).json();
    const linked = (await post(`/v1/contacts/${c.id}/identities`, { kind: "slack", external_key: "T01:U02" })).json();
    expect(linked.identities.map((i: { kind: string; external_key: string }) => `${i.kind}:${i.external_key}`)).toEqual(["slack:T01:U02"]);
    const d = (await post("/v1/contacts", { name: "Dom" })).json();
    expect((await post(`/v1/contacts/${d.id}/identities`, { kind: "slack", external_key: "T01:U02" })).statusCode).toBe(409);
    const unlinked = (await t.app.inject({ method: "DELETE", url: `/v1/contacts/${c.id}/identities/${linked.identities[0].id}`, headers: H(ws) })).json();
    expect(unlinked.identities).toEqual([]);
  });

  it("deleting an account releases its domains and unassigns contacts; issues keep their account", async () => {
    const tmp = (await post("/v1/accounts", { name: "Temp", domains: ["temp.dev"] })).json();
    const c = (await post("/v1/contacts", { email: "x@temp.dev" })).json();
    expect(c.account_id).toBe(tmp.id);
    const issue = await withWorkspace(t.database.db, { workspaceId: ws }, (tx) => createIssue(tx, ws, { type: "user", id: alice }, { title: "t", channelKind: "api", accountId: tmp.id }));
    expect((await t.app.inject({ method: "DELETE", url: `/v1/accounts/${tmp.id}`, headers: H(ws) })).statusCode).toBe(204);
    expect((await get(`/v1/accounts/${tmp.id}`)).statusCode).toBe(404);
    expect((await get(`/v1/contacts/${c.id}`)).json().account_id).toBeNull();
    expect((await post("/v1/accounts", { name: "Temp 2", domains: ["temp.dev"] })).statusCode).toBe(201);
    const [kept] = await withWorkspace(t.database.db, { workspaceId: ws }, (tx) => tx.select().from(schema.issues).where(eq(schema.issues.id, issue.id)));
    expect(kept!.accountId).toBe(tmp.id);
  });
});

describe("identity resolution service (ingestion path)", () => {
  const resolve = (input: Parameters<typeof resolveContact>[2], w = ws) => withWorkspace(t.database.db, { workspaceId: w }, (tx) => resolveContact(tx, w, input));

  it("creates a contact on first sight, then recognises the same person (case-insensitive email)", async () => {
    await post("/v1/accounts", { name: "Hooli", domains: ["hooli.xyz"] });
    const first = await resolve({ kind: "email", externalKey: "Gavin@Hooli.xyz", name: "Gavin" });
    expect(first.created).toBe(true);
    expect(first.accountId).not.toBeNull();
    const again = await resolve({ kind: "email", externalKey: "gavin@hooli.xyz" });
    expect(again).toEqual({ contactId: first.contactId, accountId: first.accountId, created: false });
  });

  it("the endpoint's default account wins over the email domain; Slack identities need one", async () => {
    const pied = (await post("/v1/accounts", { name: "Pied Piper" })).json().id;
    const r = await resolve({ kind: "email", externalKey: "richard@hooli.xyz", defaultAccountId: pied });
    expect(r.accountId).toBe(pied);
    expect((await resolve({ kind: "slack", externalKey: "T9:U1" })).accountId).toBeNull();
    expect((await resolve({ kind: "slack", externalKey: "T9:U2", defaultAccountId: pied })).accountId).toBe(pied);
  });

  it("fills a missing automatic account later, but never touches a manual choice", async () => {
    const r = await resolve({ kind: "email", externalKey: "jared@raviga.vc" });
    expect(r.accountId).toBeNull();
    const raviga = (await post("/v1/accounts", { name: "Raviga" })).json().id; // no domain yet
    expect((await resolve({ kind: "email", externalKey: "jared@raviga.vc", defaultAccountId: raviga })).accountId).toBe(raviga);
    await patch(`/v1/contacts/${r.contactId}`, { account_id: null }); // manual "no account"
    expect((await resolve({ kind: "email", externalKey: "jared@raviga.vc", defaultAccountId: raviga })).accountId).toBeNull();
  });

  it("concurrent first messages from the same person create exactly one contact", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => resolve({ kind: "slack", externalKey: "T7:URACE" })));
    expect(new Set(results.map((r) => r.contactId)).size).toBe(1);
    const rows = await withWorkspace(t.database.db, { workspaceId: ws }, (tx) => tx.select().from(schema.contactIdentities).where(eq(schema.contactIdentities.externalKey, "T7:URACE")));
    expect(rows).toHaveLength(1);
  });

  it("deleting a contact frees its identities: the next message from that address creates a new contact", async () => {
    const first = await resolve({ kind: "email", externalKey: "monica@raviga.vc" });
    expect((await t.app.inject({ method: "DELETE", url: `/v1/contacts/${first.contactId}`, headers: H(ws) })).statusCode).toBe(204);
    expect((await get(`/v1/contacts/${first.contactId}`)).statusCode).toBe(404);
    const next = await resolve({ kind: "email", externalKey: "monica@raviga.vc" });
    expect(next.created).toBe(true);
    expect(next.contactId).not.toBe(first.contactId);
  });

  it("is scoped per workspace", async () => {
    const mine = await resolve({ kind: "email", externalKey: "shared@person.io" });
    const theirs = await resolve({ kind: "email", externalKey: "shared@person.io" }, otherWs);
    expect(theirs.contactId).not.toBe(mine.contactId);
    expect(theirs.created).toBe(true);
  });
});
