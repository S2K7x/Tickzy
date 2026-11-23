import { useRef, useState, type FormEvent } from "react";
import { Modal } from "./Modal.tsx";
import { useNavigate } from "@tanstack/react-router";
import { PRIORITIES, type Priority } from "@tickzy/shared/lifecycle";
import { PRIORITY_LABEL, useCreateIssue } from "../lib/issues.ts";
import { errorMessage } from "../lib/api.ts";

/** "New issue" (top bar): title + priority, then opens the issue in the inbox. Uses the shared accessible Modal. */
export function NewIssueDialog({ workspaceId, onClose }: { workspaceId: string | null; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const create = useCreateIssue(workspaceId);
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const issue = await create.mutateAsync({ title: title.trim(), priority }).catch(() => null);
    if (!issue) return;
    onClose();
    await navigate({ to: "/inbox", search: { issue: issue.key } as never });
  }

  return (
    <Modal title="New issue" titleId="new-issue-title" onClose={onClose} onSubmit={submit} initialFocus={input}>
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
        {create.isError && <p role="alert" className="m-0 text-sm text-danger">{errorMessage(create.error)}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-[10px] border border-line bg-surface px-4 text-sm font-semibold text-fg">Cancel</button>
          <button type="submit" disabled={!title.trim() || create.isPending} className="h-10 rounded-[10px] bg-primary px-4 text-sm font-semibold text-primary-fg hover:opacity-90 disabled:opacity-50">
            {create.isPending ? "Creating…" : "Create issue"}
          </button>
        </div>
    </Modal>
  );
}
