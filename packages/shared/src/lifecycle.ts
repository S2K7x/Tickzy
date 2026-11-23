/**
 * Issue lifecycle (FR-3.1, FR-3.2) as pure functions — the single source of truth for status rules.
 * The database stores the category; the service maps a category to the workspace's default status in it.
 */
export const STATUS_CATEGORIES = ["triage", "waiting_on_us", "waiting_on_customer", "blocked", "resolved", "closed", "ignored"] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

export const PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** A message's effect on the lifecycle: who wrote it and whether the customer can see it. */
export type MessageKind = "customer_public" | "team_public" | "team_internal";

export type LifecycleOutcome =
  | { action: "none"; reason: string }
  | { action: "transition"; to: StatusCategory; reason: string }
  | { action: "new_issue"; reason: string };

/**
 * What a new message does to an issue in `current`:
 *  - customer message: reopens resolved (→ waiting_on_us), hands the turn back to us from waiting_on_customer,
 *    starts a NEW issue when the old one is closed, and never wakes an ignored issue;
 *  - team public reply: hands the turn to the customer from triage / waiting_on_us;
 *  - internal notes never change status (and are never delivered to the customer).
 * `blocked` is only left manually or by an engineering-link event (not by conversation traffic).
 */
export function onMessage(current: StatusCategory, kind: MessageKind): LifecycleOutcome {
  if (kind === "team_internal") return { action: "none", reason: "internal_note" };
  if (kind === "customer_public") {
    switch (current) {
      case "waiting_on_customer": return { action: "transition", to: "waiting_on_us", reason: "customer_replied" };
      case "resolved": return { action: "transition", to: "waiting_on_us", reason: "reopened_by_customer" };
      case "closed": return { action: "new_issue", reason: "closed_issue_followup" };
      case "ignored": return { action: "none", reason: "ignored" };
      case "blocked": return { action: "none", reason: "blocked" };
      case "triage":
      case "waiting_on_us": return { action: "none", reason: "already_our_turn" };
    }
  }
  switch (current) {
    case "triage":
    case "waiting_on_us": return { action: "transition", to: "waiting_on_customer", reason: "team_replied" };
    case "waiting_on_customer": return { action: "none", reason: "already_customer_turn" };
    case "blocked":
    case "resolved":
    case "closed":
    case "ignored": return { action: "none", reason: `team_reply_while_${current}` };
  }
}

/** Manual status changes: anything goes except leaving `closed` (closed is terminal; follow-ups open a new issue). */
export function canTransition(from: StatusCategory, to: StatusCategory): boolean {
  return from !== to && from !== "closed";
}

/** Ignored issues never notify anyone and never count in metrics (FR-3.1). */
export const countsInMetrics = (c: StatusCategory): boolean => c !== "ignored";
export const notifies = (c: StatusCategory): boolean => c !== "ignored";
export const isOpen = (c: StatusCategory): boolean => c !== "resolved" && c !== "closed" && c !== "ignored";

export interface IssueClock {
  status_category: StatusCategory;
  first_response_at: Date | null;
  resolved_at: Date | null;
  closed_at: Date | null;
  last_customer_message_at: Date | null;
  last_team_message_at: Date | null;
}

/** Timestamp bookkeeping for a status change: resolved_at/closed_at follow the category. */
export function timestampsForTransition(issue: IssueClock, to: StatusCategory, now: Date): Partial<IssueClock> {
  const patch: Partial<IssueClock> = { status_category: to };
  if (to === "resolved") patch.resolved_at = issue.resolved_at ?? now;
  else if (issue.resolved_at && to !== "closed") patch.resolved_at = null;
  if (to === "closed") patch.closed_at = now;
  return patch;
}

/** Full effect of a message on an issue: status (via onMessage) plus response timestamps. */
export function applyMessage(issue: IssueClock, kind: MessageKind, now: Date): { patch: Partial<IssueClock>; outcome: LifecycleOutcome } {
  const outcome = onMessage(issue.status_category, kind);
  if (outcome.action === "new_issue") return { patch: {}, outcome };
  const patch: Partial<IssueClock> = outcome.action === "transition" ? timestampsForTransition(issue, outcome.to, now) : {};
  if (kind === "customer_public") patch.last_customer_message_at = now;
  if (kind === "team_public") {
    patch.last_team_message_at = now;
    if (!issue.first_response_at) patch.first_response_at = now;
  }
  return { patch, outcome };
}
