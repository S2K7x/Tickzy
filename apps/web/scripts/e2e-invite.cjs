// End-to-end check of T-102 (invitations & members) against the REAL server + Postgres.
// Same prerequisites as e2e-auth.cjs. Usage: node scripts/e2e-invite.cjs <server-log-path> <screenshot-dir>
// Journey: admin signs up and creates a workspace → invites a teammate → teammate opens the invite link signed
// out → signs in via magic link → lands back on the invitation → accepts → sees the workspace; admin changes the
// role; the last-admin guard holds; a wrong-account and a revoked invite are refused.
const { chromium } = (() => { try { return require("playwright"); } catch { return require("/opt/node-tools/node_modules/playwright"); } })();
const fs = require("fs");
const path = require("path");
const axeSrc = fs.readFileSync(require.resolve("axe-core/axe.min.js", { paths: [__dirname] }), "utf8");
const [logPath, shots] = process.argv.slice(2);
const BASE = "http://localhost:4173";
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "PASS" : "FAIL"} ${label}`); if (!ok) failures++; };

async function axeCheck(page, label) {
  await page.addScriptTag({ content: axeSrc });
  const v = await page.evaluate(async () => (await axe.run()).violations.map((x) => `${x.id}(${x.impact})`));
  check(v.length === 0, `axe ${label} ${v.length ? JSON.stringify(v) : ""}`);
}
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

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
const logSize = () => fs.statSync(logPath).size;

async function signIn(page, email) {
  const mark = logSize();
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByRole("heading", { name: "Check your email" }).waitFor();
  await page.goto(await waitForLink(email, "auth/verify", mark));
}

(async () => {
  const browser = await chromium.launch();
  const stamp = Date.now().toString(36);
  const adminEmail = `admin-${stamp}@example.com`;
  const mateEmail = `mate-${stamp}@example.com`;

  // 1. Admin signs up and creates a workspace.
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await adminCtx.newPage();
  await admin.goto(`${BASE}/sign-in`);
  await signIn(admin, adminEmail);
  await admin.getByRole("heading", { name: "Create your workspace" }).waitFor({ timeout: 10000 });
  await admin.getByLabel("Company or team name").fill("Invite Test Co");
  await admin.getByLabel("Workspace URL").fill(`inv-${stamp}`);
  await admin.getByRole("button", { name: "Create workspace" }).click();
  await admin.getByRole("heading", { name: "Overview" }).waitFor({ timeout: 10000 });

  // 2. Settings › Members, invite a teammate.
  await admin.getByRole("link", { name: "Settings" }).first().click();
  await admin.getByRole("heading", { name: "Members & roles" }).waitFor();
  check(new URL(admin.url()).pathname === "/settings/members", "/settings opens Members & roles");
  await admin.getByText("(you)").waitFor();
  check(await admin.getByText(adminEmail).first().isVisible(), "admin sees themself in the member list");
  const mark = logSize();
  await admin.getByLabel("Email address").fill(mateEmail);
  await admin.getByLabel("Role", { exact: true }).selectOption("agent");
  await admin.getByRole("button", { name: "Send invite" }).click();
  await admin.getByText(`Invitation sent to ${mateEmail}.`).waitFor();
  check(await admin.getByRole("button", { name: `Revoke invitation to ${mateEmail}` }).isVisible(), "pending invitation listed");
  await axeCheck(admin, "members (admin, light)");
  await admin.screenshot({ path: path.join(shots, "members-1280.png"), fullPage: true });
  const inviteLink = await waitForLink(mateEmail, "invite", mark);
  check(inviteLink.startsWith(`${BASE}/invite#token=`), "invite email links to the web app with the token in the fragment");

  // 3. Wrong account: the admin opens the teammate's link.
  const wrong = await adminCtx.newPage();
  await wrong.goto(inviteLink);
  await wrong.getByRole("alert").waitFor({ timeout: 10000 });
  check((await wrong.getByRole("alert").textContent()).includes(`This invitation is for ${mateEmail}`), "signed in as someone else: refused with an explanation");
  await wrong.close();

  // 4. Teammate on a phone, signed out.
  const mateCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mate = await mateCtx.newPage();
  await mate.goto(inviteLink);
  await mate.getByRole("heading", { name: "Join Invite Test Co" }).waitFor({ timeout: 10000 });
  check(!mate.url().includes("token="), "invite token removed from the URL");
  check(await mate.getByText(`invited ${mateEmail} to join as agent`).isVisible(), "preview names the inviter, invitee and role");
  check(await noOverflow(mate), "390px invite page has no horizontal overflow");
  await axeCheck(mate, "invite (signed out, 390)");
  await mate.screenshot({ path: path.join(shots, "invite-390.png") });
  await mate.getByRole("link", { name: "Sign in to accept" }).click();
  check((await mate.getByLabel("Work email").inputValue()) === mateEmail, "sign-in prefilled with the invited email");
  await signIn(mate, mateEmail);
  await mate.getByRole("button", { name: "Accept and join Invite Test Co" }).waitFor({ timeout: 10000 });
  check(new URL(mate.url()).pathname === "/invite", "after the magic link the teammate returns to the invitation (not onboarding)");
  await mate.getByRole("button", { name: "Accept and join Invite Test Co" }).click();
  await mate.getByRole("heading", { name: "Overview" }).waitFor({ timeout: 10000 });
  check(true, "teammate accepted and entered the workspace");
  await mate.getByRole("link", { name: "More" }).click();
  await mate.getByRole("link", { name: "Settings" }).click();
  await mate.getByRole("heading", { name: "Members & roles" }).waitFor();
  check(new URL(mate.url()).pathname === "/settings/members", "phone: Settings reachable from the More tab");
  check(!(await mate.getByRole("button", { name: "Send invite" }).count()), "agent sees members read-only (no invite form)");
  check(await noOverflow(mate), "390px members page has no horizontal overflow");
  await axeCheck(mate, "members (agent, 390)");
  await mate.screenshot({ path: path.join(shots, "members-agent-390.png"), fullPage: true });
  const reuse = await mateCtx.newPage();
  await reuse.goto(inviteLink);
  await reuse.getByRole("heading", { name: /This invitation (can't be used|didn't work)/ }).waitFor({ timeout: 10000 });
  check(true, "re-opening an accepted invite is refused");
  await reuse.close();

  // 5. Admin sees the new member, changes the role; last-admin guard.
  await admin.reload();
  await admin.getByLabel(`Role for ${mateEmail}`).waitFor();
  check(!(await admin.getByRole("button", { name: `Revoke invitation to ${mateEmail}` }).count()), "accepted invitation left the pending list");
  await admin.getByLabel(`Role for ${mateEmail}`).selectOption("collaborator");
  await admin.getByText(`${mateEmail} is now collaborator.`).waitFor();
  check(true, "admin changed the teammate's role");
  await admin.getByLabel(`Role for ${adminEmail}`).selectOption("viewer");
  await admin.getByRole("alert").waitFor();
  check((await admin.getByRole("alert").textContent()).includes("at least one active admin"), "last-admin guard refuses demoting the only admin");

  // 6. Revoked invitation cannot be used.
  const mark2 = logSize();
  const thirdEmail = `third-${stamp}@example.com`;
  await admin.getByLabel("Email address").fill(thirdEmail);
  await admin.getByRole("button", { name: "Send invite" }).click();
  await admin.getByText(`Invitation sent to ${thirdEmail}.`).waitFor();
  const thirdLink = await waitForLink(thirdEmail, "invite", mark2);
  await admin.getByRole("button", { name: `Revoke invitation to ${thirdEmail}` }).click();
  await admin.getByText(`Invitation to ${thirdEmail} revoked.`).waitFor();
  const thirdCtx = await browser.newContext();
  const third = await thirdCtx.newPage();
  await third.goto(thirdLink);
  await third.getByRole("heading", { name: "This invitation can't be used" }).waitFor({ timeout: 10000 });
  check(await third.getByText(/It was revoked/).isVisible(), "revoked invitation explains why");

  // 7. Dark mode check of the admin members page.
  await admin.getByRole("button", { name: "Switch to dark mode" }).click();
  await axeCheck(admin, "members (admin, dark)");
  await admin.screenshot({ path: path.join(shots, "members-1280-dark.png"), fullPage: true });

  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
