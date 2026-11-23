/**
 * Search query language (FR-3.8, T-207). Free text and "quoted phrases" are full-text terms; `key:value` operators
 * are structured filters. Values may be quoted (`account:"Globex Corp"`). A leading `-` negates a text term
 * (passed through to websearch_to_tsquery). Unknown operators are kept as text, so nothing the user typed is lost.
 *
 *   from:hank@globex.com   messages written by this person (email or name, contact or teammate)
 *   account:globex         issues of accounts whose name or domain matches
 *   status:resolved        status category (triage, waiting_on_us, waiting_on_customer, blocked, resolved, closed, ignored)
 *   is:open | is:unassigned | is:mine | is:internal
 *   channel:slack|email|widget|api|ui
 *   priority:urgent|high|normal|low
 */
export const SEARCH_OPERATORS = ["from", "account", "status", "is", "channel", "priority"] as const;
export type SearchOperator = (typeof SEARCH_OPERATORS)[number];

export interface ParsedSearch {
  /** Text for websearch_to_tsquery (phrases keep their quotes, negations their minus). Empty when only filters. */
  text: string;
  filters: Record<SearchOperator, string[]>;
}

const IS_VALUES = new Set(["open", "unassigned", "mine", "internal"]);
const VALID: Partial<Record<SearchOperator, Set<string>>> = {
  status: new Set(["triage", "waiting_on_us", "waiting_on_customer", "blocked", "resolved", "closed", "ignored"]),
  is: IS_VALUES,
  channel: new Set(["slack", "email", "widget", "api", "ui"]),
  priority: new Set(["urgent", "high", "normal", "low"]),
};

/** Splits into tokens, keeping "quoted strings" (with their quotes) and key:"quoted values" together. */
function tokenize(q: string): string[] {
  const out: string[] = [];
  const re = /(-?[a-z]+:"[^"]*"?)|(-?"[^"]*"?)|(\S+)/gi;
  for (const m of q.matchAll(re)) out.push(m[0]);
  return out;
}

export function parseSearch(input: string): ParsedSearch {
  const filters = Object.fromEntries(SEARCH_OPERATORS.map((o) => [o, [] as string[]])) as Record<SearchOperator, string[]>;
  const text: string[] = [];
  for (const token of tokenize(input.slice(0, 500))) {
    const m = /^([a-z]+):(.*)$/i.exec(token);
    const op = m?.[1]?.toLowerCase() as SearchOperator | undefined;
    if (m && op && (SEARCH_OPERATORS as readonly string[]).includes(op)) {
      let value = m[2]!.replace(/^"|"$/g, "").trim();
      if (op !== "from" && op !== "account") value = value.toLowerCase();
      if (op === "status" && value === "open") { filters.is.push("open"); continue; }
      if (op === "status") value = value.replace(/[\s-]+/g, "_");
      if (!value) continue;
      const allowed = VALID[op];
      if (allowed && !allowed.has(value)) { text.push(token); continue; } // not a known value: treat as text
      if (!filters[op].includes(value)) filters[op].push(value);
      continue;
    }
    text.push(token);
  }
  return { text: text.join(" ").trim(), filters };
}

/** True when the query has neither text nor filters. */
export const isEmptySearch = (p: ParsedSearch) => !p.text && Object.values(p.filters).every((v) => v.length === 0);
