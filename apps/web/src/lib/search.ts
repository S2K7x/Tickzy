import { useQuery } from "@tanstack/react-query";
import { api } from "./api.ts";
import type { Issue } from "./issues.ts";

/** GET /v1/search (T-207). Snippets mark matches with \u0001 … \u0002. */
export interface SearchResponse {
  query: { text: string; filters: Record<string, string[]> };
  issues: { issue: Issue; match: { in: "title" | "message" | "filters"; message_id: string | null; snippet: string | null } }[];
  accounts: { id: string; name: string; domains: string[] }[];
}

export function useSearchResults(ws: string | null, q: string) {
  return useQuery({
    queryKey: ["search", ws, q],
    queryFn: () => api<SearchResponse>(`/v1/search?q=${encodeURIComponent(q)}&limit=30`, { workspaceId: ws }),
    enabled: !!ws && q.trim().length > 0,
    staleTime: 10_000,
  });
}

const HL_START = String.fromCharCode(1);
const HL_END = String.fromCharCode(2);

/** Splits a snippet into plain and highlighted parts (rendered as text + <mark>, never as HTML). Stray markers are dropped. */
export function snippetParts(snippet: string): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  const clean = (t: string) => t.split(HL_START).join("").split(HL_END).join("");
  let rest = snippet;
  for (;;) {
    const a = rest.indexOf(HL_START);
    const b = a < 0 ? -1 : rest.indexOf(HL_END, a + 1);
    if (a < 0 || b < 0) {
      if (rest) out.push({ text: clean(rest), hit: false });
      return out;
    }
    if (a > 0) out.push({ text: clean(rest.slice(0, a)), hit: false });
    out.push({ text: clean(rest.slice(a + 1, b)), hit: true });
    rest = rest.slice(b + 1);
  }
}

export const OPERATOR_HELP: [string, string][] = [
  ['"exact phrase"', "Words in this order"],
  ["-word", "Exclude a word"],
  ["from:hank@globex.com", "Messages by a customer or teammate (email or name)"],
  ["account:globex", "Issues of an account (name or domain)"],
  ["status:resolved", "triage, waiting_on_us, waiting_on_customer, blocked, resolved, closed, ignored"],
  ["is:open · is:unassigned · is:mine · is:internal", "Open issues, nobody assigned, yours, internal notes"],
  ["channel:email · priority:urgent", "Where it came from, how urgent"],
];
