// Real-browser check of the inbox (T-209a) against the REAL server + Postgres + worker.
// Usage: node scripts/e2e-inbox.cjs <server-log-path> <screenshot-dir>
const path = require("path");
const { chromium, BASE, createRun } = require("./e2e-lib.cjs");
const [logPath, shots] = process.argv.slice(2);
const { check, axeCheck, noOverflow, signUpWithWorkspace, finish } = createRun(logPath);

(async () => {
  const browser = await chromium.launch();
  const stamp = Date.now().toString(36);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  await signUpWithWorkspace(page, `inbox-${stamp}@example.com`, "Inbox Co", `ibx-${stamp}`);
  const ws = await page.evaluate(() => localStorage.getItem("tickzy.workspace"));

  // Seed a few issues through the real API with the browser's session.
  const create = (title, priority) => page.evaluate(async ([t, p, w]) => {
    const r = await fetch("/v1/issues", { method: "POST", headers: { "content-type": "application/json", "tickzy-workspace": w }, body: JSON.stringify({ title: t, priority: p }) });
    return (await r.json()).key;
  }, [title, priority, ws]);
  await create("Webhook retries pile up", "normal");
  await create("SSO login loop on Safari", "low");

  await page.goto(`${BASE}/inbox`);
  await page.getByRole("region", { name: "Issue queue" }).getByText("Webhook retries pile up").waitFor();
  check(true, "queue lists issues from the API");
  check(await page.getByText("Select an issue").isVisible(), "empty conversation pane invites selection");

  // New issue from the top bar.
  await page.getByRole("button", { name: "New issue" }).click();
  await page.getByRole("dialog", { name: "New issue" }).getByLabel("Title").fill("CSV export times out");
  await page.getByRole("dialog").getByLabel("Priority").selectOption("high");
  await page.getByRole("dialog").getByRole("button", { name: "Create issue" }).click();
  await page.getByRole("heading", { level: 2, name: "CSV export times out" }).waitFor();
  check(/^[A-Z]{2,5}-3$/.test(new URL(page.url()).searchParams.get("issue") ?? ""), "new issue opens in the inbox with its key in the URL");
  const details = page.getByRole("complementary", { name: "Issue details" });
  check(await details.isVisible(), "1280px: details pane beside the conversation");

  // Reply → whose-turn automation.
  await page.getByLabel("Reply to the customer").fill("Thanks — we're looking into it.");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("automatically, because the team replied").waitFor({ timeout: 10000 });
  check((await details.getByLabel("Status").inputValue()) === "waiting_on_customer", "a reply moves the issue to Waiting on customer");

  // Internal note via keyboard + ⌘↵.
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("n");
  check(await page.getByLabel("Internal note").evaluate((el) => el === document.activeElement), "n focuses the composer in note mode");
  await page.keyboard.type("Customer is on the legacy export path");
  await page.keyboard.press("Control+Enter");
  await page.getByRole("list", { name: "Timeline" }).getByText("Customer is on the legacy export path").waitFor();
  check(await page.getByRole("list", { name: "Timeline" }).getByText("Internal note").isVisible(), "internal note is labelled on the timeline");
  check((await details.getByLabel("Status").inputValue()) === "waiting_on_customer", "the note did not change the status");

  // Properties.
  await details.getByLabel("Priority").selectOption("urgent");
  await page.getByText("Updated priority → Urgent").waitFor({ timeout: 10000 });
  check(true, "priority change is saved and shown on the timeline");
  const me = await details.getByLabel("Assignee").locator("option").nth(1).getAttribute("value");
  await details.getByLabel("Assignee").selectOption(me);
  await page.getByText(/^Assigned to /).waitFor({ timeout: 10000 });
  check(true, "assignment is saved and shown on the timeline");
  await axeCheck(page, "inbox 1280 light (issue open)");
  await page.screenshot({ path: path.join(shots, "inbox-1280.png") });

  // Keyboard navigation and resolve.
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("j");
  await page.waitForURL(/issue=/);
  const afterJ = new URL(page.url()).searchParams.get("issue");
  await page.keyboard.press("k");
  await page.waitForTimeout(300);
  check(afterJ !== new URL(page.url()).searchParams.get("issue"), "j / k move between issues");
  await page.getByRole("region", { name: "Issue queue" }).getByText("CSV export times out").click();
  await page.getByRole("heading", { level: 2, name: "CSV export times out" }).waitFor();
  await page.getByRole("button", { name: "Resolve" }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Issue details"] select')?.value === "resolved", null, { timeout: 10000 });
  check(true, "Resolve sets the status to Resolved");
  await page.getByRole("navigation", { name: "Inbox views" }).getByRole("link", { name: /^Resolved/ }).click();
  await page.getByRole("region", { name: "Issue queue" }).getByText("CSV export times out").waitFor();
  check(true, "resolved issue appears in the Resolved view");

  // Dark mode.
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await axeCheck(page, "inbox 1280 dark");
  await page.screenshot({ path: path.join(shots, "inbox-1280-dark.png") });
  await page.getByRole("button", { name: "Switch to light mode" }).click();

  // 1024: two panes; details collapse into the conversation.
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto(`${BASE}/inbox?view=done`);
  await page.getByRole("region", { name: "Issue queue" }).getByText("CSV export times out").click();
  await page.getByRole("heading", { level: 2, name: "CSV export times out" }).waitFor();
  check(!(await details.isVisible()), "1024px: side details pane hidden");
  check(await page.locator("summary", { hasText: "Details" }).isVisible(), "1024px: details available as a collapsible section");
  check(await noOverflow(page), "1024px: no horizontal overflow");
  await page.screenshot({ path: path.join(shots, "inbox-1024.png") });

  // 390: single pane with back navigation.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/inbox`);
  await page.getByRole("region", { name: "Issue queue" }).getByText("Webhook retries pile up").waitFor();
  check(!(await page.getByText("Select an issue").isVisible()), "390px: queue only");
  check(await noOverflow(page), "390px queue: no horizontal overflow");
  await axeCheck(page, "inbox 390 queue");
  await page.screenshot({ path: path.join(shots, "inbox-390-queue.png") });
  await page.getByText("Webhook retries pile up").click();
  await page.getByRole("heading", { level: 2, name: "Webhook retries pile up" }).waitFor();
  check(!(await page.getByRole("region", { name: "Issue queue" }).isVisible()), "390px: issue opens full screen");
  check(await noOverflow(page), "390px issue: no horizontal overflow");
  await axeCheck(page, "inbox 390 issue");
  await page.screenshot({ path: path.join(shots, "inbox-390-issue.png"), fullPage: true });
  await page.getByRole("button", { name: "Back to the queue" }).click();
  await page.getByRole("region", { name: "Issue queue" }).waitFor();
  check(true, "390px: back returns to the queue");

  await browser.close();
  finish();
})().catch((err) => { console.error(err); process.exit(1); });
