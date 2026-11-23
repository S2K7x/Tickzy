import type { Role } from "@tickzy/db";

import { PERMISSIONS, type Permission } from "@tickzy/shared/permissions";

export { PERMISSIONS, TOKEN_SCOPES, type Permission, type TokenScope } from "@tickzy/shared/permissions";

/** Role → permission matrix — docs/blueprint/api-spec.md §2. Single source of truth for role checks. */
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
  return ROLE_PERMISSIONS[role].has(permission);
}

