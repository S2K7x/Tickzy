// Real-browser check of design v2 Overview + shell against the REAL server (stats endpoint, table actions).
// Usage: node scripts/e2e-overview.cjs <server-log-path> <screenshot-dir>
const path = require("path");
const { chromium, BASE, createRun } = require("./e2e-lib.cjs");
const [logPath, shots] = process.argv.slice(2);
const { check, axeCheck, noOverflow, signUpWithWorkspace, finish } = createRun(logPath);

(async () => {
  const browser = await chromium.launch();
  const stamp = Date.now().toString(36);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await signUpWithWorkspace(page, `ov-${stamp}@example.com`, "Northbank Support", `ov-${stamp}`);
  check(await page.getByRole("region", { name: "Set up your workspace" }).isVisible(), "empty workspace: setup checklist, zero KPIs");

  const ws = await page.evaluate(() => localStorage.getItem("tickzy.workspace"));
  const call = (method, url, body) => page.evaluate(async ([m, u, b, w]) => {
    const r = await fetch(u, { method: m, headers: { "content-type": "application/json", "tickzy-workspace": w }, body: b ? JSON.stringify(b) : undefined });
    return r.status === 204 ? null : r.json();
  }, [method, url, body, ws]);
  const titles = [["Webhook retries pile up", "high"], ["SSO login loop on Safari", "normal"], ["CSV export times out", "urgent"], ["Invoice shows old VAT number", "low"], ["Dashboard blank after deploy", "high"]];
  const keys = [];
  for (const [t, p] of titles) keys.push((await call("POST", "/v1/issues", { title: t, priority: p })).key);
  await call("POST", `/v1/issues/${keys[0]}/messages`, { body: "Looking into it", visibility: "public" });
  await call("PATCH", `/v1/issues/${keys[3]}`, { status: "resolved" });

  await page.reload();
  const kpis = page.getByRole("region", { name: "Key numbers" });
  await kpis.getByText("New issues").waitFor();
  const kpiText = await kpis.innerText();
  check(/New issues\s*5/.test(kpiText), "KPI: 5 new issues today (real)");
  check(/Waiting on customer\s*1/.test(kpiText), "KPI: 1 waiting on customer after a reply");
  check(/Resolved this week\s*1/.test(kpiText), "KPI: 1 resolved this week");
  check(!(await page.getByRole("region", { name: "Set up your workspace" }).isVisible().catch(() => false)), "setup checklist hidden once issues exist");
  const table = page.getByRole("region", { name: "All issues" });
  await table.getByRole("cell", { name: /Dashboard blank after deploy/ }).waitFor();
  check((await table.getByRole("row").count()) === 5, "table lists the 4 open issues (+ header)");
  check(/Waiting on us\s*3/.test(await table.getByRole("navigation", { name: "Issue status" }).innerText()), "tab counts come from stats");
  await axeCheck(page, "overview 1440 light");
  check(await noOverflow(page), "1440px: no horizontal overflow");
  await page.screenshot({ path: path.join(shots, "v2-overview-1440.png") });

  await table.getByRole("button", { name: new RegExp(`^Assign to me\\s*, ${keys[4]}$`) }).first().click();
  await table.getByRole("button", { name: new RegExp(`^Assign to me\\s*, ${keys[4]}$`) }).first().waitFor({ state: "detached", timeout: 10000 });
  check(true, "Assign to me updates the row");
  await table.getByRole("button", { name: new RegExp(`^Resolve\\s*, ${keys[2]}$`) }).first().click();
  await table.getByRole("cell", { name: /CSV export times out/ }).waitFor({ state: "detached", timeout: 10000 });
  check(true, "Resolve removes the issue from the open list");
  await table.getByLabel("Search issues").fill("safari");
  await table.getByRole("cell", { name: /SSO login loop/ }).waitFor();
  check((await table.getByRole("row").count()) === 2, "table search narrows to one issue");
  await table.getByLabel("Search issues").fill("");

  // Shell: workspace breadcrumb, "/" search, shortcuts.
  check(await page.getByRole("button", { name: /Northbank Support\s*, switch workspace/ }).isVisible(), "breadcrumb shows the workspace switcher");
  await page.locator("h1").click();
  await page.keyboard.press("/");
  await page.keyboard.type("webhook");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/search\?.*q=webhook/);
  const results = page.getByRole("region", { name: /Issues/ });
  await results.getByText("Webhook retries pile up").waitFor();
  check(true, "global search opens the search page with results");
  await page.getByLabel("Search query").fill(`webhook priority:high is:open`);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await results.getByText("Webhook retries pile up").waitFor();
  check((await results.getByRole("link").count()) === 1, "operators narrow the results");
  await axeCheck(page, "search results");
  await page.screenshot({ path: path.join(shots, "v2-search-1440.png") });
  await page.locator("h1").click(); // leave the search box
  await page.keyboard.press("?");
  check(await page.getByRole("dialog", { name: "Keyboard shortcuts" }).isVisible(), "? opens the shortcuts sheet");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: path.join(shots, "v2-inbox-1440.png") });

  await page.goto(`${BASE}/`);
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await kpis.getByText("New issues").waitFor();
  await axeCheck(page, "overview 1440 dark");
  await page.screenshot({ path: path.join(shots, "v2-overview-1440-dark.png") });
  await page.getByRole("button", { name: "Switch to light mode" }).click();

  for (const [w, h] of [[1024, 800], [768, 1000], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`${BASE}/`);
    await kpis.getByText("New issues").waitFor();
    check(await noOverflow(page), `${w}px overview: no horizontal overflow`);
    await axeCheck(page, `overview ${w}`);
    await page.screenshot({ path: path.join(shots, `v2-overview-${w}.png`), fullPage: w === 390 });
  }
  await browser.close();
  finish();
})().catch((err) => { console.error(err); process.exit(1); });
