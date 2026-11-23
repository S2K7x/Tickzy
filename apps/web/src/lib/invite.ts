/**
 * Pending invitation token (T-102). The emailed link carries the token in the URL fragment; we move it to
 * localStorage at once (dropping it from the address bar/history) so it survives the sign-in round trip,
 * which usually happens in a new tab opened from the magic-link email.
 */
const KEY = "tickzy.invite";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function captureInviteToken(): string | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  if (token) {
    history.replaceState(null, "", window.location.pathname);
    try {
      localStorage.setItem(KEY, JSON.stringify({ token, at: Date.now() }));
    } catch {
      return token;
    }
  }
  return token ?? pendingInviteToken();
}

export function pendingInviteToken(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { token, at } = JSON.parse(raw) as { token: string; at: number };
    if (typeof token !== "string" || Date.now() - at > MAX_AGE_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

export function clearInviteToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
}
