import type { Priority, StatusCategory } from "@tickzy/shared/lifecycle";
import { CHANNEL_LABEL, PRIORITY_LABEL, STATUS_LABEL, type Issue } from "../lib/issues.ts";

/** Design-system pieces for issues (ux-spec §2.4: Priority dot, Status pill, Channel badge). */
const PRIORITY_COLOR: Record<Priority, string> = {
  urgent: "bg-danger", high: "bg-chart-1", normal: "bg-chart-5", low: "bg-chart-empty",
};
export function PriorityDot({ priority }: { priority: Priority }) {
  return <span role="img" aria-label={`${PRIORITY_LABEL[priority]} priority`} title={`${PRIORITY_LABEL[priority]} priority`} className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${PRIORITY_COLOR[priority]}`} />;
}

/** Outlined status pill (design v2): tone in text and border, no fill. */
const STATUS_TONE: Record<StatusCategory, string> = {
  triage: "border-info/40 text-info",
  waiting_on_us: "border-warn/40 text-warn",
  waiting_on_customer: "border-line text-muted",
  blocked: "border-danger/40 text-danger",
  resolved: "border-success/40 text-success",
  closed: "border-line text-muted",
  ignored: "border-line text-muted",
};
export function StatusChip({ status }: { status: Issue["status"] }) {
  return <span className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-px text-[11px] font-semibold ${STATUS_TONE[status.category]}`}>{status.name || STATUS_LABEL[status.category]}</span>;
}

/** Initials avatar (no photos are stored; never invent images). */
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const parts = name.trim().split(/[\s@._-]+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
  return (
    <span aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 font-semibold text-fg">
      {initials}
    </span>
  );
}

export function ChannelBadge({ channel }: { channel: Issue["channel"] }) {
  return <span className="inline-flex shrink-0 items-center rounded-md border border-line px-1.5 py-px text-[11px] font-medium text-muted">{CHANNEL_LABEL[channel]}</span>;
}
