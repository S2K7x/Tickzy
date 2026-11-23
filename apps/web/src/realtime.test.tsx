import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { mockApi, renderAt, SIGNED_IN } from "./test-utils.tsx";
import { isLive } from "./lib/realtime.ts";

/** Controllable stand-in for the browser WebSocket: tests play the server's side of the T-208 protocol. */
class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  readonly url: string;
  constructor(url: string) { this.url = url; FakeSocket.all.push(this); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); this.push({ op: "ready" }); }
  push(msg: unknown) { act(() => this.onmessage?.({ data: JSON.stringify(msg) })); }
  drop() { this.readyState = 3; act(() => this.onclose?.()); }
}

const WS = SIGNED_IN.workspaces[0]!.workspace_id;
const OPEN = "/v1/issues?status=triage,waiting_on_us,waiting_on_customer,blocked&sort=updated&limit=50";
const ISSUE = {
  id: "iss_1", key: "ACME-12", number: 12, title: "CSV export times out", status: { category: "waiting_on_us", id: "sts_1", name: "Open" },
  priority: "high", assignee: null, team_id: null, account: null, requester: { id: "con_1", name: "Hank" }, channel: "email",
  product_area: null, labels: [], fields: {}, sla: [], first_response_at: null, resolved_at: null,
  created_at: "2026-11-23T09:00:00Z", updated_at: new Date().toISOString(), version: 3,
};
const base = () => mockApi({
  "GET /v1/auth/session": { status: 200, body: SIGNED_IN },
  [`GET ${OPEN}`]: { status: 200, body: { data: [ISSUE], next_cursor: null } },
  "GET /v1/issues/ACME-12": { status: 200, body: ISSUE },
  "GET /v1/issues/ACME-12/timeline": { status: 200, body: { data: [], truncated: false } },
  "GET /v1/members": { status: 200, body: { data: [] } },
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeSocket.all = [];
  localStorage.clear();
});

describe("realtime client (T-208)", () => {
  it("subscribes to the workspace inbox and refetches the queue on an event", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const calls = base();
    await renderAt("/inbox");
    expect(await screen.findByText("CSV export times out")).toBeTruthy();
    const sock = FakeSocket.all.at(-1)!;
    expect(sock.url).toMatch(/^ws:\/\/[^/]+\/v1\/realtime$/);
    sock.open();
    expect(sock.sent).toContainEqual({ op: "sub", topic: `workspace:${WS}:inbox` });
    sock.push({ op: "subscribed", topic: `workspace:${WS}:inbox` });
    expect(isLive()).toBe(true);

    const before = calls.filter((c) => c.url === OPEN).length;
    sock.push({ op: "event", topic: `workspace:${WS}:inbox`, type: "message.created", issue_id: "iss_1", message_id: "msg_9" });
    // The event carries ids only: the client refetches the list through the (RLS-checked) API.
    await waitFor(() => expect(calls.filter((c) => c.url === OPEN).length).toBeGreaterThan(before));
  });

  it("reconnects after a drop, then resubscribes and catches up", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const calls = base();
    await renderAt("/inbox");
    await screen.findByText("CSV export times out");
    const first = FakeSocket.all.at(-1)!;
    first.open();
    first.push({ op: "subscribed", topic: `workspace:${WS}:inbox` });
    first.drop();
    expect(isLive()).toBe(false); // polling fallback resumes while offline
    await waitFor(() => expect(FakeSocket.all.length).toBe(2), { timeout: 3000 });
    const second = FakeSocket.all[1]!;
    second.open();
    expect(second.sent).toContainEqual({ op: "sub", topic: `workspace:${WS}:inbox` });
    const before = calls.filter((c) => c.url === OPEN).length;
    second.push({ op: "subscribed", topic: `workspace:${WS}:inbox` });
    await waitFor(() => expect(calls.filter((c) => c.url === OPEN).length).toBeGreaterThan(before));
  });

  it("joins the open issue's presence, shows teammates and sends typing from the composer", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    base();
    await renderAt("/inbox?issue=ACME-12");
    await screen.findByRole("heading", { name: "CSV export times out" });
    const sock = FakeSocket.all.at(-1)!;
    sock.open();
    sock.push({ op: "subscribed", topic: `workspace:${WS}:inbox` });
    await waitFor(() => expect(sock.sent).toContainEqual({ op: "sub", topic: "issue:iss_1" }));
    // Presence waits for the server to confirm the issue subscription (it would be rejected before that).
    expect(sock.sent.some((m) => m.op === "presence")).toBe(false);
    sock.push({ op: "subscribed", topic: "issue:iss_1" });
    expect(sock.sent).toContainEqual({ op: "presence", issue_id: "iss_1", state: "viewing" });

    sock.push({ op: "presence", issue_id: "iss_1", viewers: [
      { user_id: SIGNED_IN.user.id, name: "Me", state: "viewing" },
      { user_id: "usr_2", name: "Ben", state: "viewing" },
    ] });
    expect(await screen.findByText("Ben is viewing")).toBeTruthy(); // never lists yourself
    sock.push({ op: "presence", issue_id: "iss_1", viewers: [{ user_id: "usr_2", name: "Ben", state: "typing" }] });
    expect(await screen.findByText("Ben is typing…")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Reply to the customer"), { target: { value: "On it" } });
    expect(sock.sent).toContainEqual({ op: "presence", issue_id: "iss_1", state: "typing" });
  });
});
