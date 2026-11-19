/** Honest placeholder for screens whose milestone has not started (no fake data — see CURRENT-STATE.md). */
export function Placeholder({ title, milestone, description }: { title: string; milestone: string; description: string }) {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="m-0 text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="rounded-2xl border border-dashed border-line bg-surface p-8 text-center">
        <p className="m-0 text-[15px] font-semibold">Not built yet</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">{description}</p>
        <p className="mt-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted">Planned in {milestone}</p>
      </div>
    </section>
  );
}
