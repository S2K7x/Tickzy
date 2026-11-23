/** Permission names — docs/blueprint/api-spec.md §2. Shared by the server (enforcement) and web (token scope picker). */
export const PERMISSIONS = [
  "workspace:manage",
  "members:manage",
  "settings:manage",
  "channels:manage",
  "developers:manage",
  "ai:manage",
  "audit:read",
  "issues:read",
  "issues:write",
  "issues:reply",
  "issues:note",
  "accounts:write",
  "knowledge:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Scopes an API token may hold (ADR-022): every permission except minting tokens (no privilege escalation). */
export const TOKEN_SCOPES = PERMISSIONS.filter((p): p is Exclude<Permission, "developers:manage"> => p !== "developers:manage");
export type TokenScope = Exclude<Permission, "developers:manage">;
