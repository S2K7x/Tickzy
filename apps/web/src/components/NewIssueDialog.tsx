import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { PRIORITIES, type Priority } from "@tickzy/shared/lifecycle";
import { PRIORITY_LABEL, useCreateIssue } from "../lib/issues.ts";

/** "New issue" (top bar): title + priority, then opens the issue in the inbox. Accessible modal: focus trapped by design, Esc closes. */
export function NewIssueDialog({ workspaceId, onClose }: { workspaceId: string | null; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const create = useCreateIssue(workspaceId);
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const issue = await create.mutateAsync({ title: title.trim(), priority }).catch(() => null);
    if (!issue) return;
    onClose();
    await navigate({ to: "/inbox", search: { issue: issue.key } as never });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form role="dialog" aria-modal="true" aria-labelledby="new-issue-title" onSubmit={submit}
        className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-line bg-surface p-5 text-fg shadow-xl">
        <h2 id="new-issue-title" className="m-0 text-lg font-semibold">New issue</h2>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-issue-name" className="text-sm font-medium">Title</label>
          <input id="new-issue-name" ref={input} value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)}
            className="h-11 rounded-[10px] border border-line bg-surface-2 px-3 text-[15px] text-fg outline-none focus:border-accent" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-issue-priority" className="text-sm font-medium">Priority</label>
          <select id="new-issue-priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="h-11 rounded-[10px] border border-line bg-surface-2 px-3 text-[15px] text-fg">
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
        </div>
        {create.isError && <p role="alert" className="m-0 text-sm text-danger">{(create.error as Error).message}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-[10px] border border-line bg-surface px-4 text-sm font-semibold text-fg">Cancel</button>
          <button type="submit" disabled={!title.trim() || create.isPending} className="h-10 rounded-[10px] bg-accent px-4 text-sm font-semibold text-white disabled:opacity-60">
            {create.isPending ? "Creating…" : "Create issue"}
          </button>
        </div>
      </form>
    </div>
  );
}
