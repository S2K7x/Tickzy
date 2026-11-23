import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { TOKEN_SCOPES } from "@tickzy/shared/permissions";
import { mockApi, renderAt, SIGNED_IN } from "./test-utils.tsx";
import { ALL_SCOPES } from "./lib/scopes.ts";
import type { Session } from "./lib/api.ts";

const TOKEN = {
  id: "tok_1", name: "CRM sync", prefix: "tkz_live_abcdef", scopes: ["issues:read"], created_by: SIGNED_IN.user.id,
  created_at: "2026-11-20T00:00:00Z", expires_at: null, last_used_at: null,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("settings › API tokens (FR-1.6)", () => {
  it("the scope picker offers exactly the grantable scopes (never developers:manage)", () => {
    expect([...ALL_SCOPES].sort()).toEqual([...TOKEN_SCOPES].sort());
    expect(ALL_SCOPES).not.toContain("developers:manage");
  });

  it("lists tokens by prefix without secrets, with no serious axe violations", async () => {
    mockApi({ "GET /v1/auth/session": { status: 200, body: SIGNED_IN }, "GET /v1/api-tokens": { status: 200, body: { data: [TOKEN] } } });
    await renderAt("/settings/api-tokens");
    expect(await screen.findByText("CRM sync")).toBeTruthy();
    expect(screen.getByText("tkz_live_abcdef…")).toBeTruthy();
    expect(screen.getByText(/Never used · No expiry/)).toBeTruthy();
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  });

  it("creates a token with the chosen scopes and expiry and shows the secret once", async () => {
    let list = { data: [] as unknown[] };
    const secret = `tkz_live_${"a".repeat(24)}.${"b".repeat(52)}`;
    const calls = mockApi({
      "GET /v1/auth/session": { status: 200, body: SIGNED_IN },
      "GET /v1/api-tokens": () => ({ status: 200, body: list }),
      "POST /v1/api-tokens": () => { list = { data: [TOKEN] }; return { status: 201, body: { ...TOKEN, token: secret } }; },
    });
    await renderAt("/settings/api-tokens");
    expect(await screen.findByText("No API tokens yet.")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Name"), "CRM sync");
    await userEvent.selectOptions(screen.getByLabelText("Expires after"), "never");
    await userEvent.click(screen.getByLabelText("Create and update accounts and contacts"));
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    const field = await screen.findByLabelText("New API token");
    expect((field as HTMLInputElement).value).toBe(secret);
    expect(screen.getByText(/will not be shown again/)).toBeTruthy();
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ name: "CRM sync", scopes: ["issues:read", "accounts:write"], expires_in_days: null });
    await userEvent.click(screen.getByRole("button", { name: "I've stored it safely" }));
    expect(screen.queryByDisplayValue(secret)).toBeNull();
    expect(await screen.findByText("CRM sync")).toBeTruthy();
  });

  it("revokes after confirmation", async () => {
    const calls = mockApi({
      "GET /v1/auth/session": { status: 200, body: SIGNED_IN },
      "GET /v1/api-tokens": { status: 200, body: { data: [TOKEN] } },
      "DELETE /v1/api-tokens/tok_1": { status: 204 },
    });
    await renderAt("/settings/api-tokens");
    await userEvent.click(await screen.findByRole("button", { name: "Revoke token CRM sync" }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Confirm revoke" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/v1/api-tokens/tok_1")).toBe(true));
    expect((await screen.findByRole("status")).textContent).toContain("revoked");
  });

  it("non-admins are told only admins manage tokens, and nothing is requested", async () => {
    const agent: Session = { ...SIGNED_IN, workspaces: [{ ...SIGNED_IN.workspaces[0]!, role: "agent" }] };
    const calls = mockApi({ "GET /v1/auth/session": { status: 200, body: agent } });
    await renderAt("/settings/api-tokens");
    expect(await screen.findByText("Only admins can create and manage API tokens.")).toBeTruthy();
    expect(calls.some((c) => c.url === "/v1/api-tokens")).toBe(false);
  });
});
