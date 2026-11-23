import { Link } from "@tanstack/react-router";
import { NAV } from "../components/nav.ts";

/** Phone "More" tab: the destinations that don't fit in the bottom bar (ux-spec §1). */
export function More() {
  const items = NAV.filter((i) => !i.mobile);
  return (
    <section className="flex flex-col gap-4">
      <h1 className="m-0 text-2xl font-semibold tracking-tight">More</h1>
      <ul className="m-0 list-none overflow-hidden rounded-2xl border border-line bg-surface p-0">
        {items.map(({ to, label, icon: Icon }) => (
          <li key={to} className="border-b border-line last:border-b-0">
            <Link to={to} className="flex min-h-12 items-center gap-3 px-4 text-[15px] font-medium text-fg no-underline hover:bg-surface-2">
              <Icon size={18} />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
