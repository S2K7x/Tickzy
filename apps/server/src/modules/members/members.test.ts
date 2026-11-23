import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { schema, withWorkspace } from "@tickzy/db";
import { auth, setupTestApp } from "../../test-helpers.ts";

let t: Awaited<ReturnType<typeof setupTestApp>>;
let alice: string; // admin of ws
let bob: string; // invited agent
let carol: string; // outsider with her own workspace
let ws: string;
let otherWs: string;

const tokenFromLastEmail = (): string => {
  const msg = t.email.sent.at(-1)!;
  const m = /\/invite#token=([^\s]+)/.exec(msg.text);
  if (!m) throw new Error("no invite link in email");
  return m[1]!;
};
const createWs = async (user: string, slug: string, prefix: string) =>
  (await t.app.inject({ method: "POST", url: "/v1/workspaces", headers: auth(user), payload: { name: slug, slug, issue_prefix: prefix } })).json().id as string;
const invite = (by: string, workspace: string, email: string, role = "agent") =>
  t.app.inject({ method: "POST", url: "/v1/invitations", headers: auth(by, workspace), payload: { email, role } });
const accept = (user: string, token: string) =>
  t.app.inject({ method: "POST", url: "/v1/invitations/accept", headers: auth(user), payload: { token } });

beforeAll(async () => {
  t = await setupTestApp();
  alice = await t.createUser("alice@example.com");
  bob = await t.createUser("bob@example.com");
  carol = await t.createUser("carol@example.com");
  ws = await createWs(alice, "acme", "ACME");
  otherWs = await createWs(carol, "carol-co", "CAR");
});
afterAll(async () => { await t.teardown(); });

