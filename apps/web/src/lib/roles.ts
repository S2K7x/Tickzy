import type { Role } from "./api.ts";

/** Role labels and descriptions (FR-1.3, pricing: collaborators and viewers are free seats). */
export const ROLE_INFO: Record<Role, { label: string; description: string; free: boolean }> = {
  admin: { label: "Admin", description: "Everything, including members, channels, settings and billing.", free: false },
  agent: { label: "Agent", description: "Works issues: replies, assigns, uses AI drafts.", free: false },
  collaborator: { label: "Collaborator", description: "Reads issues and leaves internal notes.", free: true },
  viewer: { label: "Viewer", description: "Read-only access.", free: true },
};
export const ROLE_ORDER: Role[] = ["admin", "agent", "collaborator", "viewer"];
