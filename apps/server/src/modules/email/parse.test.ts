import { describe, expect, it } from "vitest";
import { cleanSubject, htmlToText, inboundRecipient, normalizeEmail, stripQuotedText, withoutAttachmentContent, type PostmarkInbound } from "./parse.ts";

/**
 * Fixture corpus (T-302a): Postmark-shaped payloads modelled on how real clients format replies — Gmail, Outlook
 * desktop/web, Apple Mail, Thunderbird, mobile apps; English, French, German, Spanish — plus auto-replies, bounces,
 * bulk mail, spoofing signals, reply tokens and forwards. Synthetic but faithful to those formats (no customer mail).
 */
const DOMAIN = "inbound.tickzy.test";
const mail = (over: Partial<PostmarkInbound> & { headers?: Record<string, string> } = {}): PostmarkInbound => {
  const { headers, ...rest } = over;
  return {
    MessageID: "6a1f2c3d-0000-4000-8000-000000000001",
    FromFull: { Email: "Hank@Globex.com", Name: "Hank Scorpio", MailboxHash: "" },
    ToFull: [{ Email: `acme-x7k2qp@${DOMAIN}`, Name: "", MailboxHash: "" }],
    OriginalRecipient: `acme-x7k2qp@${DOMAIN}`,
    Subject: "Export fails",
    TextBody: "Hello",
    HtmlBody: "",
    Headers: Object.entries({ "Message-ID": "<CAB123@mail.gmail.com>", "X-Spam-Status": "No", "X-Spam-Tests": "DKIM_SIGNED,DKIM_VALID,DKIM_VALID_AU,SPF_PASS", ...headers }).map(([Name, Value]) => ({ Name, Value })),
    Attachments: [],
    ...rest,
  };
};

const REPLIES: [string, string, string][] = [
  ["Gmail reply", "Thanks, that worked!\n\nOn Tue, 24 Nov 2026 at 10:02, Maya Chen <maya@acme.test> wrote:\n> Could you try again?\n> Maya", "Thanks, that worked!"],
  ["Gmail reply with the attribution wrapped over two lines", "Still failing for us.\n\nOn Tue, 24 Nov 2026 at 10:02, Maya Chen <maya@\nacme.test> wrote:\n> Could you try again?", "Still failing for us."],
  ["Outlook desktop (underscore separator + header block)", "Hi,\n\nStill broken on our side.\n\nBest\nJohn\n\n________________________________\nFrom: Acme Support <support@acme.test>\nSent: Tuesday, November 24, 2026 10:02 AM\nTo: John <john@globex.com>\nSubject: RE: Export fails\n\nCould you try again?", "Hi,\n\nStill broken on our side.\n\nBest\nJohn"],
  ["Outlook web (header block without separator)", "Here is the log you asked for.\n\nFrom: Acme Support <support@acme.test>\nSent: 24 November 2026 10:02\nTo: John\nSubject: Export fails\n\nPlease send the log.", "Here is the log you asked for."],
  ["Outlook classic 'Original Message' separator", "Thanks.\n\n-----Original Message-----\nFrom: Acme Support\nSent: Tuesday\n\nDone.", "Thanks."],
  ["Apple Mail on iPhone (mobile signature + quoted reply)", "Works now.\n\nSent from my iPhone\n\n> On 24 Nov 2026, at 10:02, Maya Chen <maya@acme.test> wrote:\n> \n> Please retry.", "Works now."],
  ["Thunderbird", "Yes please, go ahead.\n\nOn 24/11/2026 10:02, Maya Chen wrote:\n> Shall we reset the token?", "Yes please, go ahead."],
  ["French Gmail", "Merci beaucoup !\n\nLe mar. 24 nov. 2026 à 10:02, Maya Chen <maya@acme.test> a écrit :\n> Pouvez-vous réessayer ?", "Merci beaucoup !"],
  ["German Outlook", "Danke, jetzt geht es.\n\nVon: Acme Support <support@acme.test>\nGesendet: Dienstag, 24. November 2026 10:02\nAn: Hank\nBetreff: Export", "Danke, jetzt geht es."],
  ["German Gmail", "Leider nicht.\n\nAm Di., 24. Nov. 2026 um 10:02 Uhr schrieb Maya Chen <maya@acme.test>:\n> Geht es jetzt?", "Leider nicht."],
  ["Spanish Gmail", "Sigue sin funcionar.\n\nEl mar, 24 nov 2026 a las 10:02, Maya Chen (<maya@acme.test>) escribió:\n> ¿Puede probar de nuevo?", "Sigue sin funcionar."],
  ["Signature delimiter", "The export finished, thanks.\n\n-- \nJohn Doe\nCTO, Globex", "The export finished, thanks."],
  ["Outlook mobile signature", "On my way to fix it.\n\nGet Outlook for iOS", "On my way to fix it."],
  ["Forwarded message is kept", "FYI, see below.\n\n---------- Forwarded message ---------\nFrom: Customer <c@initech.com>\nDate: Tue, 24 Nov 2026\nSubject: Broken\nTo: john@globex.com\n\nOur dashboard is down.", "FYI, see below.\n\n---------- Forwarded message ---------\nFrom: Customer <c@initech.com>\nDate: Tue, 24 Nov 2026\nSubject: Broken\nTo: john@globex.com\n\nOur dashboard is down."],
  ["Quote-only (bottom-posted / nothing new) keeps the text", "> Could you try again?\n> Maya", "> Could you try again?\n> Maya"],
  ["Inline replies below a quote are kept", "> Did you clear the cache?\nYes, twice.\n> And restart?\nAlso yes.", "> Did you clear the cache?\nYes, twice.\n> And restart?\nAlso yes."],
];

