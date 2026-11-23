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

  it("shows the onboarding checklist instead of invented metrics", async () => {
    mockApi({ "GET /v1/auth/session": { status: 200, body: SIGNED_IN } });
    await renderAt("/");
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((li) => li.querySelector("h2")?.textContent)).toEqual([
      "Connect Slack", "Connect email", "Invite your team", "Set business hours and SLAs",
    ]);
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
