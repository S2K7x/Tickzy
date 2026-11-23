/**
 * Consumer / free email providers (FR-4.2). A domain on this list never identifies a customer account:
 * it cannot be attached to an account and is ignored by email-domain auto-mapping.
 */
export const PUBLIC_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk", "hotmail.fr", "live.com", "live.fr", "msn.com",
  "yahoo.com", "yahoo.co.uk", "yahoo.fr", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com",
  "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.de", "gmx.net", "web.de", "mail.com", "zoho.com", "fastmail.com",
  "hey.com", "yandex.com", "yandex.ru", "mail.ru", "qq.com", "163.com", "126.com", "naver.com",
  "orange.fr", "free.fr", "laposte.net", "sfr.fr", "wanadoo.fr", "libero.it", "t-online.de", "comcast.net", "att.net", "verizon.net",
]);

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function normalizeDomain(input: string): string | null {
  const d = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  return DOMAIN_RE.test(d) && d.length <= 253 ? d : null;
}

/** The domain of an email address, or null when it is malformed or a public provider. */
export function companyDomainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const domain = normalizeDomain(email.slice(at + 1));
  return domain && !PUBLIC_EMAIL_DOMAINS.has(domain) ? domain : null;
}
