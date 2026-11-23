import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { mockApi, renderAt, SIGNED_IN } from "./test-utils.tsx";
import type { Session } from "./lib/api.ts";

const WS = SIGNED_IN.workspaces[0]!.workspace_id;
const UNAUTH = { status: 401, body: { error: { code: "unauthenticated", message: "Authentication required", request_id: "r" } } };
const MEMBERS = {
  data: [
    { id: "mem_A", user_id: SIGNED_IN.user.id, name: "Maya Chen", email: "maya@acme.test", role: "admin", status: "active", joined_at: "2026-11-01T00:00:00Z" },
    { id: "mem_B", user_id: "usr_B", name: "", email: "ben@acme.test", role: "agent", status: "active", joined_at: "2026-11-02T00:00:00Z" },
  ],
};
const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
const INVITES = { data: [{ id: "inv_1", email: "sam@acme.test", role: "collaborator", invited_by: SIGNED_IN.user.id, created_at: "", expires_at: future }] };
const PREVIEW = { workspace_name: "Acme Cloud", inviter_name: "Maya Chen", email: "ben@acme.test", role: "agent", status: "pending" };
const asUser = (email: string, workspaces: Session["workspaces"] = []): Session => ({ user: { id: "usr_B", email, name: "" }, workspaces });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.location.hash = "";
});

