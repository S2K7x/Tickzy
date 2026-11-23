import { AppError, type ErrorDetail } from "@tickzy/shared";

/** A custom field definition as stored in custom_field_defs (T-201). */
export interface FieldDef {
  key: string;
  type: "text" | "number" | "boolean" | "date" | "select" | "multi_select" | "url";
  options: { id: string; label: string }[];
  required: boolean;
  archivedAt: Date | null;
}

/**
 * Validates custom field values against the workspace's definitions (FR-3.3, FR-4.1). Unknown or archived keys are
 * rejected; `null` clears a value; required fields must be present in the merged result (so a create must supply
 * them and an update cannot clear them). Returns the merged value object.
 */
export function validateCustom(defs: FieldDef[], current: Record<string, unknown>, input: Record<string, unknown> | undefined): Record<string, unknown> {
  const active = new Map(defs.filter((d) => !d.archivedAt).map((d) => [d.key, d]));
  const issues: ErrorDetail[] = [];
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(input ?? {})) {
    const def = active.get(key);
    if (!def) { issues.push({ path: `custom.${key}`, issue: "unknown field" }); continue; }
    if (value === null) { delete merged[key]; continue; }
    const problem = checkValue(def, value);
    if (problem) issues.push({ path: `custom.${key}`, issue: problem });
    else merged[key] = value;
  }
  for (const def of active.values()) {
    if (def.required && (merged[def.key] === undefined || merged[def.key] === "")) issues.push({ path: `custom.${def.key}`, issue: "required" });
  }
  if (issues.length) throw new AppError("validation_failed", "Invalid custom fields", issues);
  return merged;
}

function checkValue(def: FieldDef, v: unknown): string | null {
  const ids = new Set(def.options.map((o) => o.id));
  switch (def.type) {
    case "text": return typeof v === "string" && v.length <= 2000 ? null : "expected text (≤2000 chars)";
    case "number": return typeof v === "number" && Number.isFinite(v) ? null : "expected a number";
    case "boolean": return typeof v === "boolean" ? null : "expected true or false";
    case "date": return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? null : "expected a date (YYYY-MM-DD)";
    case "url": {
      if (typeof v !== "string" || v.length > 2000) return "expected a URL";
      try { const u = new URL(v); return u.protocol === "https:" || u.protocol === "http:" ? null : "expected an http(s) URL"; } catch { return "expected a URL"; }
    }
    case "select": return typeof v === "string" && ids.has(v) ? null : "expected one of the field's options";
    case "multi_select": return Array.isArray(v) && v.every((x) => typeof x === "string" && ids.has(x)) && new Set(v).size === v.length ? null : "expected distinct options of the field";
  }
}
