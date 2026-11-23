import { describe, expect, it } from "vitest";
import { validateCustom, type FieldDef } from "./custom-fields.ts";

const def = (key: string, type: FieldDef["type"], extra: Partial<FieldDef> = {}): FieldDef => ({ key, type, options: [], required: false, archivedAt: null, ...extra });
const DEFS = [
  def("arr", "number", { required: true }),
  def("plan", "select", { options: [{ id: "free", label: "Free" }, { id: "pro", label: "Pro" }] }),
  def("regions", "multi_select", { options: [{ id: "eu", label: "EU" }, { id: "us", label: "US" }] }),
  def("renewal", "date"),
  def("crm", "url"),
  def("vip", "boolean"),
  def("note", "text"),
  def("legacy", "text", { archivedAt: new Date() }),
];
const issuesOf = (fn: () => unknown) => {
  try { fn(); return []; } catch (e) { return (e as { details: { path: string; issue: string }[] }).details.map((d) => `${d.path}: ${d.issue}`); }
};

describe("custom field validation", () => {
  it("accepts valid values of every type", () => {
    const v = { arr: 120000, plan: "pro", regions: ["eu", "us"], renewal: "2027-03-01", crm: "https://crm.example/acc/1", vip: true, note: "hi" };
    expect(validateCustom(DEFS, {}, v)).toEqual(v);
  });
  it("rejects unknown, archived and ill-typed values with a path per problem", () => {
    expect(issuesOf(() => validateCustom(DEFS, {}, { arr: "120k", plan: "enterprise", regions: ["eu", "eu"], renewal: "03/01/2027", crm: "javascript:alert(1)", vip: "yes", ghost: 1, legacy: "x" }))).toEqual([
      "custom.arr: expected a number", "custom.plan: expected one of the field's options", "custom.regions: expected distinct options of the field",
      "custom.renewal: expected a date (YYYY-MM-DD)", "custom.crm: expected an http(s) URL", "custom.vip: expected true or false",
      "custom.ghost: unknown field", "custom.legacy: unknown field", "custom.arr: required",
    ]);
  });
  it("enforces required fields on the merged result; null clears optional values", () => {
    expect(issuesOf(() => validateCustom(DEFS, {}, {}))).toEqual(["custom.arr: required"]);
    expect(validateCustom(DEFS, { arr: 1, plan: "free" }, { plan: null })).toEqual({ arr: 1 });
    expect(issuesOf(() => validateCustom(DEFS, { arr: 1 }, { arr: null }))).toEqual(["custom.arr: required"]);
  });
});
