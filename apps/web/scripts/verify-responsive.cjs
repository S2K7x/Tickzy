// Real-browser check of the app shell (ux-spec §2.6, §2.7): nav variant per breakpoint, no horizontal overflow,
// theme applied, zero axe violations (incl. colour contrast), light + dark.
// Usage: pnpm --filter @tickzy/web build && npx vite preview --port 4173 & node scripts/verify-responsive.cjs . /tmp/shots
const { chromium } = (() => { try { return require("playwright"); } catch { return require("/opt/node-tools/node_modules/playwright"); } })();
const fs = require("fs");
const axeSrc = fs.readFileSync(require.resolve("axe-core/axe.min.js", { paths: [process.argv[2]] }), "utf8");
const out = process.argv[3];
(async () => {
  const browser = await chromium.launch();
  let failed = 0;
  for (const theme of ["light", "dark"]) {
    for (const [w, h, expect] of [[390, 844, "bottom-tabs"], [768, 1024, "icon-rail"], [1280, 900, "sidebar"]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
      const page = await ctx.newPage();
      await page.goto("http://localhost:4173/");
      await page.waitForSelector("h1");
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
