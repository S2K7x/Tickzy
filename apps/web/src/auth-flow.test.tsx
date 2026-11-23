import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi, renderAt, SIGNED_IN } from "./test-utils.tsx";
import { prefixFrom, slugify } from "./pages/Onboarding.tsx";

const UNAUTH = { status: 401, body: { error: { code: "unauthenticated", message: "Authentication required", request_id: "req_1" } } };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.location.hash = "";
});

describe("route guard (T-105)", () => {
  it("sends signed-out visitors to sign-in", async () => {
    mockApi({ "GET /v1/auth/session": UNAUTH });
    const { router } = await renderAt("/inbox");
    expect(await screen.findByRole("heading", { name: "Sign in to Tickzy" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/sign-in");
  });

  it("sends signed-in users without a workspace to onboarding", async () => {
    mockApi({ "GET /v1/auth/session": { status: 200, body: { ...SIGNED_IN, workspaces: [] } } });
    const { router } = await renderAt("/");
    expect(await screen.findByRole("heading", { name: "Create your workspace" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/onboarding");
  });

  it("shows a retry screen when the API is unreachable (not a fake sign-in page)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network"); }));
    await renderAt("/");
    expect(await screen.findByText("Tickzy is unreachable right now.")).toBeTruthy();
  });
});

describe("sign-in (FR-1.2)", () => {
  it("requests a link and confirms without revealing whether the account exists", async () => {
    const calls = mockApi({ "GET /v1/auth/session": UNAUTH, "POST /v1/auth/magic-link": { status: 202, body: { status: "sent" } } });
    await renderAt("/sign-in");
    await userEvent.type(await screen.findByLabelText("Work email"), "maya@acme.test");
    await userEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ email: "maya@acme.test" });
  });

  it("shows validation errors from the API", async () => {
    mockApi({
      "GET /v1/auth/session": UNAUTH,
      "POST /v1/auth/magic-link": { status: 422, body: { error: { code: "validation_failed", message: "bad", request_id: "r", details: [{ path: "body.email", issue: "invalid" }] } } },
    });
    await renderAt("/sign-in");
    await userEvent.type(await screen.findByLabelText("Work email"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Enter a valid email address.");
  });
});

describe("link verification", () => {
  it("POSTs the token from the URL fragment once, removes it from the URL and lands in the app", async () => {
    let signedIn = false;
    const calls = mockApi({
      "GET /v1/auth/session": () => (signedIn ? { status: 200, body: SIGNED_IN } : UNAUTH),
      "POST /v1/auth/magic-link/verify": () => { signedIn = true; return { status: 200, body: { user_id: SIGNED_IN.user.id } }; },
    });
    window.location.hash = "#token=abc.def";
    const { router } = await renderAt("/auth/verify");
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    const verifies = calls.filter((c) => c.url === "/v1/auth/magic-link/verify");
    expect(verifies).toHaveLength(1);
    expect(verifies[0]!.body).toEqual({ token: "abc.def" });
    expect(window.location.hash).toBe("");
  });

  it("explains expired links and offers a new one", async () => {
    mockApi({
      "GET /v1/auth/session": UNAUTH,
      "POST /v1/auth/magic-link/verify": { status: 401, body: { error: { code: "unauthenticated", message: "This sign-in link is invalid or has expired. Request a new one.", request_id: "r" } } },
    });
    window.location.hash = "#token=old.token";
    await renderAt("/auth/verify");
    expect(await screen.findByRole("heading", { name: "This link didn't work" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Request a new sign-in link" })).toBeTruthy();
  });
});

describe("onboarding (UX S11, FR-1.1)", () => {
  it("derives URL and prefix from the name", () => {
    expect(slugify("Acme Cloud, Inc.")).toBe("acme-cloud-inc");
    expect(prefixFrom("Acme Cloud")).toBe("AC");
    expect(prefixFrom("Northwind")).toBe("NORT");
    expect(prefixFrom("X")).toBe("XX");
    expect(prefixFrom("")).toBe("");
  });

  it("creates the workspace and enters the app", async () => {
    let created = false;
    const calls = mockApi({
      "GET /v1/auth/session": () => ({ status: 200, body: created ? SIGNED_IN : { ...SIGNED_IN, workspaces: [] } }),
      "POST /v1/workspaces": () => { created = true; return { status: 201, body: { id: "ws_01JD0000000000000000000000", name: "Acme Cloud", slug: "acme-cloud", issue_prefix: "AC", region: "us", created_at: "" } }; },
    });
    const { router } = await renderAt("/onboarding");
    await userEvent.type(await screen.findByLabelText("Company or team name"), "Acme Cloud");
    await userEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ name: "Acme Cloud", slug: "acme-cloud", issue_prefix: "AC" });
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeTruthy();
  });

  it("shows a taken URL next to the field", async () => {
    mockApi({
      "GET /v1/auth/session": { status: 200, body: { ...SIGNED_IN, workspaces: [] } },
      "POST /v1/workspaces": { status: 409, body: { error: { code: "conflict", message: "Slug is already taken", request_id: "r" } } },
    });
    await renderAt("/onboarding");
    await userEvent.type(await screen.findByLabelText("Company or team name"), "Acme");
    await userEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    expect(await screen.findByText("This URL is already taken.")).toBeTruthy();
  });
});

describe("sign-out", () => {
  it("ends the session and returns to sign-in", async () => {
    let signedIn = true;
    const calls = mockApi({
      "GET /v1/auth/session": () => (signedIn ? { status: 200, body: SIGNED_IN } : UNAUTH),
      "POST /v1/auth/sign-out": () => { signedIn = false; return { status: 204 }; },
    });
    const { router } = await renderAt("/");
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
    expect(calls.some((c) => c.method === "POST" && c.url === "/v1/auth/sign-out")).toBe(true);
  });
});

describe("link verification robustness", () => {
  it("does not re-verify or show an error when the page remounts after success", async () => {
    let signedIn = false;
    const calls = mockApi({
      "GET /v1/auth/session": () => (signedIn ? { status: 200, body: SIGNED_IN } : UNAUTH),
      "POST /v1/auth/magic-link/verify": () => { signedIn = true; return { status: 200, body: { user_id: SIGNED_IN.user.id } }; },
    });
    window.location.hash = "#token=abc.ghi";
    const first = await renderAt("/auth/verify");
    await waitFor(() => expect(first.router.state.location.pathname).toBe("/"));
    cleanup();
    const second = await renderAt("/auth/verify"); // e.g. back button: no token in the URL any more
    await waitFor(() => expect(second.router.state.location.pathname).toBe("/"));
    expect(screen.queryByText("This link didn't work")).toBeNull();
    expect(calls.filter((c) => c.url === "/v1/auth/magic-link/verify")).toHaveLength(1);
  });
});
