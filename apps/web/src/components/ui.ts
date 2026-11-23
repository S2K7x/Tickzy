/**
 * Design system v2 primitives as class strings (ux-spec §2.4). One place for button/input/card/pill styling so
 * every screen stays consistent. Heights: sm 32, md 36/40, lg 44.
 */
export const btn = {
  primary: "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] bg-primary px-4 font-semibold text-primary-fg shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50",
  secondary: "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-line bg-surface px-4 font-semibold text-fg shadow-[0_1px_0_rgba(0,0,0,0.03)] hover:bg-surface-2 disabled:opacity-50",
  ghost: "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] px-3 font-medium text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50",
  sm: "h-8 text-[13px]",
  md: "h-9 text-[13px]",
  lg: "h-11 text-sm",
};
export const input = "h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-[14px] text-fg outline-none placeholder:text-muted focus:border-fg/40";
export const card = "rounded-2xl border border-line bg-surface";
/** Segmented control (tabs with counts), as in the reference "All 24 · New 6 …" bar. */
export const segmented = {
  bar: "inline-flex max-w-full gap-0.5 overflow-x-auto rounded-xl bg-surface-2 p-1",
  item: "inline-flex items-center gap-1.5 whitespace-nowrap rounded-[9px] px-2.5 py-1.5 text-[13px] font-medium text-muted no-underline hover:text-fg",
  active: "bg-surface text-fg shadow-sm",
  count: "text-[11px] font-medium text-muted",
};
