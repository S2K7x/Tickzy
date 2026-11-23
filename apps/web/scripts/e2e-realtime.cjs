// Real-browser check of realtime (T-208) against the REAL server + Postgres + worker, two signed-in teammates.
// Usage: node scripts/e2e-realtime.cjs <server-log-path> <screenshot-dir>
// Journey: admin invites a teammate → both open the same issue → each sees the other "viewing"; the teammate types
// and the admin sees "typing…"; the teammate posts a note and the admin's timeline + queue update without a reload
// (polling is off while live); the teammate leaves and the presence clears.
const path = require("path");
const { chromium, BASE, createRun } = require("./e2e-lib.cjs");
const [logPath, shots] = process.argv.slice(2);
const { check, axeCheck, noOverflow, logSize, waitForLink, signIn, signUpWithWorkspace, finish } = createRun(logPath);

(async () => {
  const browser = await chromium.launch();
  const stamp = Date.now().toString(36);
  const adminEmail = `rt-admin-${stamp}@example.com`, mateEmail = `rt-mate-${stamp}@example.com`;
  const admin = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const mate = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  await signUpWithWorkspace(admin, adminEmail, "Realtime Co", `rt-${stamp}`);
  await admin.evaluate(() => localStorage.setItem("tickzy.sidebar", "expanded"));

  // Invite + accept the teammate.
  await admin.goto(`${BASE}/settings/members`);
  await admin.getByRole("heading", { name: "Members & roles" }).waitFor();
  const mark = logSize();
  await admin.getByLabel("Email address").fill(mateEmail);
  await admin.getByLabel("Role", { exact: true }).selectOption("agent");
  await admin.getByRole("button", { name: "Send invite" }).click();
  await admin.getByText(`Invitation sent to ${mateEmail}.`).waitFor();
  await mate.goto(await waitForLink(mateEmail, "invite", mark));
  await mate.getByRole("link", { name: "Sign in to accept" }).click();
  await signIn(mate, mateEmail);
  await mate.getByRole("button", { name: "Accept and join Realtime Co" }).click({ timeout: 10000 });
  await mate.getByRole("heading", { name: "Overview" }).waitFor({ timeout: 10000 });

  const ws = await admin.evaluate(() => localStorage.getItem("tickzy.workspace"));
  const key = await admin.evaluate(async (w) => (await (await fetch("/v1/issues", { method: "POST", headers: { "content-type": "application/json", "tickzy-workspace": w }, body: JSON.stringify({ title: "Webhook signatures fail after rotation", priority: "high" }) })).json()).key, ws);

  // Track polling: once live, the queue must not be re-fetched on a timer.
  let adminListFetches = 0;
  admin.on("request", (r) => { if (/\/v1\/issues\?/.test(r.url())) adminListFetches++; });

  await admin.goto(`${BASE}/inbox?issue=${key}`);
  await admin.getByRole("heading", { level: 2, name: "Webhook signatures fail after rotation" }).waitFor();
  await mate.goto(`${BASE}/inbox?issue=${key}`);
  await mate.getByRole("heading", { level: 2, name: "Webhook signatures fail after rotation" }).waitFor();

  const adminPresence = admin.getByRole("region", { name: "Conversation" }).getByRole("status").filter({ hasText: /rt-mate/ });
  await adminPresence.filter({ hasText: "is viewing" }).waitFor({ timeout: 10000 });
  check(true, "admin sees the teammate viewing the same issue");
  await mate.getByRole("status").filter({ hasText: /rt-admin.*is viewing/ }).waitFor({ timeout: 10000 });
  check(true, "teammate sees the admin viewing");
  const chip = await admin.getByRole("region", { name: "Conversation" }).getByRole("status").first().getAttribute("title");
  check(!chip.includes("rt-admin"), `you are never listed on your own screen (chip: "${chip}")`);

  await mate.getByLabel("Reply to the customer").click();
  await mate.keyboard.type("Checking the rotation job", { delay: 20 });
  await adminPresence.filter({ hasText: "is typing…" }).waitFor({ timeout: 10000 });
  check(true, "admin sees the teammate typing");
  await admin.screenshot({ path: path.join(shots, "realtime-presence-1440.png") });
  await axeCheck(admin, "inbox with presence (1440)");
  check(await noOverflow(admin), "1440: no horizontal overflow with the presence chip");

  // Teammate posts an internal note: admin's timeline updates without reload.
  await mate.getByRole("radio", { name: "Internal note" }).click();
  await mate.getByLabel("Internal note").fill("Rotation job skipped the EU region");
  const t0 = Date.now();
  await mate.getByRole("button", { name: "Add note" }).click();
  await admin.getByRole("list", { name: "Timeline" }).getByText("Rotation job skipped the EU region").waitFor({ timeout: 5000 });
  const latency = Date.now() - t0;
  check(latency < 3000, `admin's timeline shows the teammate's note in ${latency} ms (no reload, < 3 s)`);

  // New issue from the teammate appears in the admin's queue.
  await mate.evaluate(async (w) => fetch("/v1/issues", { method: "POST", headers: { "content-type": "application/json", "tickzy-workspace": w }, body: JSON.stringify({ title: "Export button greyed out" }) }), ws);
  await admin.getByRole("region", { name: "Issue queue" }).getByText("Export button greyed out").waitFor({ timeout: 5000 });
  check(true, "a teammate's new issue appears in the admin's queue live");

  // No timer polling while live: wait past the 15 s fallback interval with nothing happening.
  const before = adminListFetches;
  await admin.waitForTimeout(17000);
  check(adminListFetches === before, `no polling while the socket is live (${adminListFetches - before} list fetches in 17 s idle)`);

  // Teammate leaves: presence clears.
  await mate.goto(`${BASE}/`);
  await admin.waitForFunction(() => !/rt-mate\S* (is|are) (viewing|typing)/.test(document.body.innerText), null, { timeout: 10000 });
  check(true, "presence clears when the teammate leaves the issue");

  // Narrow viewport: chip fits.
  await mate.setViewportSize({ width: 390, height: 844 });
  await mate.goto(`${BASE}/inbox?issue=${key}`);
  await admin.getByRole("status").filter({ hasText: /rt-mate.*is viewing/ }).waitFor({ timeout: 10000 });
  await admin.setViewportSize({ width: 390, height: 844 });
  await admin.waitForTimeout(300);
  check(await noOverflow(admin), "390: no horizontal overflow with the presence chip");
  await admin.screenshot({ path: path.join(shots, "realtime-presence-390.png") });

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
