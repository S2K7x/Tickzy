import { useEffect, useRef, type FormEvent, type ReactNode } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal shell shared by every dialog (ux-spec §2.4 Dialog): `role="dialog"` + `aria-modal`, labelled by
 * its visible title (or `label` when it has none, e.g. the command palette), Esc and backdrop click close it, Tab
 * stays inside, the page behind does not scroll, focus returns to the opener on close. Rendered as a `<form>` when
 * `onSubmit` is given so Enter submits. Injects no `<style>` elements, so it works under the strict CSP (T-110).
 */
export function Modal({ title, titleId, label, onClose, onSubmit, children, size = "md", initialFocus, panelClassName, top = "pt-[10vh]" }: (
  { title: ReactNode; titleId: string; label?: undefined } | { title?: undefined; titleId?: undefined; label: string }
) & {
  onClose: () => void; onSubmit?: (e: FormEvent) => void; children: ReactNode;
  size?: "md" | "lg"; initialFocus?: React.RefObject<HTMLElement | null>;
  /** Replaces the default panel classes (padding, width, gap). */ panelClassName?: string;
  /** Vertical offset of the panel. */ top?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    (initialFocus?.current ?? box.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); close.current(); return; }
      if (e.key !== "Tab" || !box.current) return;
      const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0]!, last = items.at(-1)!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey, true);
    // Scroll lock through the CSSOM (allowed by the CSP, unlike an injected <style>); restores the previous value.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey, true); document.body.style.overflow = overflow; opener?.focus?.(); };
  }, [initialFocus]);
  const cls = panelClassName ?? `flex max-h-[85vh] w-full ${size === "lg" ? "max-w-lg" : "max-w-md"} flex-col gap-4 overflow-y-auto rounded-2xl border border-line bg-surface p-5 text-fg shadow-xl`;
  const body = <>{title !== undefined && <h2 id={titleId} className="m-0 text-lg font-semibold">{title}</h2>}{children}</>;
  // The dialog role sits on a div (ARIA in HTML does not allow it on <form>); the form, when any, is inside it.
  return (
    <div className={`fixed inset-0 z-40 flex items-start justify-center bg-black/40 p-4 ${top}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {/* display:contents goes on the (role-less) form, never on the dialog: browsers may drop roles of contents boxes. */}
      <div ref={box} role="dialog" aria-modal="true" {...(label ? { "aria-label": label } : { "aria-labelledby": titleId })} className={cls}>
        {onSubmit ? <form onSubmit={onSubmit} className="contents">{body}</form> : body}
      </div>
    </div>
  );
}
