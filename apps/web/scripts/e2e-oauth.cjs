// End-to-end check of T-101b (Google & Microsoft sign-in) in a real browser against the REAL server + Postgres and
// a mock OpenID provider process (apps/server/scripts/mock-oidc.ts) standing in for Google/Microsoft.
// Usage: node scripts/e2e-oauth.cjs <server-log-path> <screenshot-dir> <mock-issuer-url>
const path = require("path");
const { chromium, BASE, createRun } = require("./e2e-lib.cjs");
const [logPath, shots, issuer] = process.argv.slice(2);
const { check, axeCheck, noOverflow, signUpWithWorkspace, waitForLink, logSize, finish } = createRun(logPath);
const setClaims = (claims) => fetch(`${issuer}/control/claims`, { method: "POST", body: JSON.stringify(claims) });

(async () => {
  const browser = await chromium.launch();
  const stamp = Date.now().toString(36);

  // 1. New user via Google → onboarding, real session cookie.
  let ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let page = await ctx.newPage();
  await page.goto(`${BASE}/sign-in`);
  await page.getByRole("link", { name: "Continue with Google" }).waitFor();
  check(await page.getByRole("link", { name: "Continue with Microsoft" }).isVisible(), "both enabled providers offered");
  await axeCheck(page, "sign-in with providers (light)");
  await page.screenshot({ path: path.join(shots, "signin-providers-1280.png") });
  const nina = `nina-${stamp}@example.com`;
  await setClaims({ sub: `g-${stamp}`, email: nina, email_verified: true, name: "Nina Park" });
  await page.getByRole("link", { name: "Continue with Google" }).click();
  await page.getByRole("heading", { name: "Create your workspace" }).waitFor({ timeout: 10000 });
  check(new URL(page.url()).origin === BASE, "returned to the app after the provider round trip");
  const cookies = await ctx.cookies();
  check(cookies.some((c) => c.name === "tz_session" && c.httpOnly), "session cookie set (httpOnly)");
  check(!cookies.some((c) => c.name === "tz_oauth" && c.value), "pending-login cookie cleared");
  await ctx.close();

  // 2. Unverified Google email → explained, no session.
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  page = await ctx.newPage();
  await setClaims({ sub: `g2-${stamp}`, email: `x-${stamp}@example.com`, email_verified: false });
  await page.goto(`${BASE}/sign-in`);
  await page.getByRole("link", { name: "Continue with Google" }).click();
  await page.getByRole("alert").waitFor({ timeout: 10000 });
  check((await page.getByRole("alert").textContent()).includes("isn't verified by the provider"), "unverified email refused with an explanation");
  check(!(await ctx.cookies()).some((c) => c.name === "tz_session"), "no session for an unverified email");
  check(await noOverflow(page), "390px sign-in with error has no horizontal overflow");
  await axeCheck(page, "sign-in with error (390)");
  await page.screenshot({ path: path.join(shots, "signin-error-390.png") });

  // 3. Microsoft without xms_edov → refused (nOAuth); with it → signed in.
  await setClaims({ sub: "pw", tid: `t-${stamp}`, oid: "o1", email: `ms-${stamp}@corp.example` });
  await page.getByRole("link", { name: "Continue with Microsoft" }).click();
  await page.waitForURL(/error=email_unverified/, { timeout: 10000 });
  check(true, "Microsoft email without xms_edov refused");
  await setClaims({ sub: "pw", tid: `t-${stamp}`, oid: "o1", email: `ms-${stamp}@corp.example`, xms_edov: true });
  await page.getByRole("link", { name: "Continue with Microsoft" }).click();
  await page.getByRole("heading", { name: "Create your workspace" }).waitFor({ timeout: 10000 });
  check(true, "Microsoft sign-in with domain-verified email succeeds");
  await ctx.close();

  // 4. Cancelled consent.
  ctx = await browser.newContext();
  page = await ctx.newPage();
  await setClaims({ __deny: true });
  await page.goto(`${BASE}/sign-in`);
  await page.getByRole("link", { name: "Continue with Google" }).click();
  await page.getByText("Sign-in was cancelled.").waitFor({ timeout: 10000 });
  check(true, "cancelled consent explained");
  await ctx.close();

  // 5. Invitation accepted after Google sign-in.
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await adminCtx.newPage();
  await signUpWithWorkspace(admin, `oadmin-${stamp}@example.com`, "OAuth Co", `oa-${stamp}`);
  await admin.goto(`${BASE}/settings/members`);
  const mate = `omate-${stamp}@example.com`;
  const mark = logSize();
  await admin.getByLabel("Email address").fill(mate);
  await admin.getByRole("button", { name: "Send invite" }).click();
  await admin.getByText(`Invitation sent to ${mate}.`).waitFor();
  const inviteLink = await waitForLink(mate, "invite", mark);
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  page = await ctx.newPage();
  await page.goto(inviteLink);
  await page.getByRole("link", { name: "Sign in to accept" }).click();
  await setClaims({ sub: `g3-${stamp}`, email: mate, email_verified: true, name: "Mate" });
  await page.getByRole("link", { name: "Continue with Google" }).click();
  await page.getByRole("button", { name: "Accept and join OAuth Co" }).waitFor({ timeout: 10000 });
  check(new URL(page.url()).pathname === "/invite", "provider sign-in returns to the pending invitation");
  await page.getByRole("button", { name: "Accept and join OAuth Co" }).click();
  await page.getByRole("heading", { name: "Overview" }).waitFor({ timeout: 10000 });
  check(true, "invitation accepted after Google sign-in");

  // 6. Dark mode sign-in page.
  ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  page = await ctx.newPage();
  await page.goto(`${BASE}/sign-in?error=cancelled`);
  await page.getByRole("link", { name: "Continue with Google" }).waitFor();
  await axeCheck(page, "sign-in with providers + error (dark)");

  await browser.close();
  finish();
})().catch((err) => { console.error(err); process.exit(1); });