describe("quoted text stripping (corpus)", () => {
  it.each(REPLIES)("%s", (_name, input, expected) => {
    expect(stripQuotedText(input)).toBe(expected);
  });
});

describe("HTML-only mail → text", () => {
  it("Gmail HTML: drops the gmail_quote history and decodes entities", () => {
    const html = `<div dir="ltr">It&#39;s fixed &amp; working<br>Thanks!</div><br><div class="gmail_quote"><div class="gmail_attr">On Tue, Maya wrote:</div><blockquote class="gmail_quote">Retry?</blockquote></div>`;
    expect(htmlToText(html)).toBe("It's fixed & working\nThanks!");
  });
  it("Outlook HTML: drops the divRplyFwdMsg history, styles and scripts never leak as text", () => {
    const html = `<html><head><style>p{color:red}</style></head><body><p>Please call me.</p><script>alert(1)</script><div id="divRplyFwdMsg"><b>From:</b> Support</div><p>old</p></body></html>`;
    expect(htmlToText(html)).toBe("Please call me.");
  });
  it("is used when the text part is empty", () => {
    expect(normalizeEmail(mail({ TextBody: "", HtmlBody: "<p>Only HTML here</p>" })).body).toBe("Only HTML here");
  });
});

describe("automated mail (never reopens issues)", () => {
  it.each([
    ["out-of-office (Auto-Submitted)", mail({ Subject: "Automatic reply: Export fails", headers: { "Auto-Submitted": "auto-replied" } }), "Auto-Submitted: auto-replied"],
    ["out-of-office (subject only)", mail({ Subject: "Out of Office: back Monday" }), "auto-reply subject"],
    ["bounce from mailer-daemon", mail({ FromFull: { Email: "MAILER-DAEMON@mx.globex.com", Name: "Mail Delivery System" }, Subject: "Undelivered Mail Returned to Sender", headers: { "Content-Type": "multipart/report; report-type=delivery-status" } }), "delivery report"],
    ["newsletter", mail({ FromFull: { Email: "news@vendor.com" }, headers: { "List-Unsubscribe": "<mailto:u@vendor.com>", Precedence: "bulk" } }), "Precedence: bulk"],
    ["no-reply notification", mail({ FromFull: { Email: "no-reply@billing.vendor.com" } }), "no-reply sender"],
    ["X-Autoreply", mail({ headers: { "X-Autoreply": "yes" } }), "auto-reply header"],
  ])("%s", (_n, payload, reason) => {
    expect(normalizeEmail(payload).automated).toBe(reason);
  });
  it("a person's normal reply is not automated (Auto-Submitted: no)", () => {
    expect(normalizeEmail(mail({ headers: { "Auto-Submitted": "no" } })).automated).toBeNull();
  });
});

describe("sender authenticity (threat model TM-6)", () => {
  it("verified only with an aligned DKIM signature (DKIM_VALID_AU)", () => {
    expect(normalizeEmail(mail()).verified).toBe(true);
    expect(normalizeEmail(mail({ headers: { "X-Spam-Tests": "SPF_PASS,DKIM_SIGNED,DKIM_VALID" } })).verified).toBe(false); // signed by another domain
    expect(normalizeEmail(mail({ headers: { "X-Spam-Tests": "" } })).verified).toBe(false);
    const noScan = mail();
    noScan.Headers = noScan.Headers!.filter((x) => !/^x-spam/i.test(x.Name!));
    expect(normalizeEmail(noScan).verified).toBe(false); // scan failed or missing → not verified
  });
  it("flags likely spam", () => {
    expect(normalizeEmail(mail({ headers: { "X-Spam-Status": "Yes, score=7.1" } })).spam).toBe(true);
    expect(normalizeEmail(mail()).spam).toBe(false);
  });
});

