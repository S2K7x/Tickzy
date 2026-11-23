import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { mockApi, renderAt, SIGNED_IN } from "./test-utils.tsx";
import { snippetParts } from "./lib/search.ts";

const ISSUE = {
  id: "iss_1", key: "ACME-12", number: 12, title: "Webhook signature mismatch", status: { category: "waiting_on_us", id: "s", name: "Open" }, priority: "high",
  assignee: null, team_id: null, account: { id: "acc_1", name: "Globex", tier: null }, requester: null, channel: "email", product_area: null, labels: [], fields: {}, sla: [],
  first_response_at: null, resolved_at: null, created_at: "2026-11-23T09:00:00Z", updated_at: new Date().toISOString(), version: 1,
};
const RESULT = (snippet: string) => ({ query: { text: "webhook", filters: {} }, issues: [{ issue: ISSUE, match: { in: "message", message_id: "m1", snippet } }], accounts: [{ id: "acc_1", name: "Globex", domains: ["globex.com"] }] });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe("search page (T-207)", () => {
  it("shows issues with highlighted snippets and matching accounts", async () => {
    mockApi({ "GET /v1/auth/session": { status: 200, body: SIGNED_IN }, "GET /v1/search?q=webhook&limit=30": { status: 200, body: RESULT("our \u0001webhook\u0002 fails <b>bold</b>") } });
    await renderAt("/search?q=webhook");
    const issues = await screen.findByRole("region", { name: /Issues/ });
    expect(within(issues).getByText("Webhook signature mismatch")).toBeTruthy();
    expect(within(issues).getByText("webhook", { selector: "mark" })).toBeTruthy();
    expect(issues.querySelector("b")).toBeNull(); // snippet text is never interpreted as HTML
    expect(within(issues).getByText(/<b>bold<\/b>/)).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Accounts" })).getByText("globex.com")).toBeTruthy();
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  });

  it("explains operators before searching and searches on submit", async () => {
    const calls = mockApi({ "GET /v1/auth/session": { status: 200, body: SIGNED_IN }, "GET /v1/search?q=from%3Ahank%20is%3Aopen&limit=30": { status: 200, body: { query: { text: "", filters: {} }, issues: [], accounts: [] } } });
    const { router } = await renderAt("/search");
    expect(await screen.findByRole("region", { name: "Search operators" })).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Search query"), "from:hank is:open");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ q: "from:hank is:open" }));
    expect(await screen.findByText(/No issues match/)).toBeTruthy();
    expect(calls.some((c) => c.url === "/v1/search?q=from%3Ahank%20is%3Aopen&limit=30")).toBe(true);
  });

  it("splits snippets into plain and highlighted parts", () => {
    expect(snippetParts("a \u0001b\u0002 c \u0001d\u0002")).toEqual([{ text: "a ", hit: false }, { text: "b", hit: true }, { text: " c ", hit: false }, { text: "d", hit: true }]);
    expect(snippetParts("no hits")).toEqual([{ text: "no hits", hit: false }]);
    expect(snippetParts("stray \u0001marker")).toEqual([{ text: "stray marker", hit: false }]);
  });
});
