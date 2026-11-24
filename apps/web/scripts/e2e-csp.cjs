// Real-browser check of T-110 (security headers + CSP) against the built app served with the production headers.
// Walks the main screens and fails on ANY Content-Security-Policy violation, on a third-party request, or if the
// self-hosted font does not load. Usage: node scripts/e2e-csp.cjs <server-log-path> <screenshot-dir>
const { chromium, BASE, createRun } = require("./e2e-lib.cjs");
const [logPath] = process.argv.slice(2);
const { check, axeCheck, signUpWithWorkspace, finish } = createRun(logPath);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  // Collect violations from the very first script on every page (init scripts are not subject to the page's CSP).
  await ctx.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile || ""}:${e.lineNumber || ""}`));
  });
  const page = await ctx.newPage();
  const foreign = [];
  page.on("request", (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith("data:")) foreign.push(r.url()); });
  const consoleCsp = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) consoleCsp.push(m.text()); });
  const violations = async (label) => {
    const v = await page.evaluate(() => window.__csp ?? []);
    check(v.length === 0, `no CSP violations: ${label}${v.length ? ` ${JSON.stringify(v)}` : ""}`);
  };

  const res = await page.goto(`${BASE}/sign-in`);
  const h = res.headers();
  check(/default-src 'self'/.test(h["content-security-policy"] ?? "") && !/unsafe-inline|unsafe-eval/.test(h["content-security-policy"]), "document has a strict CSP (no unsafe-inline / unsafe-eval)");
  check(h["x-frame-options"] === "DENY" && h["x-content-type-options"] === "nosniff" && !!h["referrer-policy"], "document has frame, sniffing and referrer protections");
  await violations("sign-in");

  const stamp = Date.now().toString(36);
  await signUpWithWorkspace(page, `csp-${stamp}@example.com`, "CSP Co", `csp-${stamp}`);
  check(await page.evaluate(() => document.documentElement.dataset.theme === "light" || document.documentElement.dataset.theme === "dark"), "theme applied before React (external theme-init.js runs under the CSP)");
  await page.evaluate(() => document.fonts.ready);
  check(await page.evaluate(() => document.fonts.check('16px "Inter Variable"') && [...document.fonts].some((f) => f.family.includes("Inter") && f.status === "loaded")), "self-hosted Inter font loads (no Google Fonts)");
  await violations("overview");

  const ws = await page.evaluate(() => localStorage.getItem("tickzy.workspace"));
  const key = await page.evaluate(async (w) => (await (await fetch("/v1/issues", { method: "POST", headers: { "content-type": "application/json", "tickzy-workspace": w }, body: JSON.stringify({ title: "CSP check issue", priority: "high" }) })).json()).key, ws);
  const api = await page.evaluate(async (w) => { const r = await fetch("/v1/issues", { headers: { "tickzy-workspace": w } }); return { csp: r.headers.get("content-security-policy"), cache: r.headers.get("cache-control"), nosniff: r.headers.get("x-content-type-options") }; }, ws);
  check(api.csp === "default-src 'none'; frame-ancestors 'none'" && api.cache === "no-store" && api.nosniff === "nosniff", "API responses: deny-all CSP, no-store, nosniff");

  await page.goto(`${BASE}/inbox?issue=${key}`);
  await page.getByRole("heading", { level: 2, name: "CSP check issue" }).waitFor();
  await page.getByLabel("Reply to the customer").fill("Testing under CSP");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("list", { name: "Timeline" }).getByText("Testing under CSP").waitFor({ timeout: 10000 });
  check(true, "inbox works under the CSP (reply sent, realtime socket connects same-origin)");
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog", { name: "Command palette" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "New issue" }).click();
  await page.getByRole("dialog", { name: "New issue" }).waitFor();
  await page.keyboard.press("Escape");
  await violations("inbox, palette, dialogs (incl. scroll-lock styles)");
  for (const path of ["/accounts", "/search?q=csp", "/settings/members", "/settings/api-tokens"]) {
    await page.goto(`${BASE}${path}`);
    await page.locator("main h1, main h2").first().waitFor();
    await violations(path);
  }
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${BASE}/`);
  await page.getByRole("heading", { name: "Overview" }).waitFor();
  await axeCheck(page, "overview under CSP (axe injected through DevTools, not a script tag)");
  await violations("overview dark");
  check(consoleCsp.length === 0, `no CSP errors in the console${consoleCsp.length ? ` ${JSON.stringify(consoleCsp.slice(0, 3))}` : ""}`);
  check(foreign.length === 0, `no third-party requests${foreign.length ? ` ${JSON.stringify([...new Set(foreign)].slice(0, 5))}` : ""}`);

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
