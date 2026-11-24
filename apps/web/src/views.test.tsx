import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { mockApi, renderAt, SIGNED_IN } from "./test-utils.tsx";

/** T-211: saved views in the inbox (and the ⌘K palette). */
const OPEN = "/v1/issues?status=triage,waiting_on_us,waiting_on_customer,blocked&sort=updated";
const base = {
  priority: "urgent", assignee: null, team_id: null, account: null, requester: null, channel: "email", product_area: null, labels: [],
  fields: {}, sla: [], first_response_at: null, resolved_at: null, created_at: "", updated_at: new Date().toISOString(), version: 1,
  status: { category: "waiting_on_us", id: "s", name: "Waiting on us" },
};
const A = { ...base, id: "iss_a", key: "ACME-1", number: 1, title: "Urgent export bug" };
const B = { ...base, id: "iss_b", key: "ACME-2", number: 2, title: "Low priority question", priority: "low" };
const HOT = { id: "vw_01JD00000000000000000000H0", name: "Hot", shared: false, base: "open", filters: { priority: "urgent,high" }, sort: "priority", position: 0, owner_user_id: SIGNED_IN.user.id, owner_name: "Maya Chen", count: 1, can_edit: true, created_at: "", updated_at: "" };
const TEAM = { ...HOT, id: "vw_01JD00000000000000000000T0", name: "Team triage", shared: true, filters: {}, base: "on-us", sort: "updated", owner_user_id: "usr_other", owner_name: "Ben", count: 7, can_edit: false };
const routes = (over: Record<string, unknown> = {}, role = "admin") => mockApi({
  "GET /v1/auth/session": { status: 200, body: { ...SIGNED_IN, workspaces: [{ ...SIGNED_IN.workspaces[0]!, role }] } },
  "GET /v1/views": { status: 200, body: { data: [HOT, TEAM] } },
  [`GET ${OPEN}&limit=50`]: { status: 200, body: { data: [A, B], next_cursor: null } },
  "GET /v1/issues?status=triage,waiting_on_us,waiting_on_customer,blocked&sort=priority&priority=urgent%2Chigh&limit=50": { status: 200, body: { data: [A], next_cursor: null } },
  "GET /v1/issues?status=triage,waiting_on_us,waiting_on_customer,blocked&sort=priority&priority=urgent&limit=50": { status: 200, body: { data: [A], next_cursor: null } },
  "GET /v1/issues?status=triage,waiting_on_us,waiting_on_customer,blocked&sort=updated&priority=urgent&limit=50": { status: 200, body: { data: [A], next_cursor: null } },
  "GET /v1/labels": { status: 200, body: { data: [] } },
  "GET /v1/teams": { status: 200, body: { data: [] } },
  "GET /v1/accounts?limit=50": { status: 200, body: { data: [], next_cursor: null } },
  ...over,
} as never);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe("saved views (T-211)", () => {
  it("shows saved views with counts; opening one applies its tab, filters and sort", async () => {
    const calls = routes();
    const { router } = await renderAt("/inbox");
    const nav = await screen.findByRole("navigation", { name: "Saved views" });
    const hot = within(nav).getByRole("button", { name: /Hot\s*1/ });
    expect(within(nav).getByRole("button", { name: /Team triage\s*7/ }).getAttribute("title")).toBe("Shared view · by Ben");
    await userEvent.click(hot);
    await waitFor(() => expect(router.state.location.search).toEqual({ view: "open", sort: "priority", priority: "urgent,high", saved: HOT.id }));
    await waitFor(() => expect(screen.queryByText("Low priority question")).toBeNull());
    expect(calls.some((c) => c.url.includes("sort=priority&priority=urgent%2Chigh"))).toBe(true);
    expect(hot.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("navigation", { name: "Inbox views" }).querySelector('[aria-current="page"]')).toBeNull();
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  });

  it("marks a changed view Modified; Save changes updates it; Reset restores it", async () => {
    const calls = routes({ "PATCH /v1/views/vw_01JD00000000000000000000H0": { status: 200, body: HOT } });
    const { router } = await renderAt(`/inbox?view=open&sort=priority&priority=urgent&saved=${HOT.id}`);
    expect(await screen.findByText("Modified")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ base: "open", sort: "priority", filters: { priority: "urgent" } }));
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ priority: "urgent,high", saved: HOT.id }));
  });

  it("saves the current state as a new view (shared) and opens it", async () => {
    const created = { ...HOT, id: "vw_01JD00000000000000000000N0", name: "Urgent only", filters: { priority: "urgent" }, sort: "updated", shared: true };
    const calls = routes({ "POST /v1/views": { status: 201, body: created } });
    const { router } = await renderAt("/inbox?priority=urgent");
    await userEvent.click(await screen.findByRole("button", { name: "Save view" }));
    const dlg = screen.getByRole("dialog", { name: "Save view" });
    expect(document.activeElement).toBe(within(dlg).getByLabelText("Name"));
    await userEvent.type(within(dlg).getByLabelText("Name"), "Urgent only");
    await userEvent.click(within(dlg).getByRole("checkbox", { name: /Share with the workspace/ }));
    await userEvent.click(within(dlg).getByRole("button", { name: "Save view" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.body).toEqual({ base: "open", sort: "updated", filters: { priority: "urgent" }, name: "Urgent only", shared: true }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ saved: created.id }));
  });

  it("collaborators can save personal views only; views they cannot edit have no edit/delete", async () => {
    routes({}, "collaborator");
    await renderAt("/inbox?priority=urgent");
    await userEvent.click(await screen.findByRole("button", { name: "Save view" }));
    const share = screen.getByRole("checkbox", { name: /Share with the workspace/ }) as HTMLInputElement;
    expect(share.disabled).toBe(true);
    expect(screen.getByText("Your role can keep personal views only.")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(within(screen.getByRole("navigation", { name: "Saved views" })).getByRole("button", { name: /Team triage/ }));
    await screen.findByText("Team triage", { selector: "span" });
    expect(screen.queryByRole("button", { name: "Edit view" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete view" })).toBeNull();
  });

  it("renames, shares and deletes your own view", async () => {
    const calls = routes({
      "PATCH /v1/views/vw_01JD00000000000000000000H0": { status: 200, body: { ...HOT, name: "Hot stuff", shared: true } },
      "DELETE /v1/views/vw_01JD00000000000000000000H0": { status: 204 },
    });
    const { router } = await renderAt(`/inbox?view=open&sort=priority&priority=urgent%2Chigh&saved=${HOT.id}`);
    await userEvent.click(await screen.findByRole("button", { name: "Edit view" }));
    const dlg = screen.getByRole("dialog", { name: "Edit view “Hot”" });
    await userEvent.clear(within(dlg).getByLabelText("Name"));
    await userEvent.type(within(dlg).getByLabelText("Name"), "Hot stuff");
    await userEvent.click(within(dlg).getByRole("checkbox", { name: /Share/ }));
    await userEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ name: "Hot stuff", shared: true }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete view" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Delete view “Hot”?" })).getByRole("button", { name: "Delete view" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
    await waitFor(() => expect(router.state.location.search.saved).toBeUndefined());
  });

  it("the ⌘K palette lists saved views and opens them", async () => {
    routes();
    const { router } = await renderAt("/inbox");
    await screen.findByRole("navigation", { name: "Saved views" });
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const dlg = await screen.findByRole("dialog", { name: "Command palette" });
    await userEvent.click(within(dlg).getByRole("option", { name: /^Hot/ }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ saved: HOT.id, priority: "urgent,high" }));
  });
});
