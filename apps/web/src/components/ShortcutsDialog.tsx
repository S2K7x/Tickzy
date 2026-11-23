import { useEffect, useRef } from "react";

/** "?" — the shortcuts that exist today (ux-spec §2.5); more are added as features ship. */
const SHORTCUTS: [string, string][] = [
  ["/  or  ⌘K", "Search issues"],
  ["c", "New issue"],
  ["j / k", "Next / previous issue (inbox)"],
  ["r", "Reply"],
  ["n", "Internal note"],
  ["e", "Resolve"],
  ["⌘↵", "Send"],
  ["Esc", "Close / back"],
  ["?", "This list"],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); opener?.focus?.(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" className="flex w-full max-w-md flex-col gap-3 rounded-2xl border border-line bg-surface p-5 text-fg shadow-xl">
        <div className="flex items-center justify-between">
          <h2 id="shortcuts-title" className="m-0 text-lg font-semibold">Keyboard shortcuts</h2>
          <button ref={close} type="button" onClick={onClose} className="h-8 rounded-lg border border-line px-3 text-[13px] font-semibold">Close</button>
        </div>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[14px]">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys} className="contents">
              <dt><kbd className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[12px] font-semibold">{keys}</kbd></dt>
              <dd className="m-0 text-muted">{what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
