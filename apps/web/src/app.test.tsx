import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { THEME_KEY, initialTheme } from "./theme.ts";
import { mockApi, renderAt, SIGNED_IN } from "./test-utils.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("app shell (T-010)", () => {
  it("renders all three navigation variants for the responsive breakpoints", async () => {
    mockApi({ "GET /v1/auth/session": { status: 200, body: SIGNED_IN } });
    await renderAt("/");
    expect(await screen.findByTestId("sidebar")).toBeTruthy();
    expect(screen.getByTestId("icon-rail")).toBeTruthy();
    expect(screen.getByTestId("bottom-tabs")).toBeTruthy();
  });

  it("marks the active destination with aria-current", async () => {
    mockApi({ "GET /v1/auth/session": { status: 200, body: SIGNED_IN } });
    await renderAt("/inbox");
    const sidebar = await screen.findByTestId("sidebar");
    const current = within(sidebar).getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual(["Inbox"]);
  });

  it("an empty workspace shows the setup checklist and real zero metrics — never invented numbers", async () => {
    const zero = { counts: { open: 0, waiting_on_us: 0, waiting_on_customer: 0, mine: 0, unassigned: 0, done: 0 },
      kpis: { new_today: 0, new_yesterday: 0, waiting_on_us: 0, avg_wait_seconds: null, waiting_on_customer: 0, resolved_7d: 0, resolved_prev_7d: 0, median_first_response_seconds_7d: null },
      series: Array.from({ length: 14 }, (_, i) => ({ day: `2026-11-${String(10 + i)}`, created: 0, resolved: 0, first_responses: 0, customer_messages: 0, team_replies: 0 })) };
    mockApi({ "GET /v1/auth/session": { status: 200, body: SIGNED_IN }, "GET /v1/issues/stats": { status: 200, body: zero } });
    await renderAt("/");
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeTruthy();
    const setup = await screen.findByRole("region", { name: "Set up your workspace" });
    expect(Array.from(setup.querySelectorAll("h3")).map((h) => h.textContent)).toEqual([
      "Connect Slack", "Connect email", "Invite your team", "Set business hours and SLAs",
    ]);
    const kpis = screen.getByRole("region", { name: "Key numbers" });
    expect(kpis.textContent).toContain("Waiting on us0");
    expect(kpis.textContent).toContain("—"); // no first response yet: a dash, not a made-up time
  });

  it("shows the signed-in user and workspace", async () => {
    mockApi({ "GET /v1/auth/session": { status: 200, body: SIGNED_IN } });
    await renderAt("/");
    expect(await screen.findByText("Maya Chen")).toBeTruthy();
    expect(screen.getByText("Acme Cloud")).toBeTruthy();
  });

  it("toggles dark mode, applies it to <html> and persists the choice", async () => {
    mockApi({ "GET /v1/auth/session": { status: 200, body: SIGNED_IN } });
    await renderAt("/");
    await userEvent.click(await screen.findByRole("button", { name: "Switch to dark mode" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
  });

  it("prefers a stored theme over the system preference", () => {
    localStorage.setItem(THEME_KEY, "dark");
    expect(initialTheme()).toBe("dark");
  });

  it("has no serious accessibility violations", async () => {
    mockApi({ "GET /v1/auth/session": { status: 200, body: SIGNED_IN } });
    const { container } = await renderAt("/");
    await screen.findByRole("heading", { name: "Overview" });
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});