describe("invitations (FR-1.3)", () => {
  let bobToken: string;

  it("an admin invites by email; the email carries a link with the token in the fragment", async () => {
    const res = await invite(alice, ws, "Bob@Example.com", "agent");
    expect(res.statusCode).toBe(201);
    const inv = res.json();
    expect(inv).toMatchObject({ email: "bob@example.com", role: "agent", invited_by: alice });
    expect(inv.id).toMatch(/^inv_/);
    const days = (Date.parse(inv.expires_at) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
    const mail = t.email.sent.at(-1)!;
    expect(mail.to).toBe("bob@example.com");
    expect(mail.subject).toContain("acme");
    bobToken = tokenFromLastEmail();
    const list = (await t.app.inject({ url: "/v1/invitations", headers: auth(alice, ws) })).json();
    expect(list.data.map((i: { id: string }) => i.id)).toEqual([inv.id]);
  });

  it("preview is public and never leaks the secret", async () => {
    const res = await t.app.inject({ method: "POST", url: "/v1/invitations/preview", payload: { token: bobToken } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ workspace_name: "acme", inviter_name: "alice@example.com", email: "bob@example.com", role: "agent", status: "pending" });
    const bad = await t.app.inject({ method: "POST", url: "/v1/invitations/preview", payload: { token: bobToken.slice(0, -2) + "zz" } });
    expect(bad.statusCode).toBe(404);
  });

  it("re-inviting a pending address rotates the token (old link stops working)", async () => {
    const res = await invite(alice, ws, "bob@example.com", "collaborator");
    expect(res.statusCode).toBe(201);
    const fresh = tokenFromLastEmail();
    expect(fresh).not.toBe(bobToken);
    expect((await t.app.inject({ method: "POST", url: "/v1/invitations/preview", payload: { token: bobToken } })).statusCode).toBe(404);
    bobToken = fresh;
    const list = (await t.app.inject({ url: "/v1/invitations", headers: auth(alice, ws) })).json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0].role).toBe("collaborator");
  });

  it("a different signed-in user cannot accept someone else's invitation", async () => {
    const res = await accept(carol, bobToken);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("forbidden");
  });

  it("requires sign-in to accept", async () => {
    const res = await t.app.inject({ method: "POST", url: "/v1/invitations/accept", payload: { token: bobToken } });
    expect(res.statusCode).toBe(401);
  });

  it("the invitee accepts: membership created with the invited role, audit + outbox written", async () => {
    const res = await accept(bob, bobToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ workspace_id: ws });
    const mine = (await t.app.inject({ url: "/v1/me/workspaces", headers: auth(bob) })).json();
    expect(mine.data).toEqual([expect.objectContaining({ workspace_id: ws, role: "collaborator" })]);
    await withWorkspace(t.database.db, { workspaceId: ws }, async (tx) => {
      const actions = (await tx.select().from(schema.auditLog)).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(["invitation.created", "invitation.resent", "invitation.accepted"]));
      expect((await tx.select().from(schema.outbox)).map((e) => e.type)).toContain("member.joined");
    });
  });

  it("a token is single-use", async () => {
    expect((await accept(bob, bobToken)).statusCode).toBe(404);
    const p = (await t.app.inject({ method: "POST", url: "/v1/invitations/preview", payload: { token: bobToken } })).json();
    expect(p.status).toBe("accepted");
    expect((await t.app.inject({ url: "/v1/invitations", headers: auth(alice, ws) })).json().data).toEqual([]);
  });

  it("refuses to invite an existing active member", async () => {
    const res = await invite(alice, ws, "bob@example.com");
    expect(res.statusCode).toBe(409);
  });

  it("revoked and expired invitations cannot be accepted", async () => {
    const dave = await t.createUser("dave@example.com");
    const inv = (await invite(alice, ws, "dave@example.com")).json();
    const token = tokenFromLastEmail();
    expect((await t.app.inject({ method: "DELETE", url: `/v1/invitations/${inv.id}`, headers: auth(alice, ws) })).statusCode).toBe(204);
    expect((await accept(dave, token)).statusCode).toBe(404);
    expect((await t.app.inject({ method: "DELETE", url: `/v1/invitations/${inv.id}`, headers: auth(alice, ws) })).statusCode).toBe(404);

    await invite(alice, ws, "dave@example.com");
    const token2 = tokenFromLastEmail();
    await withWorkspace(t.database.db, { workspaceId: ws }, (tx) =>
      tx.execute(sql`UPDATE invitations SET expires_at = now() - interval '1 second' WHERE email = 'dave@example.com' AND revoked_at IS NULL`));
    const p = (await t.app.inject({ method: "POST", url: "/v1/invitations/preview", payload: { token: token2 } })).json();
    expect(p.status).toBe("expired");
    expect((await accept(dave, token2)).statusCode).toBe(404);
  });

  it("only members:manage roles can invite or list invitations; non-members get 404", async () => {
    expect((await invite(bob, ws, "eve@example.com")).statusCode).toBe(403); // collaborator
    expect((await t.app.inject({ url: "/v1/invitations", headers: auth(bob, ws) })).statusCode).toBe(403);
    expect((await invite(carol, ws, "eve@example.com")).statusCode).toBe(404); // not a member
  });

  it("rejects invalid input", async () => {
    expect((await invite(alice, ws, "not-an-email")).statusCode).toBe(422);
    expect((await invite(alice, ws, "x@example.com", "owner")).statusCode).toBe(422);
  });

  it("invitations are tenant-isolated", async () => {
    await invite(carol, otherWs, "frank@example.com");
    const list = (await t.app.inject({ url: "/v1/invitations", headers: auth(alice, ws) })).json();
    expect(list.data.map((i: { email: string }) => i.email)).not.toContain("frank@example.com");
    const carolInv = (await t.app.inject({ url: "/v1/invitations", headers: auth(carol, otherWs) })).json().data[0];
    expect((await t.app.inject({ method: "DELETE", url: `/v1/invitations/${carolInv.id}`, headers: auth(alice, ws) })).statusCode).toBe(404);
  });
});

