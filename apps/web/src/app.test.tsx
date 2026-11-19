import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider } from "@tanstack/react-router";
import axe from "axe-core";
import { createAppRouter, testHistory } from "./router.tsx";
import { THEME_KEY, initialTheme } from "./theme.ts";

async function renderAt(path: string) {
  const router = createAppRouter(testHistory(path));
  await router.load();
  const utils = render(<RouterProvider router={router} />);
  return { router, ...utils };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("app shell (T-010)", () => {
  it("renders all three navigation variants for the responsive breakpoints", async () => {
    await renderAt("/");
    expect(await screen.findByTestId("sidebar")).toBeTruthy();
    expect(screen.getByTestId("icon-rail")).toBeTruthy();
    expect(screen.getByTestId("bottom-tabs")).toBeTruthy();
  });

  it("marks the active destination with aria-current", async () => {
    await renderAt("/inbox");
    const sidebar = await screen.findByTestId("sidebar");
    const current = within(sidebar).getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual(["Inbox"]);
  });

  it("shows the onboarding checklist instead of invented metrics on a new workspace", async () => {
    await renderAt("/");
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((li) => li.querySelector("h2")?.textContent)).toEqual([
      "Connect Slack", "Connect email", "Invite your team", "Set business hours and SLAs",
    ]);
  });

  it("toggles dark mode, applies it to <html> and persists the choice", async () => {
    await renderAt("/");
    const btn = await screen.findByRole("button", { name: "Switch to dark mode" });
    await userEvent.click(btn);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(screen.getByRole("button", { name: "Switch to light mode" })).toBeTruthy();
  });

  it("prefers a stored theme over the system preference", () => {
    localStorage.setItem(THEME_KEY, "dark");
    expect(initialTheme()).toBe("dark");
  });

  it("has no serious accessibility violations", async () => {
    const { container } = await renderAt("/");
    await screen.findByRole("heading", { name: "Overview" });
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } }); // contrast is checked in a real browser
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});
