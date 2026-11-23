import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { mockApi, renderAt, SIGNED_IN } from "./test-utils.tsx";

/** T-209b: queue filters, multi-select + bulk actions, team and label editing. */
const OPEN = "/v1/issues?status=triage,waiting_on_us,waiting_on_customer,blocked&sort=updated";
const base = {
  priority: "normal", assignee: null, team_id: null, account: null, requester: null, channel: "email", product_area: null, labels: [] as { id: string; name: string; color: string }[],
  fields: {}, sla: [], first_response_at: null, resolved_at: null, created_at: "2026-11-23T09:00:00Z", updated_at: new Date().toISOString(), version: 1,
  status: { category: "waiting_on_us", id: "sts_1", name: "Waiting on us" },
};
const A = { ...base, id: "iss_a", key: "ACME-1", number: 1, title: "Export fails" };
const B = { ...base, id: "iss_b", key: "ACME-2", number: 2, title: "SSO loop", priority: "high" };
const C = { ...base, id: "iss_c", key: "ACME-3", number: 3, title: "Old closed thing", status: { category: "closed", id: "sts_9", name: "Closed" } };
const LABELS = { data: [{ id: "lbl_bug", name: "bug", color: "#dc2626", description: null, parent_id: null }, { id: "lbl_vip", name: "vip", color: "#2563eb", description: null, parent_id: null }] };
const TEAMS = { data: [{ id: "tm_1", name: "Billing" }] };
const routes = (over: Record<string, unknown> = {}) => mockApi({
  "GET /v1/auth/session": { status: 200, body: SIGNED_IN },
  [`GET ${OPEN}&limit=50`]: { status: 200, body: { data: [A, B, C], next_cursor: null } },
  [`GET ${OPEN}&priority=high%2Curgent&channel=email&limit=50`]: { status: 200, body: { data: [B], next_cursor: null } },
  [`GET ${OPEN}&label=lbl_vip&limit=50`]: { status: 200, body: { data: [], next_cursor: null } },
  "GET /v1/labels": { status: 200, body: LABELS },
  "GET /v1/teams": { status: 200, body: TEAMS },
  "GET /v1/members": { status: 200, body: { data: [{ id: "mem_1", user_id: SIGNED_IN.user.id, name: "Maya", email: "maya@acme.test", role: "admin", status: "active", joined_at: "" }] } },
  "GET /v1/issues/ACME-1": { status: 200, body: A },
  "GET /v1/issues/ACME-1/timeline": { status: 200, body: { data: [], truncated: false } },
  ...over,
} as never);

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe("queue filters (T-209b)", () => {
  it("filters by priority and channel through the URL and the API; chips remove them", async () => {
    const calls = routes();
    const { router } = await renderAt("/inbox");
    const queue = await screen.findByRole("region", { name: "Issue queue" });
    await within(queue).findByText("Export fails");
    const toggle = within(queue).getByRole("button", { name: "Filter" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);
    const panel = within(queue).getByRole("group", { name: "Filters" });
    await userEvent.click(within(panel).getByRole("checkbox", { name: "High" }));
    await userEvent.click(within(panel).getByRole("checkbox", { name: "Urgent" }));
    await userEvent.click(within(panel).getByRole("checkbox", { name: "Email" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ priority: "high,urgent", channel: "email" }));
    await waitFor(() => expect(within(queue).queryByText("Export fails")).toBeNull());
    expect(within(queue).getByText("SSO loop")).toBeTruthy();
    expect(calls.some((c) => c.url.includes("priority=high%2Curgent&channel=email"))).toBe(true);
    expect(within(queue).getByRole("button", { name: "Filter, 2 active" })).toBeTruthy();
    const chips = within(queue).getByRole("list", { name: "Active filters" });
    await userEvent.click(within(chips).getByRole("button", { name: "Clear all" }));
    await waitFor(() => expect(router.state.location.search.priority).toBeUndefined());
    expect(await within(queue).findByText("Export fails")).toBeTruthy();
    // jsdom has no CSS: serious/critical only (responsive duplicates count here); the browser run checks everything.
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
    await userEvent.click(toggle);
    expect(within(queue).queryByRole("group", { name: "Filters" })).toBeNull();
  });

  it("a label filter loaded from the URL shows its chip and explains an empty result", async () => {
    routes();
    await renderAt("/inbox?label=lbl_vip");
    expect(await screen.findByRole("button", { name: "Remove filter Label: vip" })).toBeTruthy();
    expect(await screen.findByText(/No issues match these filters/)).toBeTruthy();
  });
});

describe("bulk actions (FR-3.10)", () => {
  it("selects with checkboxes and x, applies a status to all, and reports the ones that could not change", async () => {
    const calls = routes({
      "POST /v1/issues/bulk": { status: 200, body: { results: [
        { ref: "iss_a", ok: true, issue: { ...A, status: { category: "resolved", id: "s", name: "Resolved" } } },
        { ref: "iss_c", ok: false, error: { code: "conflict", message: "Closed issues cannot be reopened; a follow-up opens a new issue." } },
      ] } },
    });
    await renderAt("/inbox");
    const queue = await screen.findByRole("region", { name: "Issue queue" });
    await within(queue).findByText("Export fails");
    expect(within(queue).queryByRole("region", { name: "Bulk actions" })).toBeNull();
    await userEvent.click(within(queue).getByRole("checkbox", { name: "Select ACME-1" }));
    const bar = within(queue).getByRole("region", { name: "Bulk actions" });
    expect(within(bar).getByText("1 selected")).toBeTruthy();
    await userEvent.click(within(bar).getByRole("button", { name: "Select all 3" }));
    expect(within(bar).getByText("3 selected")).toBeTruthy();
    await userEvent.click(within(queue).getByRole("checkbox", { name: "Select ACME-2" })); // unselect one
    fireEvent.change(within(bar).getByRole("combobox", { name: "Set status of selected issues" }), { target: { value: "resolved" } });
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(1));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ issues: ["iss_a", "iss_c"], changes: { status: "resolved" } });
    const status = await within(queue).findByText(/1 not changed/);
    expect(status.textContent).toContain("ACME-3 — Closed issues cannot be reopened");
    expect(within(queue).getByText("Updated 1 issue.")).toBeTruthy();
    // The failed issue stays selected for a retry; the successful one is released.
    expect(within(within(queue).getByRole("region", { name: "Bulk actions" })).getByText("1 selected")).toBeTruthy();
    expect((within(queue).getByRole("checkbox", { name: "Select ACME-3" }) as HTMLInputElement).checked).toBe(true);
  });

  it("adds a label and assigns in bulk; keyboard x toggles the open issue", async () => {
    const calls = routes({ "POST /v1/issues/bulk": { status: 200, body: { results: [{ ref: "iss_a", ok: true, issue: A }] } } });
    await renderAt("/inbox?issue=ACME-1");
    await screen.findByRole("heading", { level: 2, name: "Export fails" });
    fireEvent.keyDown(window, { key: "x" });
    const bar = await screen.findByRole("region", { name: "Bulk actions" });
    fireEvent.change(within(bar).getByRole("combobox", { name: "Label selected issues" }), { target: { value: "add:lbl_vip" } });
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(1));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ issues: ["iss_a"], changes: { add_labels: ["lbl_vip"] } });
    expect(await screen.findByText("Updated 1 issue.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull(); // everything succeeded → selection released
  });
});

