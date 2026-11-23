import type { Priority, StatusCategory } from "@tickzy/shared/lifecycle";
import { PRIORITY_LABEL, STATUS_LABEL, type Issue } from "../lib/issues.ts";

/** Design-system pieces for issues (ux-spec §2.4: Priority dot, Status pill, Channel badge). */
const PRIORITY_COLOR: Record<Priority, string> = {
  urgent: "bg-danger", high: "bg-warn", normal: "bg-accent", low: "bg-line",
};
export function PriorityDot({ priority }: { priority: Priority }) {
  return <span role="img" aria-label={`${PRIORITY_LABEL[priority]} priority`} title={`${PRIORITY_LABEL[priority]} priority`} className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${PRIORITY_COLOR[priority]}`} />;
}

const STATUS_TONE: Record<StatusCategory, string> = {
  triage: "bg-accent-soft text-accent-fg",
  waiting_on_us: "bg-warn-soft text-warn",
  waiting_on_customer: "bg-surface-2 text-muted",
  blocked: "bg-danger-soft text-danger",
  resolved: "bg-success-soft text-success",
  closed: "bg-surface-2 text-muted",
  ignored: "bg-surface-2 text-muted",
};
export function StatusChip({ status }: { status: Issue["status"] }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status.category]}`}>{status.name || STATUS_LABEL[status.category]}</span>;
}

const CHANNEL_LABEL: Record<Issue["channel"], string> = { slack: "Slack", email: "Email", widget: "Chat", api: "API", ui: "Web" };
export function ChannelBadge({ channel }: { channel: Issue["channel"] }) {
  return <span className="inline-flex shrink-0 items-center rounded-md border border-line px-1.5 py-px text-[11px] font-medium text-muted">{CHANNEL_LABEL[channel]}</span>;
}
