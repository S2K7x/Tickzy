/**
 * Pure email normalisation for Postmark inbound payloads (T-302a, ADR-033). No I/O: everything here is covered by
 * the fixture corpus in `fixtures/`. Facts about the payload come from Postmark's inbound documentation:
 * `MessageID` is Postmark's own id; the RFC Message-ID / In-Reply-To / References are entries of `Headers`;
 * `MailboxHash` is the plus-address part; sender authentication is only available as SpamAssassin headers
 * (`X-Spam-Tests`, `X-Spam-Status`) and `Received-SPF` — Postmark does not report DMARC.
 */

export interface PostmarkAddress { Email?: string; Name?: string; MailboxHash?: string }
export interface PostmarkAttachment { Name?: string; Content?: string; ContentType?: string; ContentLength?: number; ContentID?: string }
export interface PostmarkInbound {
  MessageID?: string;
  From?: string;
  FromFull?: PostmarkAddress;
  ToFull?: PostmarkAddress[];
  CcFull?: PostmarkAddress[];
  BccFull?: PostmarkAddress[];
  OriginalRecipient?: string;
  Subject?: string;
  Date?: string;
  MailboxHash?: string;
  TextBody?: string;
  HtmlBody?: string;
  StrippedTextReply?: string;
  Headers?: { Name?: string; Value?: string }[];
  Attachments?: PostmarkAttachment[];
}

export const MAX_BODY_CHARS = 100_000;

/** Case-insensitive header lookup (first occurrence). */
export function headerMap(p: PostmarkInbound): Map<string, string> {
  const m = new Map<string, string>();
  for (const h of p.Headers ?? []) {
    const name = (h.Name ?? "").toLowerCase();
    if (name && !m.has(name)) m.set(name, h.Value ?? "");
  }
  return m;
}

/** `<a@b>` ids found in a header value (In-Reply-To / References), in order, deduplicated. */
export function messageIds(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.match(/<[^<>\s]{1,300}>/g) ?? [])];
}

/** The address on our inbound domain this message was delivered to, split into base address and plus-token. */
export function inboundRecipient(p: PostmarkInbound, inboundDomain: string): { address: string; token: string | null } | null {
  const domain = inboundDomain.toLowerCase();
  const candidates = [p.OriginalRecipient, ...(p.ToFull ?? []).map((a) => a.Email), ...(p.CcFull ?? []).map((a) => a.Email), ...(p.BccFull ?? []).map((a) => a.Email)];
  for (const raw of candidates) {
    const addr = (raw ?? "").trim().toLowerCase();
    const at = addr.lastIndexOf("@");
    if (at < 1 || addr.slice(at + 1) !== domain) continue;
    const local = addr.slice(0, at);
    const plus = local.indexOf("+");
    const base = plus >= 0 ? local.slice(0, plus) : local;
    const token = plus >= 0 ? local.slice(plus + 1) : "";
    if (!base) continue;
    return { address: `${base}@${domain}`, token: /^[a-z2-7]{26,64}$/.test(token) ? token : null };
  }
  return null;
}

/** "Re: Fwd: AW: Invoice" → "Invoice". */
export function cleanSubject(subject: string | undefined): string {
  let s = (subject ?? "").slice(0, 2000).replace(/\s+/g, " ").trim();
  for (let i = 0; i < 5; i++) {
    // Whitespace is already collapsed to single spaces, so " ?" cannot backtrack; input capped at 2000 chars;
    // covered by the adversarial-input timing test.
    // eslint-disable-next-line security/detect-unsafe-regex
    const next = s.replace(/^(re|fw|fwd|aw|wg|sv|vs|tr|rif|r) ?(?:\[\d{1,5}\] ?)?: ?/i, "");
    if (next === s) break;
    s = next;
  }
  return s.slice(0, 300);
}

/**
 * Mail no person is waiting on: auto-replies, bounces, bulk/list mail, no-reply senders. Stored on an existing
 * thread but never opens an issue, reopens one or changes its status (FR-2.7; loop guard, threat model §6.3).
 */
export function automatedReason(p: PostmarkInbound, h: Map<string, string>): string | null {
  const autoSubmitted = (h.get("auto-submitted") ?? "").trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return `Auto-Submitted: ${autoSubmitted}`;
  if (h.has("x-autoreply") || h.has("x-autorespond")) return "auto-reply header";
  const precedence = (h.get("precedence") ?? h.get("x-precedence") ?? "").trim().toLowerCase();
  if (["bulk", "junk", "list", "auto_reply"].includes(precedence)) return `Precedence: ${precedence}`;
  if (h.has("list-id") || h.has("list-unsubscribe")) return "mailing list";
  if (/^multipart\/report/i.test(h.get("content-type") ?? "")) return "delivery report";
  const from = (p.FromFull?.Email ?? p.From ?? "").slice(0, 320).toLowerCase();
  const local = from.slice(0, Math.max(0, from.lastIndexOf("@")));
  if (/^(mailer-daemon|postmaster)$/.test(local)) return "bounce sender";
  if (/^(no-?reply|do-?not-?reply|donotreply)$/.test(local.split(/[+._]/)[0] ?? "")) return "no-reply sender";
  const subject = (p.Subject ?? "").trim();
  if (/^(automatic reply|auto(matic)?[- ]?reply|out of (the )?office|abwesenheitsnotiz|réponse automatique|undeliverable|undelivered mail|delivery status notification|mail delivery (failed|subsystem)|returned mail)\b/i.test(subject)) {
    return "auto-reply subject";
  }
  return null;
}

