import { useRef, useState, type FormEvent } from "react";
import { errorMessage } from "../lib/api.ts";
import { roleCan } from "../lib/accounts.ts";
import { cleanFilters, sameState, useSavedViews, useViewMutations, type SavedView, type ViewState } from "../lib/views.ts";
import { Modal } from "../components/Modal.tsx";
import { btn, input, segmented } from "../components/ui.ts";

/**
 * Saved views in the inbox queue (T-211, FR-3.7): tabs with live counts; the active one is marked "Modified" when the
 * filters differ from what it stores, with Save changes (owner/admin) and Reset; Save view stores the current state.
 */
export function SavedViewsBar({ ws, role, state, savedId, onOpen, onSaved, onDeleted }: {
  ws: string | null; role: string | undefined; state: ViewState; savedId: string | undefined;
  onOpen: (v: SavedView) => void; onSaved: (v: SavedView) => void; onDeleted: () => void;
}) {
  const views = useSavedViews(ws);
  const { update } = useViewMutations(ws);
  const [dialog, setDialog] = useState<"save" | "edit" | "delete" | null>(null);
  const all = views.data?.data ?? [];
  const active = savedId ? all.find((v) => v.id === savedId) : undefined;
  const modified = !!active && !sameState(state, { base: active.base, sort: active.sort, filters: active.filters });
  const isDefault = !Object.keys(cleanFilters(state.filters)).length && state.sort === "updated"; // a plain system tab
  const canSave = !active ? !isDefault : modified;

  return (
    <div className="flex flex-col gap-2">
      {all.length > 0 && (
        <nav aria-label="Saved views" className={segmented.bar}>
          {all.map((v) => (
            <button key={v.id} type="button" onClick={() => onOpen(v)} aria-current={v.id === savedId ? "page" : undefined}
              title={v.shared ? `Shared view · by ${v.owner_name ?? "a teammate"}` : "Personal view"}
              className={`${segmented.item} ${v.id === savedId ? segmented.active : ""}`}>
              {v.shared && <SharedIcon />}{v.name}<span className={segmented.count}>{v.count}</span>
            </button>
          ))}
        </nav>
      )}
      {views.isError && <p role="alert" className="m-0 text-[12px] text-danger">Saved views: {errorMessage(views.error)}</p>}
      {(active || canSave) && (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          {active && <span className="font-semibold">{active.name}{modified && <span className="ml-1.5 rounded-full bg-warn-soft px-1.5 py-px font-medium text-fg">Modified</span>}</span>}
          {active && modified && active.can_edit && (
            <button type="button" disabled={update.isPending} onClick={() => update.mutate({ id: active.id, base: state.base, sort: state.sort, filters: cleanFilters(state.filters) })}
              className={`${btn.secondary} h-7 px-2.5 text-[12px]`}>{update.isPending ? "Saving…" : "Save changes"}</button>
          )}
          {active && modified && <button type="button" onClick={() => onOpen(active)} className={`${btn.ghost} h-7 px-2 text-[12px]`}>Reset</button>}
          {canSave && <button type="button" onClick={() => setDialog("save")} className={`${btn.ghost} h-7 px-2 text-[12px]`}>{active ? "Save as new view" : "Save view"}</button>}
          {active?.can_edit && !modified && (
            <>
              <button type="button" onClick={() => setDialog("edit")} className={`${btn.ghost} h-7 px-2 text-[12px]`}>Edit view</button>
              <button type="button" onClick={() => setDialog("delete")} className={`${btn.danger} h-7 px-2 text-[12px]`}>Delete view</button>
            </>
          )}
          {update.isError && <span role="alert" className="text-danger">{errorMessage(update.error)}</span>}
        </div>
      )}
      {dialog === "save" && <ViewDialog ws={ws} role={role} state={state} onClose={() => setDialog(null)} onSaved={onSaved} />}
      {dialog === "edit" && active && <ViewDialog ws={ws} role={role} view={active} onClose={() => setDialog(null)} onSaved={() => undefined} />}
      {dialog === "delete" && active && <DeleteView ws={ws} view={active} onClose={() => setDialog(null)} onDeleted={onDeleted} />}
    </div>
  );
}

const SharedIcon = () => (
  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7" /><path d="M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
  </svg>
);

/** Create (from the current inbox state) or rename / share an existing view. */
function ViewDialog({ ws, role, state, view, onClose, onSaved }: {
  ws: string | null; role: string | undefined; state?: ViewState; view?: SavedView; onClose: () => void; onSaved: (v: SavedView) => void;
}) {
  const { create, update } = useViewMutations(ws);
  const [name, setName] = useState(view?.name ?? "");
  const [shared, setShared] = useState(view?.shared ?? false);
  const first = useRef<HTMLInputElement>(null);
  const canShare = roleCan(role, "issues:write");
  const m = view ? update : create;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const saved = await (view
      ? update.mutateAsync({ id: view.id, name: name.trim(), shared })
      : create.mutateAsync({ ...state!, filters: cleanFilters(state!.filters), name: name.trim(), shared })).catch(() => null);
    if (!saved) return;
    onClose();
    onSaved(saved);
  }
  return (
    <Modal title={view ? `Edit view “${view.name}”` : "Save view"} titleId="view-dialog-title" onClose={onClose} onSubmit={submit} initialFocus={first}>
      {!view && <p className="m-0 text-[13px] text-muted">Saves the current tab, filters, search and sort. Its count updates live.</p>}
      <label className="flex flex-col gap-1.5 text-sm font-medium">Name
        <input ref={first} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Urgent enterprise" className={input} required />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={shared} disabled={!canShare} onChange={(e) => setShared(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" aria-describedby="view-share-help" />
        <span className="flex flex-col">
          <span className="font-medium">Share with the workspace</span>
          <span id="view-share-help" className="text-[12px] text-muted">{canShare ? "Everyone in the workspace sees it; only you and admins can change it." : "Your role can keep personal views only."}</span>
        </span>
      </label>
      {m.isError && <p role="alert" className="m-0 text-sm text-danger">{errorMessage(m.error)}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={`${btn.secondary} ${btn.md}`}>Cancel</button>
        <button type="submit" disabled={!name.trim() || m.isPending} className={`${btn.primary} ${btn.md}`}>{m.isPending ? "Saving…" : view ? "Save" : "Save view"}</button>
      </div>
    </Modal>
  );
}

function DeleteView({ ws, view, onClose, onDeleted }: { ws: string | null; view: SavedView; onClose: () => void; onDeleted: () => void }) {
  const { remove } = useViewMutations(ws);
  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (await remove.mutateAsync(view.id).then(() => true).catch(() => false)) { onClose(); onDeleted(); }
  }
  return (
    <Modal title={`Delete view “${view.name}”?`} titleId="delete-view-title" onClose={onClose} onSubmit={confirm}>
      <p className="m-0 text-sm text-muted">{view.shared ? "It disappears for everyone in the workspace. Issues are not affected." : "Issues are not affected."}</p>
      {remove.isError && <p role="alert" className="m-0 text-sm text-danger">{errorMessage(remove.error)}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={`${btn.secondary} ${btn.md}`}>Cancel</button>
        <button type="submit" disabled={remove.isPending} className={`${btn.dangerSolid} ${btn.md}`}>{remove.isPending ? "Deleting…" : "Delete view"}</button>
      </div>
    </Modal>
  );
}
