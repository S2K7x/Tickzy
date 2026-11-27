import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { mockApi, renderAt, SIGNED_IN } from "./test-utils.tsx";

/** T-302a: inbound email flags on the timeline (threat model TM-6, FR-2.7). */
const ISSUE = {
  id: "iss_1", key: "ACME-9", number: 9, title: "Invoice question", priority: "normal", status: { category: "waiting_on_us", id: "s", name: "Waiting on us" },
  assignee: null, team_id: null, account: null, requester: { id: "con_1", name: "The CEO" }, channel: "email", product_area: null, labels: [], fields: {}, sla: [],
  first_response_at: null, resolved_at: null, created_at: "2026-11-27T09:00:00Z", updated_at: new Date().toISOString(), version: 1,
};
const msg = (id: string, text: string, meta: Record<string, unknown>) => ({
  kind: "message", id, created_at: "2026-11-27T09:00:00Z",
  message: { id, visibility: "public", direction: "in", author: { type: "contact", id: "con_1", name: "The CEO" }, body: { text, ast: null }, source: "email", delivery_state: "received", edited_at: null, meta },
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("inbound email flags", () => {
  it("shows unverified sender, separate thread, automated, spam and not-imported attachments — as text, with explanations", async () => {
    mockApi({
      "GET /v1/auth/session": { status: 200, body: SIGNED_IN },
      "GET /v1/issues?status=triage,waiting_on_us,waiting_on_customer,blocked&sort=updated&limit=50": { status: 200, body: { data: [ISSUE], next_cursor: null } },
      "GET /v1/issues/ACME-9": { status: 200, body: ISSUE },
      "GET /v1/issues/ACME-9/timeline": { status: 200, body: { truncated: false, data: [
        msg("msg_1", "Wire the refund to IBAN X", { sender_verified: false, thread_unverified: true, spam: true }),
        msg("msg_2", "I'm out until Monday", { sender_verified: true, automated: true, automated_reason: "Auto-Submitted: auto-replied" }),
        msg("msg_3", "Logs attached", { sender_verified: true, attachments_imported: false, attachments: [{ name: "app.log", type: "text/plain", size: 10, inline: false }, { name: "db.log", type: "text/plain", size: 9, inline: false }] }),
        msg("msg_4", "Plain verified mail", { sender_verified: true }),
      ] } },
      "GET /v1/members": { status: 200, body: { data: [] } },
      "GET /v1/labels": { status: 200, body: { data: [] } },
      "GET /v1/teams": { status: 200, body: { data: [] } },
      "GET /v1/views": { status: 200, body: { data: [] } },
    } as never);
    await renderAt("/inbox?issue=ACME-9");
    const timeline = await screen.findByRole("list", { name: "Timeline" });
    await within(timeline).findByText("Wire the refund to IBAN X");
    const items = within(timeline).getAllByRole("listitem");
    const spoof = items.find((li) => li.textContent?.includes("IBAN"))!;
    expect(within(spoof).getByText("Unverified sender").getAttribute("title")).toMatch(/could not be authenticated/);
    expect(within(spoof).getByText("Not added to the earlier thread")).toBeTruthy();
    expect(within(spoof).getByText("Possible spam")).toBeTruthy();
    const ooo = items.find((li) => li.textContent?.includes("out until Monday"))!;
    expect(within(ooo).getByText("Automated").getAttribute("title")).toContain("did not reopen");
    const files = items.find((li) => li.textContent?.includes("Logs attached"))!;
    expect(within(files).getByText("2 attachments not imported yet").getAttribute("title")).toBe("app.log, db.log");
    const plain = items.find((li) => li.textContent?.includes("Plain verified mail"))!;
    expect(within(plain).queryByText(/Unverified|Automated|spam|attachment/)).toBeNull();
    const results = await axe.run(timeline, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  });

  it("is honest about delivery: before outbound email, replies are 'saved but not sent' and marked 'Not sent'", async () => {
    const reply = { kind: "message", id: "msg_out", created_at: "2026-11-27T09:05:00Z",
      message: { id: "msg_out", visibility: "public", direction: "out", author: { type: "member", id: "usr_1", name: "Maya" }, body: { text: "We are on it", ast: null }, source: "ui", delivery_state: null, edited_at: null, meta: {} } };
    const routes = (deliverable: string[]) => mockApi({
      "GET /v1/auth/session": { status: 200, body: SIGNED_IN },
      "GET /v1/issues?status=triage,waiting_on_us,waiting_on_customer,blocked&sort=updated&limit=50": { status: 200, body: { data: [ISSUE], next_cursor: null } },
      "GET /v1/issues/ACME-9": { status: 200, body: ISSUE },
      "GET /v1/issues/ACME-9/timeline": { status: 200, body: { truncated: false, data: [reply] } },
      "GET /v1/channels/delivery": { status: 200, body: { deliverable } },
      "GET /v1/members": { status: 200, body: { data: [] } },
      "GET /v1/labels": { status: 200, body: { data: [] } },
      "GET /v1/teams": { status: 200, body: { data: [] } },
      "GET /v1/views": { status: 200, body: { data: [] } },
    } as never);
    routes([]);
    await renderAt("/inbox?issue=ACME-9");
    expect(await screen.findByText(/Saved on the issue but not sent: Email replies are not available yet\./)).toBeTruthy();
    expect(await within(screen.getByRole("list", { name: "Timeline" })).findByText("Not sent")).toBeTruthy();
    cleanup();
    vi.unstubAllGlobals();
    routes(["email"]);
    await renderAt("/inbox?issue=ACME-9");
    expect(await screen.findByText(/Sent to the customer's conversation\./)).toBeTruthy();
    await screen.findByText("We are on it");
    expect(screen.queryByText("Not sent")).toBeNull();
  });
});
