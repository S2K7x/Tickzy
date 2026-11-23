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

/** Workspace roles (same values as the database enum). */
export const ROLES = ["admin", "agent", "collaborator", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/** Role → permission matrix — docs/blueprint/api-spec.md §2. Single source of truth: the server enforces it, the web
 * only uses it to hide actions a role cannot take (the API still refuses them). */
const ADMIN_ONLY: Permission[] = [
  "workspace:manage",
  "members:manage",
  "settings:manage",
  "channels:manage",
  "developers:manage",
  "ai:manage",
  "audit:read",
];

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set(PERMISSIONS),
  agent: new Set(PERMISSIONS.filter((p) => !ADMIN_ONLY.includes(p))),
  collaborator: new Set<Permission>(["issues:read", "issues:note"]),
  viewer: new Set<Permission>(["issues:read", "issues:note"]),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}
