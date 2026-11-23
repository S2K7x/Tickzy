import { Modal } from "./Modal.tsx";

/** "?" — the shortcuts that exist today (ux-spec §2.5); more are added as features ship. */
const SHORTCUTS: [string, string][] = [
  ["⌘K", "Command palette: jump to an issue, run a command"],
  ["/", "Search"],
  ["c", "New issue"],
  ["j / k", "Next / previous issue (inbox)"],
  ["r", "Reply"],
  ["n", "Internal note"],
  ["a", "Assign…"],
  ["s", "Change status…"],
  ["p", "Set priority…"],
  ["l", "Add label…"],
  ["e", "Resolve"],
  ["x", "Select for bulk actions"],
  ["⌘↵", "Send"],
  ["Esc", "Close / back"],
  ["?", "This list"],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" titleId="shortcuts-title" onClose={onClose}>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[14px]">
        {SHORTCUTS.map(([keys, what]) => (
          <div key={keys} className="contents">
            <dt><kbd className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[12px] font-semibold">{keys}</kbd></dt>
            <dd className="m-0 text-muted">{what}</dd>
          </div>
        ))}
      </dl>
      <button type="button" onClick={onClose} className="h-9 self-end rounded-lg border border-line px-4 text-[13px] font-semibold">Close</button>
    </Modal>
  );
}
