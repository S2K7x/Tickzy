import { Link, Outlet } from "@tanstack/react-router";

const SECTIONS = [
  { to: "/settings/members", label: "Members & roles" },
  { to: "/settings/api-tokens", label: "API tokens" },
] as const;

const LATER = [
  { label: "Channels", milestone: "M3" },
  { label: "Business hours & SLAs", milestone: "M4" },
  { label: "AI", milestone: "M5" },
];

/** Two-column settings (ux-spec §3 Settings): section nav, then the form. Stacks on phones. */
export function SettingsLayout() {
  return (
    <section className="flex flex-col gap-5">
      <h1 className="m-0 text-2xl font-semibold tracking-tight">Settings</h1>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <nav aria-label="Settings sections" className="flex shrink-0 flex-row flex-wrap gap-1 lg:w-56 lg:flex-col">
          {SECTIONS.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              className="rounded-[10px] px-3 py-2 text-sm font-medium text-muted no-underline hover:bg-surface-2"
              activeProps={{ className: "bg-accent-soft !text-accent-fg", "aria-current": "page" }}
            >
              {s.label}
            </Link>
          ))}
          <div className="mt-3 hidden flex-col gap-1 px-3 lg:flex">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Coming later</span>
            {LATER.map((l) => (
              <span key={l.label} className="text-[13px] text-muted">{l.label} · {l.milestone}</span>
            ))}
          </div>
        </nav>
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </section>
  );
}
