import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { mockApi, renderAt, SIGNED_IN } from "./test-utils.tsx";

/** T-209b part 2: ⌘K command palette and the a/s/p/l issue shortcuts; virtualised queue. */
const OPEN = "/v1/issues?status=triage,waiting_on_us,waiting_on_customer,blocked&sort=updated&limit=50";
const base = {
  priority: "normal", assignee: null, team_id: null, account: null, requester: null, channel: "email", product_area: null, labels: [],
  fields: {}, sla: [], first_response_at: null, resolved_at: null, created_at: "2026-11-23T09:00:00Z", updated_at: new Date().toISOString(), version: 1,
  status: { category: "waiting_on_us", id: "sts_1", name: "Waiting on us" },
};
const A = { ...base, id: "iss_a", key: "ACME-1", number: 1, title: "Export fails" };
const B = { ...base, id: "iss_b", key: "ACME-2", number: 2, title: "SSO login loop" };
const ME = { id: "mem_me", user_id: SIGNED_IN.user.id, name: "Maya", email: "maya@acme.test", role: "admin", status: "active", joined_at: "" };
const BEN = { id: "mem_ben", user_id: "usr_ben", name: "Ben", email: "ben@acme.test", role: "agent", status: "active", joined_at: "" };
const routes = (over: Record<string, unknown> = {}) => mockApi({
  "GET /v1/auth/session": { status: 200, body: SIGNED_IN },
  [`GET ${OPEN}`]: { status: 200, body: { data: [A, B], next_cursor: null } },
  "GET /v1/issues?q=sso&limit=8": { status: 200, body: { data: [B] } },
  "GET /v1/issues/ACME-1": { status: 200, body: A },
  "GET /v1/issues/ACME-1/timeline": { status: 200, body: { data: [], truncated: false } },
  "GET /v1/issues/ACME-2": { status: 200, body: B },
  "GET /v1/issues/ACME-2/timeline": { status: 200, body: { data: [], truncated: false } },
  "PATCH /v1/issues/ACME-1": { status: 200, body: A },
  "GET /v1/members": { status: 200, body: { data: [ME, BEN] } },
  "GET /v1/labels": { status: 200, body: { data: [{ id: "lbl_vip", name: "vip", color: "#2563eb", description: null, parent_id: null }] } },
  "GET /v1/teams": { status: 200, body: { data: [] } },
  ...over,
} as never);

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
const palette = () => screen.findByRole("dialog", { name: "Command palette" });

describe("command palette (⌘K)", () => {
  it("opens with ⌘K, finds an issue by title through the API and opens it", async () => {
    const calls = routes();
    const { router } = await renderAt("/inbox");
    await screen.findByText("Export fails");
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const dlg = await palette();
    const input = within(dlg).getByRole("combobox");
    expect(document.activeElement).toBe(input);
    await userEvent.type(input, "sso");
    const hit = await within(dlg).findByRole("option", { name: /ACME-2\s*SSO login loop/ });
    expect(calls.some((c) => c.url === "/v1/issues?q=sso&limit=8")).toBe(true);
    expect(within(dlg).getByRole("option", { name: /Search everything for “sso”/ })).toBeTruthy();
    const results = await axe.run(dlg, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
    // Enter (not a click): the highlight must have moved to the issue once results arrived.
    await waitFor(() => expect(hit.getAttribute("aria-selected")).toBe("true"));
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(router.state.location.search).toMatchObject({ issue: "ACME-2" }));
    expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
  });

  it("navigates and toggles closed with ⌘K or Esc", async () => {
    routes();
    const { router } = await renderAt("/inbox");
    await screen.findByText("Export fails");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const dlg = await palette();
    expect(within(dlg).queryByText(/^Issue ACME/)).toBeNull(); // no issue open → no issue commands
    await userEvent.type(within(dlg).getByRole("combobox"), "settings");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/members"));
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    await palette();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull());
  });

  it("runs commands on the open issue: Assign to me, and p → priority page → Urgent", async () => {
    const calls = routes();
    await renderAt("/inbox?issue=ACME-1");
    await screen.findByRole("heading", { level: 2, name: "Export fails" });
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    let dlg = await palette();
    await userEvent.click(await within(dlg).findByRole("option", { name: "Assign to me" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH").at(-1)?.body).toEqual({ assignee_membership_id: "mem_me" }));

    fireEvent.keyDown(window, { key: "p" });
    dlg = await palette();
    expect(within(dlg).getByText(/ACME-1 · Set priority…/)).toBeTruthy();
    await userEvent.type(within(dlg).getByRole("combobox"), "urg");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH").at(-1)?.body).toEqual({ priority: "urgent" }));
  });

  it("a → assign page lists assignable members; l adds a label; Backspace on empty input goes back", async () => {
    const calls = routes();
    await renderAt("/inbox?issue=ACME-1");
    await screen.findByRole("heading", { level: 2, name: "Export fails" });
    fireEvent.keyDown(window, { key: "a" });
    let dlg = await palette();
    await within(dlg).findByRole("option", { name: "Ben" });
    await userEvent.keyboard("{Backspace}");
    expect(await within(dlg).findByRole("option", { name: /New issue/ })).toBeTruthy(); // back on the root page
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull());
    fireEvent.keyDown(window, { key: "l" });
    dlg = await palette();
    await userEvent.click(await within(dlg).findByRole("option", { name: "vip" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH").at(-1)?.body).toEqual({ labels: ["lbl_vip"] }));
  });
});

describe("virtualised queue", () => {
  it("renders only the rows in view and exposes each row's position in the whole list", async () => {
    const many = Array.from({ length: 300 }, (_, n) => ({ ...base, id: `iss_${n}`, key: `ACME-${n + 1}`, number: n + 1, title: `Issue number ${n + 1}` }));
    routes({ [`GET ${OPEN}`]: { status: 200, body: { data: many, next_cursor: null } } });
    await renderAt("/inbox");
    await screen.findByText("Issue number 1");
    const rows = within(screen.getByRole("list", { name: "Issues" })).getAllByRole("listitem");
    expect(rows.length).toBeLessThan(40); // 800px / 96px + overscan, not 300
    expect(rows[0]!.getAttribute("aria-setsize")).toBe("300");
    expect(rows[0]!.getAttribute("aria-posinset")).toBe("1");
    expect(screen.queryByText("Issue number 300")).toBeNull();
  });
});
