import { describe, expect, it } from "vitest";
import { can, PERMISSIONS } from "./permissions.ts";

describe("permission matrix (api-spec §2)", () => {
  it("admins can do everything", () => {
    for (const p of PERMISSIONS) expect(can("admin", p)).toBe(true);
  });
  it("agents work issues but cannot manage the workspace", () => {
    expect(can("agent", "issues:write")).toBe(true);
    expect(can("agent", "issues:reply")).toBe(true);
    expect(can("agent", "accounts:write")).toBe(true);
    for (const p of ["workspace:manage", "members:manage", "settings:manage", "developers:manage", "audit:read"] as const) {
      expect(can("agent", p)).toBe(false);
    }
  });
  it("collaborators and viewers can read and leave internal notes only", () => {
    for (const role of ["collaborator", "viewer"] as const) {
      expect(PERMISSIONS.filter((p) => can(role, p))).toEqual(["issues:read", "issues:note"]);
    }
  });
});
