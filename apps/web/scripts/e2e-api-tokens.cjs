// End-to-end check of T-103 (API tokens) against the REAL server + Postgres.
// Same prerequisites as e2e-auth.cjs. Usage: node scripts/e2e-api-tokens.cjs <server-log-path> <screenshot-dir>
// Journey: admin creates a token in Settings › API tokens → copies it once → calls the API with it from outside
// the browser (no cookie, no workspace header) → scope limits hold → revokes it in the UI → the API refuses it.
const path = require("path");
const { chromium, BASE, API, createRun } = require("./e2e-lib.cjs");
const [logPath, shots] = process.argv.slice(2);
const { check, axeCheck, noOverflow, signUpWithWorkspace, finish } = createRun(logPath);

const call = (token, url, init = {}) =>
  fetch(`${API}${url}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });

(async () => {
  const browser = await chromium.launch();
  const stamp = Date.now().toString(36);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const page = await ctx.newPage();
  await signUpWithWorkspace(page, `dev-${stamp}@example.com`, "Token Test Co", `tok-${stamp}`);

  await page.goto(`${BASE}/settings/api-tokens`);
  await page.getByRole("heading", { name: "API tokens", level: 2 }).waitFor();
  await page.getByText("No API tokens yet.").waitFor();
  await axeCheck(page, "api tokens (empty)");
  await page.getByLabel("Name").fill("E2E integration");
  await page.getByLabel("Expires after").selectOption("30");
  await page.getByLabel("Update workspace settings").check();
  await page.getByLabel("Read the audit log").check();
  await page.getByRole("button", { name: "Create token" }).click();
  const field = page.getByLabel("New API token");
  await field.waitFor();
  const token = await field.inputValue();
  check(/^tkz_live_[a-z2-7]{24}\.[a-z2-7]{52}$/.test(token), "token shown once in the expected format");
  await page.getByRole("button", { name: "Copy" }).click();
  check((await page.evaluate(() => navigator.clipboard.readText())) === token, "Copy puts the token on the clipboard");
  await axeCheck(page, "api tokens (created)");
  await page.screenshot({ path: path.join(shots, "api-tokens-created-1280.png"), fullPage: true });
  await page.getByRole("button", { name: "I've stored it safely" }).click();
  check((await page.getByLabel("New API token").count()) === 0, "secret is gone from the page after dismissing");
  await page.reload();
  await page.getByText("E2E integration").waitFor();
  check(!(await page.content()).includes(token.split(".")[1]), "secret never appears again after reload");
  check(await page.getByText("Never used").isVisible(), "new token shows Never used");

  // Use it from outside the browser.
  let res = await call(token, "/v1/workspaces/current");
  const ws = await res.json();
  check(res.status === 200 && ws.name === "Token Test Co", "token authenticates without cookie or workspace header");
  res = await call(token, "/v1/workspaces/current", { method: "PATCH", body: JSON.stringify({ name: "Token Test Renamed" }) });
  check(res.status === 200, "token with workspace:manage can rename the workspace");
  res = await call(token, "/v1/audit-log?action=workspace.updated");
  const audit = await res.json();
  check(res.status === 200 && audit.data[0]?.actor_type === "api_token", "change is audited with actor_type api_token");
  res = await call(token, "/v1/members");
  check(res.status === 200, "any token can list members of its workspace (member-level read)");
  res = await call(token, "/v1/invitations", { method: "POST", body: JSON.stringify({ email: "x@example.com", role: "agent" }) });
  check(res.status === 403, "token without members:manage cannot invite (403)");
  res = await call(token, "/v1/api-tokens");
  check(res.status === 403, "token cannot list or mint tokens (403)");
  res = await call(token, "/v1/me/workspaces");
  check(res.status === 403, "token refused on user-only endpoints (403)");

  await page.reload();
  await page.getByText(/Last used/).waitFor();
  check(true, "list shows Last used after API calls");

  // Revoke in the UI.
  await page.getByRole("button", { name: "Revoke token E2E integration" }).click();
  await page.getByRole("button", { name: "Confirm revoke" }).click();
  await page.getByText(/revoked\. Requests using it now fail/).waitFor();
  res = await call(token, "/v1/workspaces/current");
  check(res.status === 401, "revoked token is refused immediately (401)");

  // Phone + dark.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  check(await noOverflow(page), "390px api tokens page has no horizontal overflow");
  await axeCheck(page, "api tokens (dark, 390)");
  await page.screenshot({ path: path.join(shots, "api-tokens-dark-390.png"), fullPage: true });

  await browser.close();
  finish();
})().catch((err) => { console.error(err); process.exit(1); });
