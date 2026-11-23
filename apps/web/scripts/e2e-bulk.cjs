// Real-browser check of T-209b part 1 (filters, bulk actions, team/label editing) against the REAL server + Postgres.
// Usage: node scripts/e2e-bulk.cjs <server-log-path> <screenshot-dir>
const path = require("path");
const { chromium, BASE, createRun } = require("./e2e-lib.cjs");
const [logPath, shots] = process.argv.slice(2);
const { check, axeCheck, noOverflow, signUpWithWorkspace, finish } = createRun(logPath);

(async () => {
  const browser = await chromium.launch();
  const stamp = Date.now().toString(36);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await signUpWithWorkspace(page, `bulk-${stamp}@example.com`, "Bulk Co", `blk-${stamp}`);
  const ws = await page.evaluate(() => localStorage.getItem("tickzy.workspace"));
  const call = (method, url, body) => page.evaluate(async ([m, u, b, w]) => {
    const r = await fetch(u, { method: m, headers: { "content-type": "application/json", "tickzy-workspace": w }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [method, url, body, ws]);

  const bug = (await call("POST", "/v1/labels", { name: "bug" })).json.id;
  await call("POST", "/v1/labels", { name: "vip" });
  const mk = async (title, priority, labels = []) => (await call("POST", "/v1/issues", { title, priority, labels })).json.key;
  const k1 = await mk("Webhook retries pile up", "urgent", [bug]);
  const k2 = await mk("SSO login loop on Safari", "high");
  const k3 = await mk("CSV export times out", "normal");
  const k4 = await mk("Old billing question", "low");
  check((await call("PATCH", `/v1/issues/${k4}`, { status: "closed" })).status === 200, "setup: one issue closed");
  // Closed issues are not in "All open": use the Resolved/done view for the mixed bulk test later.

  // Filters.
  await page.goto(`${BASE}/inbox`);
  const queue = page.getByRole("region", { name: "Issue queue" });
  await queue.getByText("CSV export times out").waitFor();
  await queue.getByRole("button", { name: /^Filter\b/ }).click();
  const panel = queue.getByRole("group", { name: "Filters" });
  await panel.getByRole("checkbox", { name: "Urgent" }).check();
  await panel.getByRole("checkbox", { name: "High" }).check();
  await queue.getByText("CSV export times out").waitFor({ state: "detached" });
  await queue.getByText("SSO login loop on Safari").waitFor();
  const rows = queue.getByRole("checkbox", { name: /^Select / });
  await page.waitForFunction(() => document.querySelectorAll('[aria-label^="Select "]').length === 2);
  check(await rows.count() === 2 && await queue.getByText("Webhook retries pile up").isVisible(), "priority filter (Urgent, High) narrows the queue via the API");
  check(new URL(page.url()).searchParams.get("priority") === "urgent,high", "filters live in the URL");
  await panel.getByLabel("Label").selectOption({ label: "bug" });
  await queue.getByText("SSO login loop on Safari").waitFor({ state: "detached" });
  await page.waitForFunction(() => document.querySelectorAll('[aria-label^="Select "]').length === 1);
  check(await queue.getByRole("checkbox", { name: `Select ${k1}` }).count() === 1, "label filter combines with priority");
  await page.screenshot({ path: path.join(shots, "bulk-filters-1440.png") });
  await axeCheck(page, "inbox with filter panel (1440)");
  await page.reload();
  await queue.getByRole("button", { name: "Remove filter Label: bug" }).waitFor();
  check(true, "filters survive a reload (chips rebuilt from the URL)");
  await queue.getByRole("button", { name: "Clear all" }).click();
  await queue.getByText("CSV export times out").waitFor();
  check(new URL(page.url()).searchParams.get("priority") === null, "Clear all removes every filter");

  // Bulk: select two by checkbox, assign to me + add label.
  await queue.getByRole("checkbox", { name: `Select ${k2}` }).check();
  await queue.getByRole("checkbox", { name: `Select ${k3}` }).check();
  const bar = queue.getByRole("region", { name: "Bulk actions" });
  check(await bar.getByText("2 selected").isVisible(), "bulk bar appears with the selection count");
  const me = await bar.getByLabel("Assign selected issues").locator("option").nth(2).getAttribute("value");
  await bar.getByLabel("Assign selected issues").selectOption(me);
  await queue.getByText("Updated 2 issues.").waitFor({ timeout: 10000 });
  const after = (await call("GET", `/v1/issues/${k2}`)).json;
  check(after.assignee?.membership_id === me, "bulk assign persisted (checked through the API)");
  check(!(await bar.count()), "all succeeded → selection released");
  await queue.getByRole("checkbox", { name: `Select ${k2}` }).check();
  await queue.getByRole("checkbox", { name: `Select ${k3}` }).check();
  await bar.getByLabel("Label selected issues").selectOption({ label: "+ vip" });
  await queue.getByText("Updated 2 issues.").waitFor({ timeout: 10000 });
  check((await call("GET", `/v1/issues/${k3}`)).json.labels.some((l) => l.name === "vip"), "bulk add label persisted");

  // Mixed outcome: resolved view holds the closed issue; resolve open + closed → per-issue failure explained.
  await page.goto(`${BASE}/inbox?view=done`);
  await queue.getByText("Old billing question").waitFor();
  await queue.getByRole("checkbox", { name: `Select ${k4}` }).check();
  await queue.getByRole("button", { name: /Select all/ }).click().catch(() => undefined);
  await bar.getByLabel("Set status of selected issues").selectOption("waiting_on_us");
  await queue.getByText(/not changed/).waitFor({ timeout: 10000 });
  check((await queue.getByRole("status").filter({ hasText: "not changed" }).textContent()).includes(`${k4} — Closed issues cannot be reopened`), "a refused issue is named with the reason");
  check(await bar.getByText("1 selected").isVisible(), "the refused issue stays selected");
  await page.locator("body").click({ position: { x: 900, y: 500 } });
  await page.keyboard.press("Escape");
  check(!(await bar.count()), "Esc clears the selection");

  // Keyboard x + details team/labels.
  await page.goto(`${BASE}/inbox?issue=${k3}`);
  await page.getByRole("heading", { level: 2, name: "CSV export times out" }).waitFor();
  await page.locator("body").click({ position: { x: 700, y: 400 } });
  await page.keyboard.press("x");
  await bar.waitFor();
  check(await bar.getByText("1 selected").isVisible(), "x selects the open issue");
  await page.keyboard.press("x");
  const details = page.getByRole("complementary", { name: "Issue details" });
  check(await details.getByLabel("Team").isDisabled() && (await details.getByLabel("Team").textContent()).includes("No teams yet"), "no teams: the team picker says so (no fake teams)");
  await details.getByRole("combobox", { name: "Add label" }).selectOption({ label: "bug" });
  await details.getByRole("button", { name: "Remove label bug" }).waitFor({ timeout: 10000 });
  await details.getByRole("combobox", { name: "Add label" }).selectOption("__new");
  await details.getByLabel("New label name").fill("needs repro");
  await details.getByRole("button", { name: "Create" }).click();
  await details.getByRole("button", { name: "Remove label needs repro" }).waitFor({ timeout: 10000 });
  check(true, "label created inline and applied");
  await details.getByRole("button", { name: "Remove label vip" }).click();
  await details.getByRole("button", { name: "Remove label vip" }).waitFor({ state: "detached", timeout: 10000 });
  const labels = (await call("GET", `/v1/issues/${k3}`)).json.labels.map((l) => l.name).sort();
  check(JSON.stringify(labels) === JSON.stringify(["bug", "needs repro"]), `labels persisted: ${labels.join(", ")}`);
  await page.getByRole("list", { name: "Timeline" }).getByText(/label/i).first().waitFor({ timeout: 10000 });
  check(true, "label changes appear on the timeline");
  await axeCheck(page, "issue details with labels (1440)");

  // Dark mode + narrow widths.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${BASE}/inbox`);
  await queue.getByRole("checkbox", { name: `Select ${k1}` }).check();
  await queue.getByRole("button", { name: /^Filter\b/ }).click();
  await axeCheck(page, "inbox bulk + filters (dark)");
  await page.emulateMedia({ colorScheme: "light" });
  for (const w of [1024, 390]) {
    await page.setViewportSize({ width: w, height: 860 });
    await page.goto(`${BASE}/inbox?priority=urgent`);
    await queue.getByRole("button", { name: /^Filter\b/ }).click();
    await queue.getByRole("checkbox", { name: `Select ${k1}` }).check();
    await bar.waitFor();
    check(await noOverflow(page), `${w}px: no horizontal overflow with filters + bulk bar`);
    await page.screenshot({ path: path.join(shots, `bulk-${w}.png`) });
  }
  await axeCheck(page, "inbox bulk + filters (390)");

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