describe("addressing and threading", () => {
  it("routes by the address on our domain — also when forwarded from the customer's own support address", () => {
    expect(inboundRecipient(mail(), DOMAIN)).toEqual({ address: `acme-x7k2qp@${DOMAIN}`, token: null });
    const forwarded = mail({ ToFull: [{ Email: "support@globex.com" }], OriginalRecipient: `ACME-X7K2QP@${DOMAIN.toUpperCase()}` });
    expect(inboundRecipient(forwarded, DOMAIN)).toEqual({ address: `acme-x7k2qp@${DOMAIN}`, token: null });
    expect(inboundRecipient(mail({ OriginalRecipient: "someone@else.com", ToFull: [{ Email: "x@else.com" }], CcFull: [{ Email: `team-abc@${DOMAIN}` }] }), DOMAIN)?.address).toBe(`team-abc@${DOMAIN}`);
    expect(inboundRecipient(mail({ OriginalRecipient: "a@b.com", ToFull: [{ Email: "c@d.com" }] }), DOMAIN)).toBeNull();
  });
  it("reads the reply token from plus-addressing; malformed tokens are ignored", () => {
    const token = "abcdefghijklmnopqrstuvwxyz234567";
    expect(inboundRecipient(mail({ OriginalRecipient: `acme-x7k2qp+${token}@${DOMAIN}` }), DOMAIN)).toEqual({ address: `acme-x7k2qp@${DOMAIN}`, token });
    expect(inboundRecipient(mail({ OriginalRecipient: `acme-x7k2qp+short@${DOMAIN}` }), DOMAIN)!.token).toBeNull();
  });
  it("uses the RFC Message-ID; In-Reply-To first, then References newest first", () => {
    const n = normalizeEmail(mail({ headers: { "Message-ID": "<new@globex.com>", "In-Reply-To": "<b@acme.test>", References: "<a@acme.test> <b@acme.test>" } }));
    expect(n.messageId).toBe("<new@globex.com>");
    expect(n.replyTo).toEqual(["<b@acme.test>", "<a@acme.test>"]);
  });
  it("falls back to Postmark's id when the Message-ID header is missing", () => {
    const p = mail();
    p.Headers = p.Headers!.filter((x) => x.Name !== "Message-ID");
    expect(normalizeEmail(p).messageId).toBe("<postmark-6a1f2c3d-0000-4000-8000-000000000001@inbound>");
  });
  it.each([["RE: AW: Fwd: Invoice", "Invoice"], ["Re[2]: SSO", "SSO"], ["  Export   fails ", "Export fails"], ["Fwd:", ""]])("subject %j → %j", (s, want) => {
    expect(cleanSubject(s)).toBe(want);
  });
});

describe("normalisation details", () => {
  it("lower-cases the sender, keeps the name, ignores Reply-To for identity", () => {
    expect(normalizeEmail(mail()).from).toEqual({ email: "hank@globex.com", name: "Hank Scorpio" });
    expect(normalizeEmail(mail({ FromFull: { Email: "not an address" } })).from).toBeNull();
  });
  it("keeps attachment metadata, never the bytes, in what is stored", () => {
    const p = mail({ Attachments: [{ Name: "log.txt", Content: "aGVsbG8=", ContentType: "text/plain", ContentLength: 5, ContentID: "" }, { Name: "logo.png", Content: "iVBOR", ContentType: "image/png", ContentLength: 4, ContentID: "logo@x" }] });
    expect(normalizeEmail(p).attachments).toEqual([{ name: "log.txt", type: "text/plain", size: 5, inline: false }, { name: "logo.png", type: "image/png", size: 4, inline: true }]);
    expect(JSON.stringify(withoutAttachmentContent(p))).not.toContain("aGVsbG8=");
  });
  it("truncates enormous bodies with a visible note", () => {
    const body = normalizeEmail(mail({ TextBody: "x".repeat(120_000) })).body;
    expect(body.length).toBeLessThan(100_200);
    expect(body).toMatch(/\[Message truncated/);
  });
});

describe("adversarial input stays fast (DoS; found while triaging SAST warnings — before the fix a 200 KB crafted HTML took 13.7 s)", () => {
  const fast = (f: () => unknown) => { const t0 = Date.now(); f(); return Date.now() - t0; };
  it.each([
    ["unclosed <style> blocks", () => htmlToText("<style".repeat(40_000))],
    ["'<' without '>'", () => htmlToText("<".repeat(200_000))],
    ["<div without closing '>'", () => htmlToText("<div ".repeat(40_000))],
    ["entity-like runs", () => htmlToText(("&" + "a".repeat(50)).repeat(4000))],
    ["48 MB of HTML (capped)", () => htmlToText("<p>x</p>".repeat(6_000_000))],
    ["quoted lines then one unquoted line", () => stripQuotedText("> q\n".repeat(40_000) + "x")],
    ["subject with long whitespace", () => cleanSubject(`re${" ".repeat(200_000)}x`)],
    ["everything huge at once", () => normalizeEmail(mail({ FromFull: { Email: `${"a".repeat(1_000_000)}@x.com` }, Subject: "Re:".repeat(100_000), TextBody: "", HtmlBody: "<".repeat(5_000_000) }))],
  ])("%s", (_name, f) => {
    expect(fast(f)).toBeLessThan(1000);
  });
});
