// Real-browser check of T-210 (accounts list + profile) against the REAL server + Postgres.
// Usage: node scripts/e2e-accounts.cjs <server-log-path> <screenshot-dir>
const path = require("path");
const { chromium, BASE, createRun } = require("./e2e-lib.cjs");
const [logPath, shots] = process.argv.slice(2);
const { check, axeCheck, noOverflow, signUpWithWorkspace, finish } = createRun(logPath);

(async () => {
  const browser = await chromium.launch();
  const stamp = Date.now().toString(36);
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signUpWithWorkspace(page, `acc-${stamp}@example.com`, "Accounts Co", `acc-${stamp}`);
  const ws = await page.evaluate(() => localStorage.getItem("tickzy.workspace"));
  const call = (method, url, body) => page.evaluate(async ([m, u, b, w]) => {
    const r = await fetch(u, { method: m, headers: { "content-type": "application/json", "tickzy-workspace": w }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [method, url, body, ws]);

  // Empty state → create from the button.
  await page.getByRole("navigation", { name: "Primary" }).first().getByRole("link", { name: "Accounts" }).click();
  await page.getByRole("heading", { level: 1, name: "Accounts" }).waitFor();
  await page.getByText("No accounts yet").waitFor();
  check(true, "empty state explains accounts and domains");
  await page.getByRole("button", { name: "New account" }).first().click();
  let dlg = page.getByRole("dialog", { name: "New account" });
  await dlg.getByLabel("Name").fill("Globex");
  await dlg.getByLabel(/Email domains/).fill("gmail.com");
  await dlg.getByRole("button", { name: "Create account" }).click();
  const refusal = await dlg.getByRole("alert").textContent({ timeout: 10000 });
  check(/gmail\.com is a public email provider/.test(refusal), `a public email domain is refused with a reason ("${refusal}")`);
  await dlg.getByLabel(/Email domains/).fill(`globex-${stamp}.com, Globex-${stamp}.io`);
  await dlg.getByLabel("Tier").fill("Enterprise");
  const me = await dlg.getByLabel("Owner").locator("option").nth(1).getAttribute("value");
  await dlg.getByLabel("Owner").selectOption(me);
  await dlg.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("heading", { level: 1, name: "Globex" }).waitFor();
  const accId = new URL(page.url()).pathname.split("/").pop();
  check(accId.startsWith("acc_"), "creating opens the new account's profile");
  check(await page.getByText(`globex-${stamp}.com · globex-${stamp}.io`).isVisible(), "domains normalised (lower-case) and shown");

  // Data through the API: a contact auto-linked by domain, an issue for the account.
  const contact = (await call("POST", "/v1/contacts", { name: "Hank Scorpio", email: `hank@globex-${stamp}.com` })).json;
  check(contact.account_id === accId, "a contact from the domain is linked automatically");
  const issueKey = (await call("POST", "/v1/issues", { title: "SSO broken for Globex", priority: "high", account_id: accId })).json.key;
  await call("POST", "/v1/accounts", { name: "Initech", domains: [`initech-${stamp}.com`] });
  await page.reload();
  const issues = page.getByRole("list", { name: "Account issues" });
  await issues.getByText("SSO broken for Globex").waitFor();
  check(true, "the account's open issues are listed");
  await page.getByRole("radio", { name: "Resolved & closed" }).click();
  await page.getByText("Nothing resolved yet.").waitFor();
  check(true, "resolved tab is empty and says so");
  await page.getByRole("radio", { name: "Open" }).click();
  await page.getByRole("link", { name: /Contacts/ }).click();
  const contacts = page.getByRole("list", { name: "Contacts" });
  await contacts.getByText("Hank Scorpio").waitFor();
  check(await contacts.getByText("Auto-linked").isVisible(), "contacts tab shows the auto-linked contact");
  const form = page.getByRole("form", { name: "Add contact" });
  await form.getByLabel("Name").fill("Mindy");
  await form.getByLabel("Email").fill(`mindy@elsewhere-${stamp}.com`);
  await form.getByLabel("Role").fill("Head of Support");
  await form.getByRole("button", { name: "Add" }).click();
  await contacts.getByText(/^Mindy/).waitFor({ timeout: 10000 });
  check(await contacts.getByText("Manual").isVisible(), "a contact added on the account is linked manually even from another domain");
  check(await page.getByRole("link", { name: /Contacts\s*2/ }).isVisible(), "contact count updates");
  await page.screenshot({ path: path.join(shots, "account-profile-1440.png") });
  await axeCheck(page, "account profile, contacts (1440)");

  // List: counts and search.
  await page.goto(`${BASE}/accounts`);
  const row = page.getByRole("row", { name: /Globex/ });
  await row.waitFor();
  const cells = await row.getByRole("cell").allTextContents();
  check(cells.some((c) => c.trim() === "1") && cells.some((c) => c.trim() === "2") && cells.some((c) => c.includes("Enterprise")), `list row shows tier, 1 open issue, 2 contacts (${cells.join(" | ")})`);
  check(await page.getByRole("row", { name: /Initech/ }).isVisible(), "other accounts listed");
  await page.getByLabel("Search accounts by name or domain").fill(`initech-${stamp}`);
  await page.getByRole("row", { name: /Globex/ }).waitFor({ state: "detached" });
  check(new URL(page.url()).searchParams.get("q") === `initech-${stamp}`, "search by domain narrows the list and is kept in the URL");
  await page.screenshot({ path: path.join(shots, "accounts-list-1440.png") });
  await axeCheck(page, "accounts list (1440)");

  // Open in inbox → account filter.
  await page.goto(`${BASE}/accounts/${accId}`);
  await page.getByRole("link", { name: "Open in inbox" }).click();
  await page.getByRole("button", { name: "Remove filter Account: Globex" }).waitFor();
  await page.getByRole("region", { name: "Issue queue" }).getByText("SSO broken for Globex").waitFor();
  check(new URL(page.url()).searchParams.get("account") === accId, "Open in inbox filters the queue by the account");

  // Edit, then delete.
  await page.goto(`${BASE}/accounts/${accId}`);
  await page.getByRole("button", { name: "Edit" }).click();
  dlg = page.getByRole("dialog", { name: "Edit Globex" });
  await dlg.getByLabel("Tier").fill("Mid-market");
  await page.keyboard.press("Tab");
  await dlg.getByRole("button", { name: "Save" }).click();
  await page.getByText("Mid-market").first().waitFor();
  check((await call("GET", `/v1/accounts/${accId}`)).json.tier === "Mid-market", "edit saved");
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog", { name: "Delete Globex?" }).waitFor();
  check(await page.getByRole("dialog", { name: "Delete Globex?" }).getByRole("button", { name: "Cancel" }).evaluate((el) => el === document.activeElement), "delete confirmation opens with focus on Cancel (safe default)");
  await axeCheck(page, "delete confirmation dialog");
  await page.getByRole("dialog", { name: "Delete Globex?" }).getByRole("button", { name: "Delete account" }).click();
  await page.getByRole("heading", { level: 1, name: "Accounts" }).waitFor();
  check(!(await page.getByRole("row", { name: /Globex/ }).count()), "deleted account leaves the list");
  check((await call("GET", `/v1/issues/${issueKey}`)).json.account === null, "its issue now shows no account");
  check((await call("GET", `/v1/contacts/${contact.id}`)).json.account_id === null, "its contacts are unlinked");

  // Dark + narrow.
  await page.emulateMedia({ colorScheme: "dark" });
  await axeCheck(page, "accounts list (dark)");
  await page.emulateMedia({ colorScheme: "light" });
  for (const w of [1024, 390]) {
    await page.setViewportSize({ width: w, height: 860 });
    await page.goto(`${BASE}/accounts`);
    await page.locator("text=Initech >> visible=true").first().waitFor();
    check(await noOverflow(page), `${w}px accounts list: no horizontal overflow`);
    await page.locator("text=Initech >> visible=true").first().click();
    await page.getByRole("heading", { level: 1, name: "Initech" }).waitFor();
    check(await noOverflow(page), `${w}px account profile: no horizontal overflow`);
    await page.screenshot({ path: path.join(shots, `account-profile-${w}.png`) });
  }
  await axeCheck(page, "account profile (390)");

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