describe("issue details: team and labels", () => {
  it("sets the team, removes and adds labels, and creates a new label inline", async () => {
    const withLabel = { ...A, labels: [{ id: "lbl_bug", name: "bug", color: "#dc2626" }] };
    const calls = routes({
      "GET /v1/issues/ACME-1": { status: 200, body: withLabel },
      "PATCH /v1/issues/ACME-1": { status: 200, body: withLabel },
      "POST /v1/labels": { status: 201, body: { id: "lbl_new", name: "needs repro", color: "#7c3aed", description: null, parent_id: null } },
    });
    await renderAt("/inbox?issue=ACME-1");
    const details = await screen.findByRole("complementary", { name: "Issue details" });
    await within(details).findByRole("button", { name: "Remove label bug" });
    fireEvent.change(within(details).getByLabelText("Team"), { target: { value: "tm_1" } });
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH").at(-1)?.body).toEqual({ team_id: "tm_1" }));
    await userEvent.click(within(details).getByRole("button", { name: "Remove label bug" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH").at(-1)?.body).toEqual({ labels: [] }));
    fireEvent.change(within(details).getByRole("combobox", { name: "Add label" }), { target: { value: "lbl_vip" } });
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH").at(-1)?.body).toEqual({ labels: ["lbl_bug", "lbl_vip"] }));
    fireEvent.change(within(details).getByRole("combobox", { name: "Add label" }), { target: { value: "__new" } });
    await userEvent.type(within(details).getByLabelText("New label name"), "needs repro");
    await userEvent.click(within(details).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST" && c.url === "/v1/labels")?.body).toEqual({ name: "needs repro" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH").at(-1)?.body).toEqual({ labels: ["lbl_bug", "lbl_new"] }));
  });
});
