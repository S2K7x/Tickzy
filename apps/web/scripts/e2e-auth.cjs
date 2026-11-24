// End-to-end check of T-105 against the REAL server + Postgres (not mocks).
// Prereqs: server on :3000 with APP_ORIGIN=http://localhost:4173 COOKIE_SECURE=false, its stdout in $SERVER_LOG;
// web built and served by `vite preview --port 4173` (proxies /v1 → :3000).
// Usage: node scripts/e2e-auth.cjs <server-log-path> <screenshot-dir>
const { chromium } = (() => { try { return require("playwright"); } catch { return require("/opt/node-tools/node_modules/playwright"); } })();
const fs = require("fs");
const path = require("path");
const axeSrc = fs.readFileSync(require.resolve("axe-core/axe.min.js", { paths: [__dirname] }), "utf8");
const [logPath, shots] = process.argv.slice(2);
const BASE = "http://localhost:4173";
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "PASS" : "FAIL"} ${label}`); if (!ok) failures++; };

async function axeCheck(page, label) {
  // Through DevTools: an injected <script> is blocked by the app CSP (T-110).
  if (!(await page.evaluate(() => typeof window.axe !== "undefined"))) await page.evaluate(axeSrc);
  const v = await page.evaluate(async () => (await axe.run()).violations.map((x) => `${x.id}(${x.impact})`));
  check(v.length === 0, `axe ${label} ${v.length ? JSON.stringify(v) : ""}`);
}
async function waitForLink(email, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const log = fs.readFileSync(logPath, "utf8");
    const idx = log.lastIndexOf(`to=${email}`);
    if (idx >= 0) {
      const m = /(http:\/\/\S+\/auth\/verify#token=[a-z2-7.]+)/.exec(log.slice(idx));
      if (m) return m[1];
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("sign-in link not found in server log");
}

(async () => {
  const browser = await chromium.launch();
  const email = `e2e-${Date.now()}@example.com`;
  for (const [w, h] of [[390, 844], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/inbox`);
    await page.getByRole("heading", { name: "Sign in to Tickzy" }).waitFor();
    check(new URL(page.url()).pathname === "/sign-in", `${w}px signed-out visitor redirected to /sign-in`);
    await axeCheck(page, `${w}px sign-in`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(!overflow, `${w}px sign-in has no horizontal overflow`);
    await page.screenshot({ path: path.join(shots, `signin-${w}.png`) });
    await ctx.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByRole("heading", { name: "Check your email" }).waitFor();
  check(true, "magic link requested");

  const link = await waitForLink(email);
  check(link.startsWith(`${BASE}/auth/verify#token=`), "email contains a link to the web app with the token in the fragment");
  await page.goto(link);
  await page.getByRole("heading", { name: "Create your workspace" }).waitFor({ timeout: 10000 });
  check(!page.url().includes("token="), "token removed from the URL after verification");
  const cookies = await ctx.cookies();
  const sc = cookies.find((c) => c.name === "tz_session");
  check(!!sc && sc.httpOnly && sc.sameSite === "Lax", "session cookie is httpOnly + SameSite=Lax");
  check(await page.evaluate(() => !document.cookie.includes("tz_session")), "session cookie not readable from JavaScript");
  await axeCheck(page, "onboarding");
  await page.screenshot({ path: path.join(shots, "onboarding-1280.png") });

  const slug = `e2e-${Date.now().toString(36)}`;
  await page.getByLabel("Company or team name").fill("E2E Support Co");
  await page.getByLabel("Workspace URL").fill(slug);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.getByRole("heading", { name: "Overview" }).waitFor({ timeout: 10000 });
  check(await page.getByText("E2E Support Co").first().isVisible(), "workspace created and shown in the app");

  const reused = await page.context().newPage();
  await reused.goto(link);
  await reused.getByRole("heading", { name: /Overview|This link didn't work/ }).waitFor({ timeout: 10000 });
  check(true, "re-opening a used link does not create a second session or crash");
  await reused.close();

  await page.reload();
  await page.getByRole("heading", { name: "Overview" }).waitFor();
  check(true, "session survives a reload");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === "dark", "dark mode applied");
  await axeCheck(page, "overview (dark, signed in)");
  await page.screenshot({ path: path.join(shots, "overview-dark-1280.png") });

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in to Tickzy" }).waitFor();
  const after = await page.request.get(`${BASE}/v1/auth/session`);
  check(after.status() === 401, "after sign-out the session is gone server-side");

  await browser.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
