import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useCurrentWorkspace, useSession } from "../lib/session.ts";
import { OPERATOR_HELP, snippetParts, useSearchResults } from "../lib/search.ts";
import { relativeTime } from "../lib/issues.ts";
import { ChannelBadge, PriorityDot, StatusChip } from "../components/issue-ui.tsx";
import { SearchIcon } from "../components/icons.tsx";
import { btn, card } from "../components/ui.ts";
import { errorMessage } from "../lib/api.ts";

/** Search results (FR-3.8, T-207): issues by title or message text with highlighted snippets, plus accounts. */
export function SearchPage() {
  const { q = "" } = useSearch({ strict: false }) as { q?: string };
  const [term, setTerm] = useState(q);
  const navigate = useNavigate();
  const session = useSession();
  const { current } = useCurrentWorkspace(session.data);
  const results = useSearchResults(current?.workspace_id ?? null, q);
  const submit = (e: FormEvent) => { e.preventDefault(); void navigate({ to: "/search", search: (term.trim() ? { q: term.trim() } : {}) as never }); };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-[32px] font-medium leading-tight tracking-tight">Search</h1>
        <p className="m-0 text-[14px] text-muted">Issues, messages and accounts. Combine words with operators.</p>
      </div>
      <form role="search" aria-label="Search issues, messages and accounts" onSubmit={submit} className="flex gap-2">
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-line bg-surface px-3 text-muted">
          <SearchIcon size={16} />
          <span className="sr-only">Search query</span>
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder='e.g. webhook from:hank@globex.com is:open' className="min-w-0 flex-1 border-0 bg-transparent text-[15px] text-fg outline-none placeholder:text-muted" />
        </label>
        <button type="submit" className={`${btn.primary} ${btn.lg}`}>Search</button>
      </form>

      {!q && (
        <section aria-labelledby="ops" className={`${card} p-5`}>
          <h2 id="ops" className="m-0 text-[16px] font-medium">Search operators</h2>
          <dl className="m-0 mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-[14px] md:grid-cols-[auto_1fr]">
            {OPERATOR_HELP.map(([op, what]) => (
              <div key={op} className="contents">
                <dt><code className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[13px]">{op}</code></dt>
                <dd className="m-0 text-muted">{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {q && results.isPending && <p role="status" className="m-0 text-sm text-muted">Searching…</p>}
      {results.isError && <p role="alert" className="m-0 text-sm text-danger">{errorMessage(results.error)}</p>}
      {q && results.data && (
        <>
          {results.data.accounts.length > 0 && (
            <section aria-labelledby="acc-results" className={card}>
              <h2 id="acc-results" className="m-0 border-b border-line px-5 py-3 text-[15px] font-medium">Accounts</h2>
              <ul className="m-0 list-none p-0">
                {results.data.accounts.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 last:border-b-0">
                    <span className="font-medium">{a.name}</span>
                    <span className="truncate text-[13px] text-muted">{a.domains.join(", ") || "No domains"}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="issue-results" className={card}>
            <h2 id="issue-results" className="m-0 border-b border-line px-5 py-3 text-[15px] font-medium">
              Issues <span className="text-[13px] font-normal text-muted">{results.data.issues.length}{results.data.issues.length === 30 ? "+" : ""}</span>
            </h2>
            {results.data.issues.length === 0 && <p className="m-0 px-5 py-8 text-center text-sm text-muted">No issues match “{q}”.</p>}
            <ul className="m-0 list-none p-0">
              {results.data.issues.map(({ issue: i, match }) => (
                <li key={i.id} className="border-b border-line last:border-b-0">
                  <Link to="/inbox" search={{ issue: i.key } as never} className="flex flex-col gap-1.5 px-5 py-3.5 text-fg no-underline hover:bg-surface-2/60">
                    <span className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                      <PriorityDot priority={i.priority} />
                      <span className="font-semibold text-fg">{i.account?.name ?? "No account"}</span>
                      <span>{i.key}</span>
                      <StatusChip status={i.status} />
                      <ChannelBadge channel={i.channel} />
                      <span className="ml-auto">{relativeTime(i.updated_at)}</span>
                    </span>
                    <span className="font-medium">{i.title}</span>
                    {match.snippet && (
                      <span className="line-clamp-2 text-[13px] text-muted">
                        {snippetParts(match.snippet).map((p, k) => (p.hit ? <mark key={k} className="rounded bg-warn-soft px-0.5 text-fg">{p.text}</mark> : <span key={k}>{p.text}</span>))}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
