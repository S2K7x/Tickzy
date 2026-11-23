import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { mockApi, renderAt, SIGNED_IN } from "./test-utils.tsx";
import { describeEvent, relativeTime } from "./lib/issues.ts";

const OPEN = "/v1/issues?status=triage,waiting_on_us,waiting_on_customer,blocked&sort=updated&limit=50";
const ISSUE = {
  id: "iss_1", key: "ACME-12", number: 12, title: "CSV export times out", status: { category: "waiting_on_us", id: "sts_1", name: "Open" },
  priority: "high", assignee: null, team_id: null, account: { id: "acc_1", name: "Globex", tier: "Enterprise" }, requester: { id: "con_1", name: "Hank" },
  channel: "email", product_area: null, labels: [{ id: "lbl_1", name: "billing", color: "#ff0000" }], fields: {}, sla: [],
  first_response_at: null, resolved_at: null, created_at: "2026-11-23T09:00:00Z", updated_at: new Date().toISOString(), version: 3,
};
const ISSUE2 = { ...ISSUE, id: "iss_2", key: "ACME-13", number: 13, title: "SSO login loop", priority: "normal", account: null };
const TIMELINE = {
  truncated: false,
  data: [
    { kind: "event", id: "1", created_at: "2026-11-23T09:00:00Z", event: { type: "issue.created", actor: { type: "contact", id: "con_1" }, data: {} } },
    { kind: "message", id: "msg_1", created_at: "2026-11-23T09:00:01Z", message: { id: "msg_1", visibility: "public", direction: "in", author: { type: "contact", id: "con_1", name: "Hank" }, body: { text: "Export of 50k rows fails" }, source: "email", delivery_state: "received" } },
    { kind: "message", id: "msg_2", created_at: "2026-11-23T09:05:00Z", message: { id: "msg_2", visibility: "internal", direction: "out", author: { type: "member", id: "usr_1", name: "Maya Chen" }, body: { text: "Probably the 30s timeout" }, source: "ui", delivery_state: null } },
    { kind: "event", id: "2", created_at: "2026-11-23T09:06:00Z", event: { type: "issue.status_changed", actor: { type: "system", id: null }, data: { to: { category: "waiting_on_customer" }, reason: "team_replied" } } },
  ],
};
const MEMBERS = { data: [
  { id: "mem_1", user_id: SIGNED_IN.user.id, name: "Maya Chen", email: "maya@acme.test", role: "admin", status: "active", joined_at: "" },
  { id: "mem_2", user_id: "usr_2", name: "Carl", email: "carl@acme.test", role: "collaborator", status: "active", joined_at: "" },
] };
const base = (over: Record<string, unknown> = {}) => mockApi({
  "GET /v1/auth/session": { status: 200, body: SIGNED_IN },
  [`GET ${OPEN}`]: { status: 200, body: { data: [ISSUE, ISSUE2], next_cursor: null } },
  "GET /v1/issues/ACME-12": { status: 200, body: ISSUE },
  "GET /v1/issues/ACME-12/timeline": { status: 200, body: TIMELINE },
  "GET /v1/issues/ACME-13": { status: 200, body: ISSUE2 },
  "GET /v1/issues/ACME-13/timeline": { status: 200, body: { data: [], truncated: false } },
  "GET /v1/members": { status: 200, body: MEMBERS },
  ...over,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("inbox queue (T-209a)", () => {
  it("lists open issues with priority, account, key, title, status and channel", async () => {
    const calls = base();
    await renderAt("/inbox");
    const queue = await screen.findByRole("region", { name: "Issue queue" });
    expect(await within(queue).findByText("CSV export times out")).toBeTruthy();
    expect(within(queue).getByText("Globex")).toBeTruthy();
    expect(within(queue).getByText("ACME-12")).toBeTruthy();
    expect(within(queue).getByText("No account")).toBeTruthy();
    expect(within(queue).getByRole("img", { name: "High priority" })).toBeTruthy();
    expect(within(queue).getAllByText("Email").length).toBe(2);
    expect(calls.find((c) => c.url.startsWith("/v1/issues?"))!.headers["tickzy-workspace"]).toBe(SIGNED_IN.workspaces[0]!.workspace_id);
  });

  it("views and sort drive the API query and the URL; an empty view explains why", async () => {
    const calls = base({ "GET /v1/issues?status=waiting_on_customer&sort=updated&limit=50": { status: 200, body: { data: [], next_cursor: null } } });
    const { router } = await renderAt("/inbox");
    await userEvent.click(await screen.findByRole("link", { name: "Waiting on customer" }));
    expect(await screen.findByText(/No issues in “Waiting on customer”/)).toBeTruthy();
    expect(router.state.location.search).toMatchObject({ view: "on-customer" });
    base({ "GET /v1/issues?status=waiting_on_customer&sort=priority&limit=50": { status: 200, body: { data: [ISSUE], next_cursor: null } } });
    await userEvent.selectOptions(screen.getByLabelText("Sort issues"), "priority");
    expect(await screen.findByText("CSV export times out")).toBeTruthy();
    expect(router.state.location.search).toMatchObject({ view: "on-customer", sort: "priority" });
    void calls;
  });

  it("'Mine' asks for issues assigned to the signed-in member", async () => {
    const calls = base({ "GET /v1/issues?assignee=me&status=triage,waiting_on_us,waiting_on_customer,blocked&sort=updated&limit=50": { status: 200, body: { data: [], next_cursor: null } } });
    await renderAt("/mine");
    await screen.findByText(/No issues in “Mine”/);
    expect(calls.some((c) => c.url.includes("assignee=me"))).toBe(true);
  });
});

describe("issue view (T-209a)", () => {
  it("opens from the queue; the URL names the issue; the timeline explains automatic changes and marks internal notes", async () => {
    base();
    const { router } = await renderAt("/inbox");
    await userEvent.click(await screen.findByText("CSV export times out"));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ issue: "ACME-12" }));
    const conv = await screen.findByRole("region", { name: "Conversation" });
    expect(await within(conv).findByText("Export of 50k rows fails")).toBeTruthy();
    expect(within(within(conv).getByRole("list", { name: "Timeline" })).getByText("Internal note")).toBeTruthy();
    expect(within(conv).getByText(/Status → Waiting on customer · automatically, because the team replied/)).toBeTruthy();
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  });

  it("sends a reply and an internal note (⌘↵ works)", async () => {
    const calls = base({ "POST /v1/issues/ACME-12/messages": { status: 201, body: {} } });
    await renderAt("/inbox?issue=ACME-12");
    const box = await screen.findByLabelText("Reply to the customer");
    await userEvent.type(box, "We are on it");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(1));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ body: "We are on it", visibility: "public" });
    await userEvent.click(screen.getByRole("radio", { name: "Internal note" }));
    const note = screen.getByLabelText("Internal note");
    await userEvent.type(note, "Check the timeout");
    fireEvent.keyDown(note, { key: "Enter", metaKey: true });
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(2));
    expect(calls.filter((c) => c.method === "POST")[1]!.body).toEqual({ body: "Check the timeout", visibility: "internal" });
  });

  it("changes status optimistically and rolls back with a message when the server refuses", async () => {
    let fail = true;
    base({ "PATCH /v1/issues/ACME-12": () => (fail ? { status: 409, body: { error: { code: "conflict", message: "The issue was changed by someone else. Reload and try again.", request_id: "r" } } } : { status: 200, body: ISSUE }) });
    await renderAt("/inbox?issue=ACME-12");
    const details = await screen.findByRole("complementary", { name: "Issue details" });
    const status = within(details).getByLabelText("Status") as HTMLSelectElement;
    expect(status.value).toBe("waiting_on_us");
    await userEvent.selectOptions(status, "blocked");
    expect((await within(details).findByRole("alert")).textContent).toContain("changed by someone else");
    await waitFor(() => expect((within(details).getByLabelText("Status") as HTMLSelectElement).value).toBe("waiting_on_us"));
    fail = false;
  });

  it("only offers admins and agents as assignees", async () => {
    const calls = base({ "PATCH /v1/issues/ACME-12": { status: 200, body: ISSUE } });
    await renderAt("/inbox?issue=ACME-12");
    const details = await screen.findByRole("complementary", { name: "Issue details" });
    const assignee = within(details).getByLabelText("Assignee");
    await waitFor(() => expect(within(assignee).getAllByRole("option").map((o) => o.textContent)).toEqual(["Unassigned", "Maya Chen"]));
    await userEvent.selectOptions(assignee, "mem_1");
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ assignee_membership_id: "mem_1" }));
  });

  it("keyboard: j/k move through the queue, r and n focus the composer, e resolves, Esc closes", async () => {
    const calls = base({ "PATCH /v1/issues/ACME-12": { status: 200, body: ISSUE } });
    const { router } = await renderAt("/inbox");
    await screen.findByText("CSV export times out");
    await userEvent.keyboard("j");
    await waitFor(() => expect(router.state.location.search).toMatchObject({ issue: "ACME-12" }));
    await userEvent.keyboard("j");
    await waitFor(() => expect(router.state.location.search).toMatchObject({ issue: "ACME-13" }));
    await userEvent.keyboard("k");
    await waitFor(() => expect(router.state.location.search).toMatchObject({ issue: "ACME-12" }));
    await screen.findByText("Export of 50k rows fails");
    await userEvent.keyboard("n");
    expect(document.activeElement).toBe(screen.getByLabelText("Internal note"));
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard("r");
    expect(document.activeElement).toBe(screen.getByLabelText("Reply to the customer"));
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard("e");
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ status: "resolved" }));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty("issue"));
  });
});

