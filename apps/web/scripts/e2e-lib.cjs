// Shared helpers for the real-stack browser checks (server on :3000 with console email, web on :4173).
const { chromium } = (() => { try { return require("playwright"); } catch { return require("/opt/node-tools/node_modules/playwright"); } })();
const fs = require("fs");
const axeSrc = fs.readFileSync(require.resolve("axe-core/axe.min.js", { paths: [__dirname] }), "utf8");
const BASE = "http://localhost:4173";
const API = "http://localhost:3000";

function createRun(logPath) {
  let failures = 0;
  const check = (ok, label) => { console.log(`${ok ? "PASS" : "FAIL"} ${label}`); if (!ok) failures++; };
  async function axeCheck(page, label) {
    await page.addScriptTag({ content: axeSrc });
    const v = await page.evaluate(async () => (await axe.run()).violations.map((x) => `${x.id}(${x.impact})`));
    check(v.length === 0, `axe ${label} ${v.length ? JSON.stringify(v) : ""}`);
  }
  const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const logSize = () => fs.statSync(logPath).size;
  async function waitForLink(email, kind, after = 0, timeoutMs = 10000) {
    const re = new RegExp(`(http://\\S+/${kind}#token=[a-z2-7.]+)`);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const log = fs.readFileSync(logPath, "utf8").slice(after);
      const idx = log.lastIndexOf(`to=${email}`);
      if (idx >= 0) {
        const m = re.exec(log.slice(idx));
        if (m) return m[1];
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`${kind} link for ${email} not found in server log`);
  }
  async function signIn(page, email) {
    const mark = logSize();
    await page.getByLabel("Work email").fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await page.getByRole("heading", { name: "Check your email" }).waitFor();
    await page.goto(await waitForLink(email, "auth/verify", mark));
  }
  /** Signs up a new user and creates a workspace; leaves the page on Overview. */
  async function signUpWithWorkspace(page, email, name, slug) {
    await page.goto(`${BASE}/sign-in`);
    await signIn(page, email);
    await page.getByRole("heading", { name: "Create your workspace" }).waitFor({ timeout: 10000 });
    await page.getByLabel("Company or team name").fill(name);
    await page.getByLabel("Workspace URL").fill(slug);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.getByRole("heading", { name: "Overview" }).waitFor({ timeout: 10000 });
  }
  const finish = () => { console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED"); process.exit(failures ? 1 : 0); };
  return { check, axeCheck, noOverflow, logSize, waitForLink, signIn, signUpWithWorkspace, finish };
}

module.exports = { chromium, BASE, API, createRun };
