import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { mockApi, renderAt, SIGNED_IN } from "./test-utils.tsx";

/** T-210: accounts list and account profile. */
const GLOBEX = {
  id: "acc_globex", name: "Globex", domains: ["globex.com"], tier: "Enterprise", owner_membership_id: "mem_me", external_ids: {}, custom: {},
  contact_count: 2, open_issue_count: 3, last_activity_at: new Date(Date.now() - 2 * 3600_000).toISOString(), created_at: "", updated_at: "",
};
const INITECH = { ...GLOBEX, id: "acc_initech", name: "Initech", domains: [], tier: null, owner_membership_id: null, contact_count: 0, open_issue_count: 0, last_activity_at: null };
const ME = { id: "mem_me", user_id: SIGNED_IN.user.id, name: "Maya Chen", email: "maya@acme.test", role: "admin", status: "active", joined_at: "" };
const ISSUE = {
  id: "iss_1", key: "ACME-7", number: 7, title: "SSO broken for Globex", priority: "high", status: { category: "waiting_on_us", id: "s", name: "Waiting on us" },
  assignee: null, team_id: null, account: { id: "acc_globex", name: "Globex", tier: "Enterprise" }, requester: null, channel: "email", product_area: null,
  labels: [], fields: {}, sla: [], first_response_at: null, resolved_at: null, created_at: "", updated_at: new Date().toISOString(), version: 1,
};
const CONTACT = { id: "con_1", name: "Hank Scorpio", account_id: "acc_globex", account_source: "auto", role_in_account: "CTO", identities: [{ id: "ci_1", kind: "email", external_key: "hank@globex.com" }], custom: {}, created_at: "", updated_at: "" };
const OPEN_FOR_GLOBEX = "/v1/issues?status=triage,waiting_on_us,waiting_on_customer,blocked&sort=updated&account=acc_globex&limit=50";
const routes = (over: Record<string, unknown> = {}, role = "admin") => mockApi({
  "GET /v1/auth/session": { status: 200, body: { ...SIGNED_IN, workspaces: [{ ...SIGNED_IN.workspaces[0]!, role }] } },
  "GET /v1/accounts?limit=50": { status: 200, body: { data: [GLOBEX, INITECH], next_cursor: null } },
  "GET /v1/accounts?limit=50&q=glo": { status: 200, body: { data: [GLOBEX], next_cursor: null } },
  "GET /v1/accounts?limit=50&q=zzz": { status: 200, body: { data: [], next_cursor: null } },
  "GET /v1/accounts/acc_globex": { status: 200, body: GLOBEX },
  "GET /v1/members": { status: 200, body: { data: [ME] } },
  [`GET ${OPEN_FOR_GLOBEX}`]: { status: 200, body: { data: [ISSUE], next_cursor: null } },
  "GET /v1/contacts?account_id=acc_globex&limit=50": { status: 200, body: { data: [CONTACT], next_cursor: null } },
  ...over,
} as never);

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe("accounts list (T-210)", () => {
  it("lists accounts with tier, owner, counts and last activity; search goes to the URL and the API", async () => {
    const calls = routes();
    const { router } = await renderAt("/accounts");
    expect(await screen.findByRole("heading", { level: 1, name: "Accounts" })).toBeTruthy();
    const table = await screen.findByRole("table");
    const globex = within(table).getByRole("row", { name: /Globex/ });
    expect(within(globex).getByText("globex.com")).toBeTruthy();
    expect(within(globex).getByText("Enterprise")).toBeTruthy();
    expect(within(globex).getByText("Maya Chen")).toBeTruthy();
    expect(within(globex).getByText("3")).toBeTruthy();
    expect(within(globex).getByText("2h")).toBeTruthy();
    expect(within(within(table).getByRole("row", { name: /Initech/ })).getByText("No domains")).toBeTruthy();
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

    await userEvent.type(screen.getByLabelText("Search accounts by name or domain"), "glo");
    await waitFor(() => expect(router.state.location.search).toEqual({ q: "glo" }));
    await waitFor(() => expect(within(screen.getByRole("table")).queryByText("Initech")).toBeNull());
    expect(calls.some((c) => c.url === "/v1/accounts?limit=50&q=glo")).toBe(true);
  });

  it("explains an empty search; viewers and collaborators get no create button", async () => {
    routes({}, "collaborator");
    await renderAt("/accounts?q=zzz");
    expect(await screen.findByText("No accounts match “zzz”")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New account" })).toBeNull();
  });

  it("creates an account (domains parsed) and opens its profile", async () => {
    const calls = routes({ "POST /v1/accounts": { status: 201, body: GLOBEX } });
    const { router } = await renderAt("/accounts");
    await screen.findByRole("table");
    await userEvent.click(screen.getAllByRole("button", { name: "New account" })[0]!);
    const dlg = screen.getByRole("dialog", { name: "New account" });
    expect(document.activeElement).toBe(within(dlg).getByLabelText("Name"));
    await userEvent.type(within(dlg).getByLabelText("Name"), "Globex");
    await userEvent.type(within(dlg).getByLabelText(/Email domains/), "Globex.com,  globex.io; globex.com");
    await userEvent.type(within(dlg).getByLabelText("Tier"), "Enterprise");
    await userEvent.selectOptions(within(dlg).getByLabelText("Owner"), "mem_me");
    await userEvent.click(within(dlg).getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.body).toEqual({ name: "Globex", domains: ["globex.com", "globex.io"], tier: "Enterprise", owner_membership_id: "mem_me" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/accounts/acc_globex"));
  });

  it("shows the API's reason when a domain is refused", async () => {
    routes({ "POST /v1/accounts": { status: 422, body: { error: { code: "validation_failed", message: "Invalid domains", request_id: "r", details: [{ path: "domains.0", issue: "gmail.com is a public email provider; it cannot identify one company" }] } } } });
    await renderAt("/accounts");
    await screen.findByRole("table");
    await userEvent.click(screen.getAllByRole("button", { name: "New account" })[0]!);
    const dlg = screen.getByRole("dialog", { name: "New account" });
    await userEvent.type(within(dlg).getByLabelText("Name"), "Gmail people");
    await userEvent.type(within(dlg).getByLabelText(/Email domains/), "gmail.com");
    await userEvent.click(within(dlg).getByRole("button", { name: "Create account" }));
    expect((await within(dlg).findByRole("alert")).textContent).toBe("Invalid domains: gmail.com is a public email provider; it cannot identify one company");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("account profile (T-210)", () => {
  it("shows the header, the account's open issues and its contacts; adds a contact", async () => {
    const calls = routes({ "POST /v1/contacts": { status: 201, body: { ...CONTACT, id: "con_2", name: "Mindy" } } });
    const { router } = await renderAt("/accounts/acc_globex");
    expect(await screen.findByRole("heading", { level: 1, name: "Globex" })).toBeTruthy();
    expect(screen.getByText("globex.com")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open in inbox" }).getAttribute("href")).toBe("/inbox?account=acc_globex");
    const issues = await screen.findByRole("list", { name: "Account issues" });
    expect(within(issues).getByText("SSO broken for Globex")).toBeTruthy();
    expect(within(issues).getByRole("link").getAttribute("href")).toBe("/inbox?issue=ACME-7");
    expect(screen.getByText(/arrive with channels \(M3\) and SLAs \(M4\)/)).toBeTruthy();

    await userEvent.click(screen.getByRole("link", { name: /Contacts/ }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: "contacts" }));
    const contacts = await screen.findByRole("list", { name: "Contacts" });
    expect(within(contacts).getByText("Hank Scorpio")).toBeTruthy();
    expect(within(contacts).getByText("hank@globex.com")).toBeTruthy();
    expect(within(contacts).getByText("Auto-linked")).toBeTruthy();
    const form = screen.getByRole("form", { name: "Add contact" });
    await userEvent.type(within(form).getByLabelText("Name"), "Mindy");
    await userEvent.type(within(form).getByLabelText("Email"), "mindy@globex.com");
    await userEvent.click(within(form).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST" && c.url === "/v1/contacts")?.body).toEqual({ account_id: "acc_globex", name: "Mindy", email: "mindy@globex.com", role_in_account: null }));
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  });

  it("edits and deletes the account", async () => {
    const calls = routes({
      "PATCH /v1/accounts/acc_globex": { status: 200, body: { ...GLOBEX, tier: "Mid-market" } },
      "DELETE /v1/accounts/acc_globex": { status: 204 },
    });
    const { router } = await renderAt("/accounts/acc_globex");
    await screen.findByRole("heading", { level: 1, name: "Globex" });
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dlg = screen.getByRole("dialog", { name: "Edit Globex" });
    expect((within(dlg).getByLabelText(/Email domains/) as HTMLInputElement).value).toBe("globex.com");
    const tier = within(dlg).getByLabelText("Tier");
    await userEvent.clear(tier);
    await userEvent.type(tier, "Mid-market");
    await userEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ name: "Globex", domains: ["globex.com"], tier: "Mid-market", owner_membership_id: "mem_me" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const confirm = screen.getByRole("dialog", { name: "Delete Globex?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Delete account" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/v1/accounts/acc_globex")).toBe(true));
    await waitFor(() => expect(router.state.location.pathname).toBe("/accounts"));
  });

  it("collaborators see the profile without edit, delete or add-contact controls; unknown ids say not found", async () => {
    routes({ "GET /v1/accounts/acc_nope": { status: 404, body: { error: { code: "not_found", message: "Account not found", request_id: "r" } } } }, "collaborator");
    await renderAt("/accounts/acc_globex?tab=contacts");
    await screen.findByRole("heading", { level: 1, name: "Globex" });
    await screen.findByRole("list", { name: "Contacts" });
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Add contact" })).toBeNull();
    cleanup();
    await renderAt("/accounts/acc_nope");
    expect(await screen.findByRole("heading", { name: "Account not found" })).toBeTruthy();
  });

  it("the inbox can be filtered by account (chip names it)", async () => {
    routes({ "GET /v1/issues?status=triage,waiting_on_us,waiting_on_customer,blocked&sort=updated&account=acc_globex&limit=50": { status: 200, body: { data: [ISSUE], next_cursor: null } } });
    await renderAt("/inbox?account=acc_globex");
    expect(await screen.findByRole("button", { name: "Remove filter Account: Globex" })).toBeTruthy();
    expect(await screen.findByText("SSO broken for Globex")).toBeTruthy();
  });
});