describe("new issue (T-209a)", () => {
  it("creates an issue from the top bar and opens it", async () => {
    const calls = base({ "POST /v1/issues": { status: 201, body: ISSUE } });
    const { router } = await renderAt("/inbox");
    await userEvent.click(await screen.findByRole("button", { name: "New issue" }));
    const dialog = screen.getByRole("dialog", { name: "New issue" });
    expect(document.activeElement).toBe(within(dialog).getByLabelText("Title"));
    await userEvent.type(within(dialog).getByLabelText("Title"), "CSV export times out");
    await userEvent.selectOptions(within(dialog).getByLabelText("Priority"), "high");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create issue" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ issue: "ACME-12" }));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ title: "CSV export times out", priority: "high" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Escape closes the dialog without creating anything", async () => {
    const calls = base();
    await renderAt("/inbox");
    await userEvent.click(await screen.findByRole("button", { name: "New issue" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
});

describe("inbox helpers", () => {
  it("formats relative times and describes events", () => {
    const now = new Date("2026-11-23T12:00:00Z");
    expect(["2026-11-23T11:59:30Z", "2026-11-23T11:55:00Z", "2026-11-23T09:00:00Z", "2026-11-21T12:00:00Z"].map((t) => relativeTime(t, now))).toEqual(["now", "5m", "3h", "2d"]);
    const names = { member: (id: string) => (id === "mem_1" ? "Maya" : null) };
    expect(describeEvent({ type: "issue.assigned", actor: { type: "user", id: null }, data: { to: "mem_1" } }, names)).toBe("Assigned to Maya");
    expect(describeEvent({ type: "issue.status_changed", actor: { type: "system", id: null }, data: { to: { category: "waiting_on_us" }, reason: "reopened_by_customer" } }, names)).toBe("Status → Waiting on us · automatically, because the customer wrote again");
    expect(describeEvent({ type: "issue.status_changed", actor: { type: "user", id: null }, data: { to: { category: "resolved" }, reason: "manual" } }, names)).toBe("Status → Resolved");
    expect(describeEvent({ type: "issue.updated", actor: { type: "user", id: null }, data: { changes: { priority: { from: "normal", to: "urgent" } } } }, names)).toBe("Updated priority → Urgent");
  });
});
