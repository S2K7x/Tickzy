// Real-browser check of T-209b part 2 (⌘K palette, a/s/p/l, virtualised queue) against the REAL server + Postgres.
// Usage: node scripts/e2e-palette.cjs <server-log-path> <screenshot-dir>
const path = require("path");
const { chromium, BASE, createRun } = require("./e2e-lib.cjs");
const [logPath, shots] = process.argv.slice(2);
const { check, axeCheck, noOverflow, signUpWithWorkspace, finish } = createRun(logPath);
const N = 260;

(async () => {
  const browser = await chromium.launch();
  const stamp = Date.now().toString(36);
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signUpWithWorkspace(page, `pal-${stamp}@example.com`, "Palette Co", `pal-${stamp}`);
  const ws = await page.evaluate(() => localStorage.getItem("tickzy.workspace"));
  const call = (method, url, body) => page.evaluate(async ([m, u, b, w]) => {
    const r = await fetch(u, { method: m, headers: { "content-type": "application/json", "tickzy-workspace": w }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [method, url, body, ws]);
  const statuses = await page.evaluate(async ([w, n]) => {
    const out = [];
    for (let i = 0; i < n; i += 10) {
      out.push(...await Promise.all(Array.from({ length: Math.min(10, n - i) }, (_, j) => fetch("/v1/issues", {
        method: "POST", headers: { "content-type": "application/json", "tickzy-workspace": w },
        body: JSON.stringify({ title: `Queue item ${String(i + j + 1).padStart(3, "0")}` }),
      }).then((r) => r.status))));
    }
    return out;
  }, [ws, N]);
  check(statuses.every((s) => s === 201), `setup: ${N} issues created (${statuses.filter((s) => s !== 201).length} failed)`);
  const special = (await call("POST", "/v1/issues", { title: "Signature mismatch on webhook", priority: "low" })).json.key;

  // Virtualised queue.
  await page.goto(`${BASE}/inbox`);
  const queue = page.getByRole("region", { name: "Issue queue" });
  const list = queue.getByRole("list", { name: "Issues" });
  await list.getByRole("listitem").first().waitFor();
  const rendered = () => list.getByRole("listitem").count();
  const setSize = () => list.getByRole("listitem").first().getAttribute("aria-setsize");
  check(await rendered() < 40, `only visible rows are in the DOM (${await rendered()} of ${await setSize()})`);
  const scroller = list.locator("xpath=..");
  for (let i = 0; i < 12 && Number(await setSize()) < N + 1; i++) {
    await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(400);
  }
  check(Number(await setSize()) === N + 1, `scrolling to the end loads every page automatically (setsize ${await setSize()})`);
  check(await rendered() < 40, `still only visible rows after loading ${N + 1} (${await rendered()} in the DOM)`);
  await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await queue.getByText("Queue item 001").waitFor();
  check(true, "the oldest issue is reachable at the end of the list");
  // Render cost: time from reload to first row, with 50 rows per page.
  const t0 = Date.now();
  await page.reload();
  await list.getByRole("listitem").first().waitFor();
  console.log(`(info) reload → first queue row: ${Date.now() - t0} ms`);

  // j/k keeps the open issue in view.
  await page.locator("body").click({ position: { x: 900, y: 450 } });
  for (let i = 0; i < 25; i++) await page.keyboard.press("j");
  const key25 = new URL(page.url()).searchParams.get("issue");
  const row = list.getByRole("listitem").filter({ has: page.locator('a[aria-current]') });
  const inView = await row.evaluate((li) => { const r = li.getBoundingClientRect(); const s = li.closest(".overflow-y-auto").getBoundingClientRect(); return r.top >= s.top - 1 && r.bottom <= s.bottom + 1; });
  check(!!key25 && inView, `j×25 opens ${key25} and its row is scrolled into view`);

  // ⌘K palette: find + open an issue.
  await page.keyboard.press("Control+k");
  const dlg = page.getByRole("dialog", { name: "Command palette" });
  await dlg.waitFor();
  check(await dlg.getByRole("combobox").evaluate((el) => el === document.activeElement), "⌘K opens the palette with focus in its input");
  await page.keyboard.type("signature mismatch");
  await dlg.getByRole("option", { name: new RegExp(`${special}`) }).waitFor({ timeout: 5000 });
  await page.screenshot({ path: path.join(shots, "palette-1440.png") });
  await axeCheck(page, "command palette (1440)");
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { level: 2, name: "Signature mismatch on webhook" }).waitFor();
  check(new URL(page.url()).searchParams.get("issue") === special && !(await dlg.count()), "Enter opens the issue and closes the palette");

  // Issue shortcuts.
  await page.locator("body").click({ position: { x: 900, y: 450 } });
  await page.keyboard.press("p");
  await dlg.getByText(`${special} · Set priority…`).waitFor();
  await page.keyboard.type("urg");
  await page.keyboard.press("Enter");
  await page.getByRole("complementary", { name: "Issue details" }).getByLabel("Priority").filter({ has: page.locator("option:checked", { hasText: "Urgent" }) }).waitFor({ timeout: 10000 });
  check((await call("GET", `/v1/issues/${special}`)).json.priority === "urgent", "p → Urgent saved through the API");
  await page.keyboard.press("a");
  await dlg.waitFor();
  await page.keyboard.type("pal-");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  check(!!(await call("GET", `/v1/issues/${special}`)).json.assignee, "a → pick yourself assigns the issue");
  await page.keyboard.press("s");
  await dlg.waitFor();
  await page.keyboard.type("resolved");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  check((await call("GET", `/v1/issues/${special}`)).json.status.category === "resolved", "s → Resolved changes the status");
  await page.keyboard.press("l");
  await dlg.waitFor();
  check(await dlg.getByText("No results").isVisible(), "l with no labels: the palette says No results (no fake labels)");
  await page.keyboard.press("Backspace");
  await dlg.getByRole("option", { name: /New issue/ }).waitFor();
  check(true, "Backspace on an empty sub-page returns to the main commands");
  await page.keyboard.press("Escape");
  await dlg.waitFor({ state: "detached" });
  check(true, "Esc closes the palette");

  // "/" still focuses search; dark + phone.
  await page.keyboard.press("/");
  check(await page.getByRole("search", { name: "Search issues, messages and accounts" }).getByRole("searchbox").evaluate((el) => el === document.activeElement).catch(() => false)
    || await page.evaluate(() => document.activeElement?.getAttribute("type") === "search"), "/ focuses the search box");
  await page.keyboard.press("Escape");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.locator("body").click({ position: { x: 900, y: 450 } });
  await page.keyboard.press("Control+k");
  await dlg.waitFor();
  await axeCheck(page, "command palette (dark)");
  await page.keyboard.press("Escape");
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/inbox`);
  await list.getByRole("listitem").first().waitFor();
  await page.keyboard.press("Control+k");
  await dlg.waitFor();
  await page.keyboard.type("queue item 2");
  await dlg.getByRole("option").first().waitFor();
  check(await noOverflow(page), "390px: palette fits without horizontal overflow");
  await page.screenshot({ path: path.join(shots, "palette-390.png") });
  await axeCheck(page, "command palette (390)");

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