describe("settings › members (FR-1.3)", () => {
  it("lists members and pending invitations for admins, scoped to the current workspace, with no serious axe violations", async () => {
    const calls = mockApi({
      "GET /v1/auth/session": { status: 200, body: SIGNED_IN },
      "GET /v1/members": { status: 200, body: MEMBERS },
      "GET /v1/invitations": { status: 200, body: INVITES },
    });
    const { router } = await renderAt("/settings");
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/members"));
    const list = await screen.findByRole("region", { name: /Members/ });
    expect(await within(list).findByText("ben@acme.test", { selector: "span.text-sm" })).toBeTruthy();
    expect(within(list).getByText("(you)")).toBeTruthy();
    expect(await screen.findByText("sam@acme.test")).toBeTruthy();
    expect(calls.filter((c) => c.url === "/v1/members")[0]!.headers["tickzy-workspace"]).toBe(WS);
    // jsdom ignores CSS, so all three responsive navs are present at once; the full check runs in a real browser.
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  });

  it("sends an invite and refreshes the pending list", async () => {
    let invites = { data: [] as unknown[] };
    const calls = mockApi({
      "GET /v1/auth/session": { status: 200, body: SIGNED_IN },
      "GET /v1/members": { status: 200, body: MEMBERS },
      "GET /v1/invitations": () => ({ status: 200, body: invites }),
      "POST /v1/invitations": () => { invites = INVITES; return { status: 201, body: INVITES.data[0] }; },
    });
    await renderAt("/settings/members");
    expect(await screen.findByText("No pending invitations.")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Email address"), "sam@acme.test");
    await userEvent.selectOptions(screen.getByLabelText("Role"), "collaborator");
    await userEvent.click(screen.getByRole("button", { name: "Send invite" }));
    expect((await screen.findByRole("status")).textContent).toBe("Invitation sent to sam@acme.test.");
    expect(await screen.findByRole("button", { name: "Revoke invitation to sam@acme.test" })).toBeTruthy();
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ email: "sam@acme.test", role: "collaborator" });
  });

  it("changes a role and surfaces the last-admin guard error", async () => {
    const calls = mockApi({
      "GET /v1/auth/session": { status: 200, body: SIGNED_IN },
      "GET /v1/members": { status: 200, body: MEMBERS },
      "GET /v1/invitations": { status: 200, body: { data: [] } },
      "PATCH /v1/members/mem_B": { status: 200, body: { ...MEMBERS.data[1], role: "viewer" } },
      "PATCH /v1/members/mem_A": { status: 409, body: { error: { code: "conflict", message: "A workspace needs at least one active admin. Promote someone else first.", request_id: "r" } } },
    });
    await renderAt("/settings/members");
    await userEvent.selectOptions(await screen.findByLabelText("Role for ben@acme.test"), "viewer");
    expect((await screen.findByRole("status")).textContent).toBe("ben@acme.test is now viewer.");
    expect(calls.find((c) => c.url === "/v1/members/mem_B")!.body).toEqual({ role: "viewer" });
    await userEvent.selectOptions(screen.getByLabelText("Role for Maya Chen"), "agent");
    expect((await screen.findByRole("alert")).textContent).toContain("at least one active admin");
  });

  it("asks for confirmation before removing a member", async () => {
    const calls = mockApi({
      "GET /v1/auth/session": { status: 200, body: SIGNED_IN },
      "GET /v1/members": { status: 200, body: MEMBERS },
      "GET /v1/invitations": { status: 200, body: { data: [] } },
      "DELETE /v1/members/mem_B": { status: 204 },
    });
    await renderAt("/settings/members");
    await userEvent.click(await screen.findByRole("button", { name: "Remove ben@acme.test" }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Confirm remove" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/v1/members/mem_B")).toBe(true));
  });

  it("non-admins see the member list read-only and never request invitations", async () => {
    const agent: Session = { ...SIGNED_IN, workspaces: [{ ...SIGNED_IN.workspaces[0]!, role: "agent" }] };
    const calls = mockApi({ "GET /v1/auth/session": { status: 200, body: agent }, "GET /v1/members": { status: 200, body: MEMBERS } });
    await renderAt("/settings/members");
    expect(await screen.findByText("ben@acme.test", { selector: "span.truncate.text-sm" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send invite" })).toBeNull();
    expect(screen.queryByLabelText(/Role for/)).toBeNull();
    expect(calls.some((c) => c.url === "/v1/invitations")).toBe(false);
  });
});

describe("phone More tab", () => {
  it("lists the destinations that are not in the bottom bar, including Settings", async () => {
    mockApi({ "GET /v1/auth/session": { status: 200, body: SIGNED_IN } });
    await renderAt("/more");
    const list = (await screen.findByRole("heading", { name: "More" })).parentElement!;
    expect(within(list).getAllByRole("link").map((a) => a.textContent)).toEqual(["AI agent", "Knowledge", "Analytics", "Settings"]);
  });
});

describe("accepting an invitation (FR-1.3)", () => {
  it("signed out: shows who invited whom, keeps the token across sign-in, and strips it from the URL", async () => {
    const calls = mockApi({ "GET /v1/auth/session": UNAUTH, "POST /v1/invitations/preview": { status: 200, body: PREVIEW } });
    window.location.hash = "#token=inv.secret";
    await renderAt("/invite");
    expect(await screen.findByRole("heading", { name: "Join Acme Cloud" })).toBeTruthy();
    expect(screen.getByText("Maya Chen invited ben@acme.test to join as agent.")).toBeTruthy();
    expect(window.location.hash).toBe("");
    expect(JSON.parse(localStorage.getItem("tickzy.invite")!).token).toBe("inv.secret");
    expect(calls.find((c) => c.url === "/v1/invitations/preview")!.body).toEqual({ token: "inv.secret" });
    await userEvent.click(screen.getByRole("link", { name: "Sign in to accept" }));
    expect(await screen.findByLabelText("Work email")).toHaveProperty("value", "ben@acme.test");
  });

  it("returns to the invitation after the magic link, accepts, and opens the new workspace", async () => {
    localStorage.setItem("tickzy.invite", JSON.stringify({ token: "inv.secret", at: Date.now() }));
    let state: "out" | "in" | "member" = "out";
    const joined = { workspace_id: "ws_NEW", name: "Acme Cloud", slug: "acme", role: "agent" };
    const calls = mockApi({
      "GET /v1/auth/session": () => (state === "out" ? UNAUTH : { status: 200, body: asUser("ben@acme.test", state === "member" ? [joined] : []) }),
      "POST /v1/auth/magic-link/verify": () => { state = "in"; return { status: 200, body: {} }; },
      "POST /v1/invitations/preview": { status: 200, body: PREVIEW },
      "POST /v1/invitations/accept": () => { state = "member"; return { status: 200, body: { workspace_id: "ws_NEW" } }; },
    });
    window.location.hash = "#token=magic.link";
    const { router } = await renderAt("/auth/verify");
    await waitFor(() => expect(router.state.location.pathname).toBe("/invite"));
    await userEvent.click(await screen.findByRole("button", { name: "Accept and join Acme Cloud" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeTruthy();
    expect(calls.find((c) => c.url === "/v1/invitations/accept")!.body).toEqual({ token: "inv.secret" });
    expect(localStorage.getItem("tickzy.invite")).toBeNull();
    expect(localStorage.getItem("tickzy.workspace")).toBe("ws_NEW");
  });

  it("signed in with another email: explains and offers to switch account without calling accept", async () => {
    const calls = mockApi({ "GET /v1/auth/session": { status: 200, body: SIGNED_IN }, "POST /v1/invitations/preview": { status: 200, body: PREVIEW } });
    window.location.hash = "#token=inv.secret";
    await renderAt("/invite");
    expect((await screen.findByRole("alert")).textContent).toBe("You're signed in as maya@acme.test. This invitation is for ben@acme.test.");
    expect(screen.getByRole("button", { name: "Sign out and switch account" })).toBeTruthy();
    expect(calls.some((c) => c.url === "/v1/invitations/accept")).toBe(false);
  });

  it("explains used, expired or unknown invitations and forgets the token", async () => {
    mockApi({ "GET /v1/auth/session": UNAUTH, "POST /v1/invitations/preview": { status: 200, body: { ...PREVIEW, status: "expired" } } });
    window.location.hash = "#token=inv.old";
    await renderAt("/invite");
    expect(await screen.findByRole("heading", { name: "This invitation can't be used" })).toBeTruthy();
    expect(screen.getByText(/It has expired/)).toBeTruthy();
    await waitFor(() => expect(localStorage.getItem("tickzy.invite")).toBeNull());
    cleanup();

    mockApi({ "GET /v1/auth/session": UNAUTH, "POST /v1/invitations/preview": { status: 404, body: { error: { code: "not_found", message: "Invitation not found", request_id: "r" } } } });
    window.location.hash = "#token=inv.bogus";
    await renderAt("/invite");
    expect(await screen.findByRole("heading", { name: "This invitation didn't work" })).toBeTruthy();
  });
});
