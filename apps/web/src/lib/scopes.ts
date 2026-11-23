import type { TokenScope } from "@tickzy/shared/permissions";

/** Labels for the grantable API token scopes (ADR-022). A test checks they cover exactly TOKEN_SCOPES. */
export const SCOPE_GROUPS: { label: string; scopes: { id: TokenScope; label: string }[] }[] = [
  {
    label: "Support data",
    scopes: [
      { id: "issues:read", label: "Read issues" },
      { id: "issues:write", label: "Create and update issues" },
      { id: "issues:reply", label: "Reply to customers" },
      { id: "issues:note", label: "Add internal notes" },
      { id: "accounts:write", label: "Create and update accounts and contacts" },
      { id: "knowledge:manage", label: "Manage knowledge sources" },
    ],
  },
  {
    label: "Administration",
    scopes: [
      { id: "workspace:manage", label: "Update workspace settings" },
      { id: "members:manage", label: "Manage members and invitations" },
      { id: "settings:manage", label: "Manage settings" },
      { id: "channels:manage", label: "Manage channels" },
      { id: "ai:manage", label: "Manage AI settings" },
      { id: "audit:read", label: "Read the audit log" },
    ],
  },
];
export const ALL_SCOPES = SCOPE_GROUPS.flatMap((g) => g.scopes.map((s) => s.id));
export const scopeLabel = (id: string) => SCOPE_GROUPS.flatMap((g) => g.scopes).find((s) => s.id === id)?.label ?? id;