/**
 * Sender authenticity. Postmark reports no DMARC result; the closest signal is SpamAssassin's DKIM_VALID_AU — a
 * valid DKIM signature from the From (author) domain, i.e. DKIM alignment. Anything else, including a failed or
 * missing scan, is "not verified" (conservative: threat model TM-6).
 */
export function senderVerified(h: Map<string, string>): boolean {
  const tests = (h.get("x-spam-tests") ?? "").split(/[\s,]+/).map((x) => x.trim().toUpperCase());
  return tests.includes("DKIM_VALID_AU");
}

export function likelySpam(h: Map<string, string>): boolean {
  return /^\s*yes\b/i.test(h.get("x-spam-status") ?? "");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'" };

/** Input caps applied before any parsing: email bodies are attacker-controlled (threat model §6.3, DoS). */
export const MAX_HTML_CHARS = 500_000;
export const MAX_TEXT_CHARS = 300_000;

/** Removes `<tag …>…</tag>` blocks with indexOf scans (linear); an unclosed block removes the rest of the input. */
function removeBlocks(html: string, lower: string, tags: string[]): string {
  let out = "";
  let i = 0;
  for (;;) {
    let next = -1; let tag = "";
    for (const t of tags) {
      let at = lower.indexOf(`<${t}`, i);
      // Only a real tag name: "<style" must not match "<styles…".
      while (at >= 0 && /[a-z0-9]/.test(lower[at + t.length + 1] ?? " ")) at = lower.indexOf(`<${t}`, at + 1);
      if (at >= 0 && (next < 0 || at < next)) { next = at; tag = t; }
    }
    if (next < 0) return out + html.slice(i);
    out += html.slice(i, next);
    const close = lower.indexOf(`</${tag}`, next);
    if (close < 0) return out;
    const end = lower.indexOf(">", close);
    if (end < 0) return out;
    i = end + 1;
  }
}

/** Removes markup with a single pass (no regex backtracking on unbalanced "<"). */
function stripTags(html: string): string {
  let out = "";
  let inTag = false;
  for (let i = 0; i < html.length; i++) {
    const c = html[i]!;
    if (inTag) { if (c === ">") inTag = false; continue; }
    if (c === "<" && /[a-z/!]/i.test(html[i + 1] ?? "")) { inTag = true; continue; }
    out += c;
  }
  return out;
}

/** Where quoted history starts in common clients' HTML (Gmail, Apple Mail/Thunderbird, Outlook); -1 if none. */
function quoteStart(lower: string): number {
  const markers = ['class="gmail_quote', "class='gmail_quote", 'type="cite"', "type=cite", 'id="divrplyfwdmsg"', 'id="appendonsend"', 'id="stopspelling"'];
  let best = -1;
  for (const m of markers) {
    const at = lower.indexOf(m);
    if (at >= 0 && (best < 0 || at < best)) best = at;
  }
  return best < 0 ? -1 : lower.lastIndexOf("<", best);
}

/**
 * Plain text from HTML-only mail: drops head/style/script and quoted history, keeps line structure. Linear in the
 * input size (indexOf scans and one pass — no backtracking regexes on attacker-controlled HTML). Never rendered as HTML.
 */
export function htmlToText(input: string): string {
  let s = input.slice(0, MAX_HTML_CHARS);
  let lower = s.toLowerCase();
  const q = quoteStart(lower);
  if (q >= 0) { s = s.slice(0, q); lower = lower.slice(0, q); }
  s = removeBlocks(s, lower, ["head", "style", "script", "title"]);
  s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h[1-6]|table|blockquote)>/gi, "\n").replace(/<li\b[^<>]{0,500}>/gi, "• ");
  s = stripTags(s);
  s = s.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{1,32});/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
  return s.split("\n").map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Lines that start quoted history. Multilingual "On … wrote:" variants, Outlook separators and header blocks.
