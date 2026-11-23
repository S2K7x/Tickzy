import { describe, expect, it } from "vitest";
import { applyMessage, canTransition, countsInMetrics, isOpen, notifies, onMessage, STATUS_CATEGORIES, timestampsForTransition, type IssueClock, type MessageKind, type StatusCategory } from "./lifecycle.ts";

// The FR-3.1 / FR-3.2 state-machine table. Every (category × message kind) pair is listed: adding a category or
// kind without deciding its behaviour fails this test.
const TABLE: Record<StatusCategory, Record<MessageKind, string>> = {
  triage:              { customer_public: "none",                 team_public: "→waiting_on_customer", team_internal: "none" },
  waiting_on_us:       { customer_public: "none",                 team_public: "→waiting_on_customer", team_internal: "none" },
  waiting_on_customer: { customer_public: "→waiting_on_us",       team_public: "none",                 team_internal: "none" },
  blocked:             { customer_public: "none",                 team_public: "none",                 team_internal: "none" },
  resolved:            { customer_public: "→waiting_on_us",       team_public: "none",                 team_internal: "none" },
  closed:              { customer_public: "new_issue",            team_public: "none",                 team_internal: "none" },
  ignored:             { customer_public: "none",                 team_public: "none",                 team_internal: "none" },
};
const KINDS: MessageKind[] = ["customer_public", "team_public", "team_internal"];
const render = (o: ReturnType<typeof onMessage>) => (o.action === "transition" ? `→${o.to}` : o.action);

describe("issue lifecycle state machine (FR-3.1, FR-3.2)", () => {
  it("covers every category", () => {
    expect(Object.keys(TABLE).sort()).toEqual([...STATUS_CATEGORIES].sort());
  });
  for (const c of STATUS_CATEGORIES) {
    for (const k of KINDS) {
      it(`${c} + ${k} → ${TABLE[c][k]}`, () => {
        const o = onMessage(c, k);
        expect(render(o)).toBe(TABLE[c][k]);
        expect(o.reason).toMatch(/^[a-z_]+$/); // every outcome is explained for the timeline (FR-3.2)
      });
    }
  }

  it("internal notes never change status", () => {
    for (const c of STATUS_CATEGORIES) expect(onMessage(c, "team_internal").action).toBe("none");
  });

  it("closed is terminal for manual changes; everything else may move anywhere", () => {
    for (const from of STATUS_CATEGORIES) {
      for (const to of STATUS_CATEGORIES) {
        expect(canTransition(from, to)).toBe(from !== to && from !== "closed");
      }
    }
  });

  it("ignored issues neither notify nor count; open means not resolved/closed/ignored", () => {
    expect(STATUS_CATEGORIES.filter((c) => !countsInMetrics(c))).toEqual(["ignored"]);
    expect(STATUS_CATEGORIES.filter((c) => !notifies(c))).toEqual(["ignored"]);
    expect(STATUS_CATEGORIES.filter(isOpen)).toEqual(["triage", "waiting_on_us", "waiting_on_customer", "blocked"]);
  });
});

describe("lifecycle timestamps", () => {
  const t0 = new Date("2026-11-20T10:00:00Z");
  const t1 = new Date("2026-11-20T11:00:00Z");
  const base: IssueClock = { status_category: "triage", first_response_at: null, resolved_at: null, closed_at: null, last_customer_message_at: null, last_team_message_at: null };

  it("first team reply sets first_response_at once and hands the turn to the customer", () => {
    const a = applyMessage(base, "team_public", t0);
    expect(a.patch).toEqual({ status_category: "waiting_on_customer", first_response_at: t0, last_team_message_at: t0 });
    const b = applyMessage({ ...base, ...a.patch, status_category: "waiting_on_us" }, "team_public", t1);
    expect(b.patch.first_response_at).toBeUndefined();
    expect(b.patch.last_team_message_at).toEqual(t1);
  });

  it("internal notes do not count as a first response", () => {
    expect(applyMessage(base, "team_internal", t0).patch).toEqual({});
  });

  it("a customer reply on a resolved issue reopens it and clears resolved_at", () => {
    const resolved = { ...base, status_category: "resolved" as const, resolved_at: t0 };
    const r = applyMessage(resolved, "customer_public", t1);
    expect(r.outcome).toEqual({ action: "transition", to: "waiting_on_us", reason: "reopened_by_customer" });
    expect(r.patch).toEqual({ status_category: "waiting_on_us", resolved_at: null, last_customer_message_at: t1 });
  });

  it("a customer message on a closed issue changes nothing on it (a new issue is opened instead)", () => {
    const r = applyMessage({ ...base, status_category: "closed", closed_at: t0 }, "customer_public", t1);
    expect(r).toEqual({ patch: {}, outcome: { action: "new_issue", reason: "closed_issue_followup" } });
  });

  it("resolving keeps the first resolution time; closing a resolved issue keeps resolved_at", () => {
    expect(timestampsForTransition(base, "resolved", t0)).toEqual({ status_category: "resolved", resolved_at: t0 });
    expect(timestampsForTransition({ ...base, status_category: "resolved", resolved_at: t0 }, "closed", t1)).toEqual({ status_category: "closed", closed_at: t1 });
  });
});
