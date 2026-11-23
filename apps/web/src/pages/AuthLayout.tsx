import type { ReactNode } from "react";
import { Logo } from "../components/icons.tsx";

/** Centered card used by sign-in, link verification and onboarding (no app chrome). */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10 text-fg">
      <main className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center gap-2.5">
          <Logo size={34} />
          <span className="text-xl font-bold tracking-tight">Tickzy</span>
        </div>
        <section className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-6 sm:p-8">
          <div className="flex flex-col gap-1.5">
            <h1 className="m-0 text-[22px] font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="m-0 text-sm text-muted">{subtitle}</p>}
          </div>
          {children}
        </section>
      </main>
    </div>
  );
}

export const inputClass =
  "h-11 w-full rounded-[10px] border border-line bg-surface-2 px-3 text-[15px] text-fg outline-none focus:border-accent";
export const primaryButtonClass =
  "inline-flex h-11 w-full items-center justify-center rounded-[10px] bg-accent px-4 text-sm font-semibold text-white disabled:opacity-60";
