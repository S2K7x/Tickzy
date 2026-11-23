// Real-browser check of the app shell (ux-spec §2.6, §2.7): nav variant per breakpoint, no horizontal overflow,
// theme applied, zero axe violations (incl. colour contrast), light + dark.
// Signs in through the REAL API first (the app shell is only shown to signed-in users with a workspace).
// Prereqs as for e2e-auth.cjs (server on :3000 with APP_ORIGIN=http://localhost:4173 COOKIE_SECURE=false; preview on :4173).
// Usage: node scripts/verify-responsive.cjs <web-dir> <screenshot-dir> <server-log-path>
const { chromium } = (() => { try { return require("playwright"); } catch { return require("/opt/node-tools/node_modules/playwright"); } })();
const fs = require("fs");
const axeSrc = fs.readFileSync(require.resolve("axe-core/axe.min.js", { paths: [process.argv[2]] }), "utf8");
const out = process.argv[3];
const logPath = process.argv[4];
const BASE = "http://localhost:4173";

/** Signs in a fresh user via magic link (token read from the dev console email in the server log) and creates a workspace. */
async function signedInStorage(browser) {
  const ctx = await browser.newContext();
  const email = `resp-${Date.now()}@example.com`;
  const req = ctx.request;
  const headers = { origin: BASE };
  if ((await req.post(`${BASE}/v1/auth/magic-link`, { headers, data: { email } })).status() !== 202) throw new Error("magic link failed");
  let token = null;
  for (let i = 0; i < 50 && !token; i++) {
    const log = fs.readFileSync(logPath, "utf8");
    const at = log.lastIndexOf(`to=${email}`);
    const m = at >= 0 ? /#token=([a-z2-7.]+)/.exec(log.slice(at)) : null;
    token = m ? m[1] : null;
    if (!token) await new Promise((r) => setTimeout(r, 200));
  }
  if (!token) throw new Error("token not found in server log");
  if ((await req.post(`${BASE}/v1/auth/magic-link/verify`, { headers, data: { token } })).status() !== 200) throw new Error("verify failed");
  const slug = `resp-${Date.now().toString(36)}`;
  if ((await req.post(`${BASE}/v1/workspaces`, { headers, data: { name: "Responsive Check", slug, issue_prefix: "RC" } })).status() !== 201) throw new Error("workspace failed");
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}
(async () => {
  const browser = await chromium.launch();
  const storageState = await signedInStorage(browser);
  let failed = 0;
  for (const theme of ["light", "dark"]) {
    for (const [w, h, expect] of [[390, 844, "bottom-tabs"], [768, 1024, "icon-rail"], [1024, 768, "icon-rail"], [1280, 900, "sidebar"]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, storageState });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/`);
      await page.getByRole("heading", { name: "Overview" }).waitFor();
      const visible = {};
      for (const id of ["sidebar", "icon-rail", "bottom-tabs"]) visible[id] = await page.locator(`[data-testid=${id}]`).isVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      const applied = await page.evaluate(() => document.documentElement.dataset.theme);
      await page.addScriptTag({ content: axeSrc });
      const v = await page.evaluate(async () => (await axe.run()).violations.map((x) => `${x.id}(${x.impact}):${x.nodes.length}`));
      const ok = visible[expect] && Object.entries(visible).filter(([k, s]) => s && k !== expect).length === 0 && !overflow && applied === theme && v.length === 0;
      if (!ok) failed++;
      console.log(`${ok ? "PASS" : "FAIL"} ${theme} ${w}px nav=${JSON.stringify(visible)} overflow=${overflow} theme=${applied} axe=${JSON.stringify(v)}`);
      await page.screenshot({ path: `${out}/shell-${theme}-${w}.png` });
      await ctx.close();
    }
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
