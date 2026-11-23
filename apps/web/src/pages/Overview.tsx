import { Link } from "@tanstack/react-router";

/** Overview for a new workspace: the onboarding checklist from ux-spec §3 S11 (metrics arrive in M4). */
const STEPS: { title: string; detail: string; milestone: string; to?: "/settings/members" }[] = [
  { title: "Connect Slack", detail: "Pick your customer channels and a triage channel.", milestone: "M3" },
  { title: "Connect email", detail: "Forward your support address to Tickzy.", milestone: "M3" },
  { title: "Invite your team", detail: "Agents are paid seats; collaborators are free.", milestone: "M1", to: "/settings/members" as const },
  { title: "Set business hours and SLAs", detail: "Start from a template and preview it on recent issues.", milestone: "M4" },
];

export function Overview() {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="m-0 text-sm text-muted">Set up your workspace. Metrics appear here once conversations start flowing.</p>
      </div>
      <ol className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3 rounded-2xl border border-line bg-surface p-5">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-sm font-bold text-accent-fg">{i + 1}</span>
            <div className="flex flex-col gap-1">
              <h2 className="m-0 text-[15px] font-semibold">{s.title}</h2>
              <p className="m-0 text-sm text-muted">{s.detail}</p>
              {s.to ? (
                <Link to={s.to} className="text-sm font-semibold text-accent-fg no-underline">Invite people →</Link>
              ) : (
                <span className="text-xs text-muted">Available in {s.milestone}</span>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
