import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { mockApi, renderAt, SIGNED_IN } from "./test-utils.tsx";
import { formatDuration } from "./lib/issues.ts";

const STATS = {
  counts: { open: 7, waiting_on_us: 3, waiting_on_customer: 2, mine: 1, unassigned: 4, done: 12 },
  kpis: { new_today: 6, new_yesterday: 4, waiting_on_us: 3, avg_wait_seconds: 7200, waiting_on_customer: 2, resolved_7d: 12, resolved_prev_7d: 10, median_first_response_seconds_7d: 1500 },
  series: Array.from({ length: 14 }, (_, i) => ({ day: `2026-11-${String(10 + i)}`, created: i % 3, resolved: i % 2, first_responses: 1, customer_messages: i, team_replies: 2 })),
};
const ISSUE = {
  id: "iss_1", key: "ACME-12", number: 12, title: "CSV export times out", status: { category: "waiting_on_us", id: "s", name: "Open" }, priority: "high",
  assignee: null, team_id: null, account: { id: "acc_1", name: "Globex", tier: null }, requester: { id: "con_1", name: "Hank Scorpio" }, channel: "email",
  product_area: null, labels: [], fields: {}, sla: [], first_response_at: null, resolved_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), version: 1,
};
const OPEN_Q = "/v1/issues?status=triage,waiting_on_us,waiting_on_customer,blocked&sort=newest&limit=50";
const MEMBERS = { data: [{ id: "mem_me", user_id: SIGNED_IN.user.id, name: "Maya Chen", email: "maya@acme.test", role: "admin", status: "active", joined_at: "" }] };
const base = (over: Record<string, unknown> = {}) => mockApi({
  "GET /v1/auth/session": { status: 200, body: SIGNED_IN },
  "GET /v1/issues/stats": { status: 200, body: STATS },
  [`GET ${OPEN_Q}`]: { status: 200, body: { data: [ISSUE], next_cursor: null } },
  "GET /v1/members": { status: 200, body: MEMBERS },
  ...over,
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe("Overview (design v2)", () => {
  it("shows real KPIs with deltas and 14-day charts", async () => {
    base();
    await renderAt("/");
    const kpis = await screen.findByRole("region", { name: "Key numbers" });
    await within(kpis).findByText("New issues");
    expect(kpis.textContent).toContain("6");
    expect(kpis.textContent).toContain("2.0 h avg. wait");
    expect(kpis.textContent).toContain("↑ 20% vs last week");
    expect(kpis.textContent).toContain("25 min");
    expect(within(kpis).getAllByRole("img").length).toBe(5);
    expect(within(kpis).getByRole("img", { name: /Issues resolved per day: 0, 1, 0/ })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Set up your workspace" })).toBeNull();
  });

  it("lists issues with tab counts and row actions; actions call the API", async () => {
    const calls = base({ "PATCH /v1/issues/ACME-12": { status: 200, body: ISSUE } });
    await renderAt("/");
    const table = await screen.findByRole("region", { name: "All issues" });
    await within(table).findAllByText("CSV export times out");
    expect(within(table).getAllByText("Hank Scorpio").length).toBeGreaterThan(0);
    expect(within(table).getByRole("button", { name: /Waiting on us\s*3/ })).toBeTruthy();
    expect(within(table).getByText("Showing 1–1 of 7")).toBeTruthy();
    await userEvent.click(within(table).getAllByRole("button", { name: /^Assign\s*to me\s*,\s*ACME-12$/ })[0]!);
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ assignee_membership_id: "mem_me" }));
    await userEvent.click(within(table).getAllByRole("button", { name: /^Resolve\s*,\s*ACME-12$/ })[0]!);
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH")[1]!.body).toEqual({ status: "resolved" }));
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  });

  it("tabs, search and the priority filter drive the query", async () => {
    const calls = base({
      "GET /v1/issues?status=triage,waiting_on_us&sort=newest&limit=50": { status: 200, body: { data: [], next_cursor: null } },
      "GET /v1/issues?status=triage,waiting_on_us&sort=newest&priority=urgent&limit=50": { status: 200, body: { data: [], next_cursor: null } },
      "GET /v1/issues?status=triage,waiting_on_us&sort=newest&priority=urgent&q=csv&limit=50": { status: 200, body: { data: [ISSUE], next_cursor: null } },
    });
    await renderAt("/");
    const table = await screen.findByRole("region", { name: "All issues" });
    await userEvent.click(within(table).getByRole("button", { name: /Waiting on us/ }));
    expect(await within(table).findByText(/No issues here/)).toBeTruthy();
    await userEvent.selectOptions(within(table).getByLabelText("Filter by priority"), "urgent");
    await userEvent.type(within(table).getByLabelText("Search issues"), "csv");
    expect((await within(table).findAllByText("CSV export times out")).length).toBeGreaterThan(0);
    expect(calls.some((c) => c.url.includes("priority=urgent&q=csv"))).toBe(true);
  });

  it("pages with Previous / Next over the keyset cursor", async () => {
    const page2 = { ...ISSUE, id: "iss_2", key: "ACME-2", title: "Older issue" };
    base({
      [`GET ${OPEN_Q}`]: { status: 200, body: { data: [ISSUE], next_cursor: "c1" } },
      [`GET ${OPEN_Q}&cursor=c1`]: { status: 200, body: { data: [page2], next_cursor: null } },
    });
    await renderAt("/");
    const table = await screen.findByRole("region", { name: "All issues" });
    await within(table).findAllByText("CSV export times out");
    expect((within(table).getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(within(table).getByRole("button", { name: "Next" }));
    expect((await within(table).findAllByText("Older issue")).length).toBeGreaterThan(0);
    expect(within(table).queryAllByText("CSV export times out")).toEqual([]);
    expect((within(table).getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(within(table).getByRole("button", { name: "Previous" }));
    expect((await within(table).findAllByText("CSV export times out")).length).toBeGreaterThan(0);
  });
});

describe("shell (design v2)", () => {
  it("breadcrumb workspace switcher lists the user's workspaces and switches", async () => {
    const two = { ...SIGNED_IN, workspaces: [...SIGNED_IN.workspaces, { workspace_id: "ws_01JD0000000000000000000002", name: "Initech", slug: "initech", role: "agent" }] };
    mockApi({ "GET /v1/auth/session": { status: 200, body: two }, "GET /v1/issues/stats": { status: 200, body: STATS } });
    await renderAt("/settings/members");
    await userEvent.click(await screen.findByRole("button", { name: /switch workspace/ }));
    const menu = screen.getByRole("menu", { name: "Switch workspace" });
    expect(within(menu).getAllByRole("menuitemradio").map((m) => m.textContent)).toEqual(["Acme CloudCurrent", "Initech"]);
    await userEvent.click(within(menu).getByRole("menuitemradio", { name: /Initech/ }));
    expect(localStorage.getItem("tickzy.workspace")).toBe("ws_01JD0000000000000000000002");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("'/' focuses search; Enter opens the inbox filtered by the text", async () => {
    base({ "GET /v1/issues?status=triage,waiting_on_us,waiting_on_customer,blocked&sort=updated&q=export&limit=50": { status: 200, body: { data: [ISSUE], next_cursor: null } } });
    const { router } = await renderAt("/");
    await screen.findByRole("region", { name: "Key numbers" });
    await userEvent.keyboard("/");
    expect(document.activeElement).toBe(screen.getByLabelText("Search issues", { selector: "#global-search" }));
    await userEvent.keyboard("export{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe("/inbox"));
    expect(router.state.location.search).toMatchObject({ q: "export" });
    expect(await screen.findByText(/Results for/)).toBeTruthy();
  });

  it("'?' opens the shortcuts sheet, 'c' opens New issue, the sidebar collapse is remembered", async () => {
    base();
    await renderAt("/");
    await screen.findByRole("region", { name: "Key numbers" });
    await userEvent.keyboard("?");
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("c");
    expect(screen.getByRole("dialog", { name: "New issue" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getAllByRole("button", { name: "Collapse sidebar" })[0]!);
    expect(localStorage.getItem("tickzy.sidebar")).toBe("rail");
  });

  it("sidebar shows real counts next to Inbox and My issues", async () => {
    base();
    await renderAt("/");
    const sidebar = await screen.findByTestId("sidebar");
    expect(await within(sidebar).findByLabelText("3 issues")).toBeTruthy();
    expect(within(sidebar).getByLabelText("1 issues")).toBeTruthy();
  });

  it("formats durations", () => {
    expect([null, 42, 1500, 7200, 155_520].map(formatDuration)).toEqual(["—", "42s", "25 min", "2.0 h", "1.8 days"]);
  });
});