describe("members management (FR-1.3)", () => {
  const members = async () => (await t.app.inject({ url: "/v1/members", headers: auth(alice, ws) })).json().data as Array<{ id: string; user_id: string; role: string; status: string; email: string }>;

  it("lists members with name, email, role and status; any member can read", async () => {
    const list = await members();
    expect(list.map((m) => [m.email, m.role, m.status])).toEqual([
      ["alice@example.com", "admin", "active"],
      ["bob@example.com", "collaborator", "active"],
    ]);
    expect((await t.app.inject({ url: "/v1/members", headers: auth(bob, ws) })).statusCode).toBe(200);
    expect((await t.app.inject({ url: "/v1/members", headers: auth(carol, ws) })).statusCode).toBe(404);
  });

  it("an admin changes a role (audited); a collaborator cannot", async () => {
    const bobM = (await members()).find((m) => m.user_id === bob)!;
    const res = await t.app.inject({ method: "PATCH", url: `/v1/members/${bobM.id}`, headers: auth(alice, ws), payload: { role: "agent" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe("agent");
    const aliceM = (await members()).find((m) => m.user_id === alice)!;
    expect((await t.app.inject({ method: "PATCH", url: `/v1/members/${aliceM.id}`, headers: auth(bob, ws), payload: { role: "viewer" } })).statusCode).toBe(403);
    await withWorkspace(t.database.db, { workspaceId: ws }, async (tx) => {
      expect((await tx.select().from(schema.auditLog)).map((a) => a.action)).toContain("member.updated");
    });
  });

  it("never leaves a workspace without an active admin", async () => {
    const aliceM = (await members()).find((m) => m.user_id === alice)!;
    for (const payload of [{ role: "agent" }, { status: "deactivated" }]) {
      const res = await t.app.inject({ method: "PATCH", url: `/v1/members/${aliceM.id}`, headers: auth(alice, ws), payload });
      expect(res.statusCode).toBe(409);
    }
    expect((await t.app.inject({ method: "DELETE", url: `/v1/members/${aliceM.id}`, headers: auth(alice, ws) })).statusCode).toBe(409);
  });

  it("deactivated members lose access; reactivation restores it", async () => {
    const bobM = (await members()).find((m) => m.user_id === bob)!;
    await t.app.inject({ method: "PATCH", url: `/v1/members/${bobM.id}`, headers: auth(alice, ws), payload: { status: "deactivated" } });
    expect((await t.app.inject({ url: "/v1/members", headers: auth(bob, ws) })).statusCode).toBe(404);
    await t.app.inject({ method: "PATCH", url: `/v1/members/${bobM.id}`, headers: auth(alice, ws), payload: { status: "active" } });
    expect((await t.app.inject({ url: "/v1/members", headers: auth(bob, ws) })).statusCode).toBe(200);
  });

  it("removes a member, and a removed member can be invited back", async () => {
    const bobM = (await members()).find((m) => m.user_id === bob)!;
    expect((await t.app.inject({ method: "DELETE", url: `/v1/members/${bobM.id}`, headers: auth(alice, ws) })).statusCode).toBe(204);
    expect((await members()).map((m) => m.user_id)).toEqual([alice]);
    expect((await t.app.inject({ url: "/v1/members", headers: auth(bob, ws) })).statusCode).toBe(404);
    expect((await invite(alice, ws, "bob@example.com", "viewer")).statusCode).toBe(201);
    expect((await accept(bob, tokenFromLastEmail())).statusCode).toBe(200);
    expect((await members()).find((m) => m.user_id === bob)?.role).toBe("viewer");
  });

  it("cannot touch members of another workspace", async () => {
    const res = await t.app.inject({ url: "/v1/members", headers: auth(carol, otherWs) });
    const carolM = res.json().data[0];
    expect((await t.app.inject({ method: "PATCH", url: `/v1/members/${carolM.id}`, headers: auth(alice, ws), payload: { role: "viewer" } })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "DELETE", url: `/v1/members/${carolM.id}`, headers: auth(alice, ws) })).statusCode).toBe(404);
  });
});
