// Real-browser check of T-211 (saved views) against the REAL server + Postgres + worker, with two teammates.
// Usage: node scripts/e2e-views.cjs <server-log-path> <screenshot-dir>
const path = require("path");
const { chromium, BASE, createRun } = require("./e2e-lib.cjs");
const [logPath, shots] = process.argv.slice(2);
const { check, axeCheck, noOverflow, logSize, waitForLink, signIn, signUpWithWorkspace, finish } = createRun(logPath);

(async () => {
  const browser = await chromium.launch();
  const stamp = Date.now().toString(36);
  const adminEmail = `vw-admin-${stamp}@example.com`, mateEmail = `vw-mate-${stamp}@example.com`;
  const admin = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const mate = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  await signUpWithWorkspace(admin, adminEmail, "Views Co", `vw-${stamp}`);
  await admin.goto(`${BASE}/settings/members`);
  const mark = logSize();
  await admin.getByLabel("Email address").fill(mateEmail);
  await admin.getByLabel("Role", { exact: true }).selectOption("agent");
  await admin.getByRole("button", { name: "Send invite" }).click();
  await admin.getByText(`Invitation sent to ${mateEmail}.`).waitFor();
  await mate.goto(await waitForLink(mateEmail, "invite", mark));
  await mate.getByRole("link", { name: "Sign in to accept" }).click();
  await signIn(mate, mateEmail);
  await mate.getByRole("button", { name: "Accept and join Views Co" }).click({ timeout: 10000 });
  await mate.getByRole("heading", { name: "Overview" }).waitFor({ timeout: 10000 });

  const ws = await admin.evaluate(() => localStorage.getItem("tickzy.workspace"));
  const mk = (page, title, priority) => page.evaluate(async ([t, p, w]) => (await (await fetch("/v1/issues", { method: "POST", headers: { "content-type": "application/json", "tickzy-workspace": w }, body: JSON.stringify({ title: t, priority: p }) })).json()).key, [title, priority, ws]);
  await mk(admin, "Webhook outage", "urgent");
  await mk(admin, "SSO loop", "high");
  await mk(admin, "Docs typo", "low");

  // Admin: filter → Save view (personal).
  await admin.goto(`${BASE}/inbox`);
  const aq = admin.getByRole("region", { name: "Issue queue" });
  await aq.getByText("Docs typo").waitFor();
  await aq.getByRole("button", { name: /^Filter\b/ }).click();
  await aq.getByRole("group", { name: "Filters" }).getByRole("checkbox", { name: "Urgent" }).check();
  await aq.getByText("Docs typo").waitFor({ state: "detached" });
  await aq.getByRole("button", { name: /^Filter\b/ }).click();
  await aq.getByRole("button", { name: "Save view" }).click();
  let dlg = admin.getByRole("dialog", { name: "Save view" });
  await dlg.getByLabel("Name").fill("Urgent only");
  await axeCheck(admin, "save view dialog");
  await dlg.getByRole("button", { name: "Save view" }).click();
  const saved = admin.getByRole("navigation", { name: "Saved views" });
  await saved.getByRole("button", { name: /Urgent only\s*1/ }).waitFor({ timeout: 10000 });
  check(/^vw_/.test(new URL(admin.url()).searchParams.get("saved") ?? ""), "saved view created with count 1 and opened (id in the URL)");

  // Modify → Save changes → count follows.
  await aq.getByRole("button", { name: /^Filter\b/ }).click();
  await aq.getByRole("group", { name: "Filters" }).getByRole("checkbox", { name: "High" }).check();
  await aq.getByText("Modified").waitFor();
  check(true, "changing a filter marks the view Modified");
  await aq.getByRole("button", { name: "Save changes" }).click();
  await saved.getByRole("button", { name: /Urgent only\s*2/ }).waitFor({ timeout: 10000 });
  check(!(await aq.getByText("Modified").count()), "Save changes stores the filters; count now 2");
  await aq.getByRole("button", { name: /^Filter\b/ }).click();

  // Shared view, seen live by the teammate.
  await mate.goto(`${BASE}/inbox`);
  const mq = mate.getByRole("region", { name: "Issue queue" });
  await mq.getByText("Docs typo").waitFor();
  check(!(await mate.getByRole("navigation", { name: "Saved views" }).count()), "the teammate does not see the admin's personal view");
  await admin.goto(`${BASE}/inbox?view=on-us&sort=oldest`);
  await aq.getByRole("button", { name: "Save view" }).click();
  dlg = admin.getByRole("dialog", { name: "Save view" });
  await dlg.getByLabel("Name").fill("Team triage");
  await dlg.getByRole("checkbox", { name: /Share with the workspace/ }).check();
  await dlg.getByRole("button", { name: "Save view" }).click();
  const mateViews = mate.getByRole("navigation", { name: "Saved views" });
  await mateViews.getByRole("button", { name: /Team triage\s*3/ }).waitFor({ timeout: 5000 });
  check(true, "a shared view appears for the teammate live (no reload), with its count");
  await mateViews.getByRole("button", { name: /Team triage/ }).click();
  check(new URL(mate.url()).searchParams.get("sort") === "oldest" && new URL(mate.url()).searchParams.get("view") === "on-us", "opening it applies its tab and sort");
  check(!(await mq.getByRole("button", { name: "Edit view" }).count()), "the teammate cannot edit someone else's shared view");

  // Teammate creates an urgent issue → admin's counts update live.
  await admin.goto(`${BASE}/inbox`);
  await saved.getByRole("button", { name: /Urgent only\s*2/ }).waitFor();
  await mk(mate, "Billing page 500", "urgent");
  await saved.getByRole("button", { name: /Urgent only\s*3/ }).waitFor({ timeout: 5000 });
  check(true, "a teammate's new issue updates the view count live");
  await admin.screenshot({ path: path.join(shots, "views-1440.png") });
  await axeCheck(admin, "inbox with saved views (1440)");

  // ⌘K → view.
  await admin.keyboard.press("Control+k");
  const pal = admin.getByRole("dialog", { name: "Command palette" });
  await pal.getByRole("combobox").fill("team tri");
  await pal.getByRole("option", { name: /Team triage/ }).waitFor();
  await admin.keyboard.press("Enter");
  await admin.waitForURL(/saved=vw_/);
  check(new URL(admin.url()).searchParams.get("view") === "on-us", "⌘K opens a saved view");

  // Admin deletes the shared view → gone for the teammate live.
  await aq.getByRole("button", { name: "Delete view" }).click();
  await axeCheck(admin, "delete view dialog");
  await admin.getByRole("dialog", { name: /Delete view/ }).getByRole("button", { name: "Delete view" }).click();
  await mateViews.getByRole("button", { name: /Team triage/ }).waitFor({ state: "detached", timeout: 5000 });
  check(true, "deleting a shared view removes it for the teammate live");
  check(!new URL(admin.url()).searchParams.get("saved"), "after delete the inbox leaves the view");

  // Dark + narrow.
  await admin.emulateMedia({ colorScheme: "dark" });
  await axeCheck(admin, "inbox with saved views (dark)");
  await admin.emulateMedia({ colorScheme: "light" });
  for (const w of [1024, 390]) {
    await admin.setViewportSize({ width: w, height: 860 });
    await admin.goto(`${BASE}/inbox?priority=low`);
    await saved.waitFor();
    check(await noOverflow(admin), `${w}px: no horizontal overflow with saved views`);
    await admin.screenshot({ path: path.join(shots, `views-${w}.png`) });
  }
  await axeCheck(admin, "saved views (390)");

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
