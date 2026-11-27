// Real-stack check of T-302a (inbound email): server + worker + Postgres, Postmark simulated by POSTing its
// webhook format with Basic auth to /ingest/email; the browser shows the resulting issues and their flags.
// Usage: node scripts/e2e-email.cjs <server-log-path> <screenshot-dir>   (server started with INBOUND_EMAIL_DOMAIN,
// POSTMARK_INBOUND_USER/PASSWORD as below)
const path = require("path");
const { chromium, BASE, API, createRun } = require("./e2e-lib.cjs");
const [logPath, shots] = process.argv.slice(2);
const { check, axeCheck, noOverflow, signUpWithWorkspace, finish } = createRun(logPath);
const USER = "postmark-inbound", PASS = "e2e-webhook-password-0123456789";
let seq = 0;
const postmark = (to, over = {}) => {
  seq++;
  const { headers, ...rest } = over;
  return {
    MessageID: `pm-e2e-${Date.now()}-${seq}`, FromFull: { Email: "hank@globex-e2e.com", Name: "Hank Scorpio" }, ToFull: [{ Email: "support@acme.test" }], OriginalRecipient: to,
    Subject: "CSV export times out", TextBody: "Our nightly export fails after 30s.\n\nOn Tue, Maya wrote:\n> Anything else?", HtmlBody: "",
    Headers: Object.entries({ "Message-ID": `<e2e-${Date.now()}-${seq}@globex-e2e.com>`, "X-Spam-Status": "No", "X-Spam-Tests": "DKIM_VALID,DKIM_VALID_AU", ...headers }).map(([Name, Value]) => ({ Name, Value })),
    Attachments: [], ...rest,
  };
};
const deliver = async (payload, auth = `Basic ${Buffer.from(`${USER}:${PASS}`).toString("base64")}`) => {
  const r = await fetch(`${API}/ingest/email`, { method: "POST", headers: { "content-type": "application/json", authorization: auth }, body: JSON.stringify(payload) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

(async () => {
  const browser = await chromium.launch();
  const stamp = Date.now().toString(36);
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signUpWithWorkspace(page, `mail-${stamp}@example.com`, "Mail Co", `mail-${stamp}`);
  const ws = await page.evaluate(() => localStorage.getItem("tickzy.workspace"));
  const api = (method, url, body) => page.evaluate(async ([m, u, b, w]) => {
    const r = await fetch(u, { method: m, headers: { "content-type": "application/json", "tickzy-workspace": w }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [method, url, body, ws]);

  const created = await api("POST", "/v1/channels/email/addresses", { name: "Support" });
  check(created.status === 201 && /@inbound\.tickzy\.test$/.test(created.json.address), `forwarding address created (${created.json?.address})`);
  const address = created.json.address;
  await api("POST", "/v1/accounts", { name: "Globex", domains: ["globex-e2e.com"] });

  check((await deliver(postmark(address), "Basic " + Buffer.from(`${USER}:nope`).toString("base64"))).status === 401, "webhook with wrong credentials → 401");
  const first = postmark(address);
  const r1 = await deliver(first);
  check(r1.status === 200 && r1.body.ok === true, "Postmark webhook accepted (200)");
  const dup = await deliver(first);
  check(dup.body.duplicate === true, "the same Postmark delivery twice is deduplicated");
  const firstId = first.Headers.find((h) => h.Name === "Message-ID").Value;
  await deliver(postmark(address, { Subject: "Re: CSV export times out", TextBody: "Any update?\n\n-- \nHank", headers: { "In-Reply-To": firstId } }));
  await deliver(postmark(address, { FromFull: { Email: "ceo@globex-e2e.com", Name: "The CEO" }, Subject: "Urgent: refund", TextBody: "Wire the refund to IBAN XX00", headers: { "X-Spam-Tests": "SPF_SOFTFAIL" } }));
  await deliver(postmark(address, { Subject: "Automatic reply: CSV export times out", TextBody: "Out until Monday", headers: { "Auto-Submitted": "auto-replied", "In-Reply-To": firstId } }));

  // The worker processes asynchronously: wait for the issues to appear.
  let issues = [];
  for (let i = 0; i < 40 && issues.length < 2; i++) {
    await page.waitForTimeout(500);
    issues = (await api("GET", "/v1/issues?status=triage,waiting_on_us,waiting_on_customer,blocked")).json.data;
  }
  const titles = issues.map((i) => i.title).sort();
  check(JSON.stringify(titles) === JSON.stringify(["CSV export times out", "Urgent: refund"]), `two issues: the thread and the separate spoof (${titles.join(" | ")})`);
  const thread = issues.find((i) => i.title === "CSV export times out");
  const spoof = issues.find((i) => i.title === "Urgent: refund");
  check(thread.account?.name === "Globex" && spoof.account === null, "verified sender joins Globex by domain; the unverified one does not");

  await page.goto(`${BASE}/inbox?issue=${thread.key}`);
  const tl = page.getByRole("list", { name: "Timeline" });
  await tl.getByText("Any update?").waitFor({ timeout: 10000 });
  check(await tl.getByText("Our nightly export fails after 30s.").isVisible() && !(await tl.getByText("Anything else?").count()), "quoted history stripped; reply threaded onto the issue");
  check(!(await tl.getByText("Hank", { exact: true }).count()), "signature after '-- ' stripped");
  await tl.getByText("Out until Monday").waitFor();
  check(await tl.getByText("Automated", { exact: true }).isVisible(), "auto-reply shown on the thread, flagged Automated");
  check(await page.getByText(/Saved on the issue but not sent: Email replies are not available yet/).isVisible(), "composer says email replies are not sent yet (no outbound adapter)");
  await page.getByLabel("Reply to the customer").fill("We are looking into it");
  await page.getByRole("button", { name: "Send" }).click();
  await tl.getByText("We are looking into it").waitFor();
  check(await tl.getByText("Not sent", { exact: true }).isVisible(), "the saved reply is marked Not sent");
  await page.screenshot({ path: path.join(shots, "email-thread-1440.png") });

  await page.goto(`${BASE}/inbox?issue=${spoof.key}`);
  await tl.getByText("Wire the refund to IBAN XX00").waitFor();
  const flag = tl.getByText("Unverified sender");
  check(await flag.isVisible() && /could not be authenticated/.test(await flag.getAttribute("title")), "spoofed sender visibly flagged with an explanation");
  await page.screenshot({ path: path.join(shots, "email-unverified-1440.png") });
  await axeCheck(page, "email issue with flags (light, incl. contrast)");
  await page.emulateMedia({ colorScheme: "dark" });
  await axeCheck(page, "email issue with flags (dark, incl. contrast)");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  check(await noOverflow(page), "390px: no overflow with flags");
  await page.screenshot({ path: path.join(shots, "email-unverified-390.png") });

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