const WROTE = [
  /^on\b.{1,250}\bwrote:?\s*$/i,
  /^le\b.{1,250}\ba écrit\s*:?\s*$/i,
  /^am\b.{1,250}\bschrieb\b.{0,120}:?\s*$/i,
  /^el\b.{1,250}\bescribió:?\s*$/i,
  /^il giorno\b.{1,250}\bha scritto:?\s*$/i,
  /^op\b.{1,250}\bschreef\b.{0,120}:?\s*$/i,
  /^em\b.{1,250}\bescreveu:?\s*$/i,
];
const SEPARATORS = [/^-{2,}\s*original message\s*-{2,}/i, /^-{2,}\s*ursprüngliche nachricht\s*-{2,}/i, /^-{2,}\s*message d'origine\s*-{2,}/i, /^_{20,}\s*$/];
const FORWARD = /^(-{2,}\s*(forwarded message|weitergeleitete nachricht|message transféré)\s*-{2,}|begin forwarded message:)/i;
const HEADER_LINE = /^\*?(from|von|de|da|van)\s*:\*?\s+\S/i;
const SENT_LINE = /^\*?(sent|date|gesendet|envoyé|enviado|inviato|verzonden)\s*:\*?\s+\S/i;
const MOBILE_SIGNATURE = /^(sent from my (iphone|ipad|android|mobile|galaxy)|get outlook for (ios|android)|envoyé de mon iphone|von meinem iphone gesendet)\b/i;

/**
 * The new part of a reply: everything before the first quoted-history marker or signature delimiter. Forwarded
 * content is the message itself and is kept. If stripping would leave nothing (quote-only or bottom-posted mail),
 * the whole text is returned rather than an empty message.
 */
export function stripQuotedText(input: string): string {
  const text = input.slice(0, MAX_TEXT_CHARS);
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  // restQuoted[i]: every line from i on is blank or quoted — computed once from the end (linear, not per line).
  const restQuoted: boolean[] = new Array<boolean>(lines.length + 1);
  restQuoted[lines.length] = true;
  for (let k = lines.length - 1; k >= 0; k--) {
    const l = lines[k]!.trim();
    restQuoted[k] = restQuoted[k + 1]! && (l === "" || l.startsWith(">"));
  }
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (FORWARD.test(line)) break; // forwarded content below is the message: keep it (and stop looking)
    const joined = i + 1 < lines.length ? `${line} ${lines[i + 1]!.trim()}` : line; // "On … <a@b>\n wrote:"
    if (WROTE.some((r) => r.test(line)) || (/^(on|le|am|el|op|em)\b/i.test(line) && WROTE.some((r) => r.test(joined)))) { cut = i; break; }
    if (SEPARATORS.some((r) => r.test(line))) { cut = i; break; }
    if (HEADER_LINE.test(line) && lines.slice(i + 1, i + 5).some((l) => SENT_LINE.test(l.trim()))) { cut = i; break; }
    if (line === "--" && lines[i]!.startsWith("-- ")) { cut = i; break; } // RFC 3676 signature delimiter "-- "
    if (line.startsWith(">") && restQuoted[i]) { cut = i; break; }
  }
  let kept = lines.slice(0, cut);
  // Trailing mobile signatures.
  while (kept.length && (kept.at(-1)!.trim() === "" || MOBILE_SIGNATURE.test(kept.at(-1)!.trim()))) kept = kept.slice(0, -1);
  const result = kept.join("\n").trim();
  return result || text.trim();
}

export interface NormalizedEmail {
  /** RFC Message-ID (or a Postmark-id fallback): the message's dedupe key and future In-Reply-To target. */
  messageId: string;
  replyTo: string[];
  from: { email: string; name: string } | null;
  subject: string;
  body: string;
  automated: string | null;
  verified: boolean;
  spam: boolean;
  attachments: { name: string; type: string; size: number; inline: boolean }[];
}

export function normalizeEmail(p: PostmarkInbound): NormalizedEmail {
  const h = headerMap(p);
  const fromEmail = (p.FromFull?.Email ?? "").slice(0, 320).trim().toLowerCase();
  const own = messageIds(h.get("message-id"))[0];
  const text = (p.TextBody ?? "").trim() ? p.TextBody!.slice(0, MAX_TEXT_CHARS) : htmlToText(p.HtmlBody ?? "");
  let body = stripQuotedText(text);
  if (body.length > MAX_BODY_CHARS) body = `${body.slice(0, MAX_BODY_CHARS)}\n\n[Message truncated: it was longer than ${MAX_BODY_CHARS.toLocaleString("en")} characters.]`;
  return {
    messageId: own ?? `<postmark-${p.MessageID ?? "unknown"}@inbound>`,
    replyTo: [...messageIds(h.get("in-reply-to")), ...messageIds(h.get("references")).reverse()].filter((v, i, a) => a.indexOf(v) === i),
    from: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail) ? { email: fromEmail, name: (p.FromFull?.Name ?? "").trim().slice(0, 200) } : null,
    subject: cleanSubject(p.Subject),
    body,
    automated: automatedReason(p, h),
    verified: senderVerified(h),
    spam: likelySpam(h),
    attachments: (p.Attachments ?? []).map((a) => ({ name: (a.Name ?? "attachment").slice(0, 200), type: (a.ContentType ?? "application/octet-stream").slice(0, 100), size: a.ContentLength ?? 0, inline: !!a.ContentID })),
  };
}

/** What is kept in inbound_events: the payload minus attachment bytes (stored by T-302b, not in the database). */
export function withoutAttachmentContent(p: PostmarkInbound): PostmarkInbound {
  return { ...p, Attachments: (p.Attachments ?? []).map(({ Content: _content, ...meta }) => meta) };
}
