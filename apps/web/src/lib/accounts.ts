import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { can, type Permission, type Role } from "@tickzy/shared/permissions";
import { api } from "./api.ts";

/** Accounts & contacts (T-203 API, T-210 UI; FR-4.1/4.2). */
export interface Account {
  id: string; name: string; domains: string[]; tier: string | null; owner_membership_id: string | null;
  external_ids: Record<string, string>; custom: Record<string, unknown>; contact_count: number; open_issue_count: number;
  last_activity_at: string | null; created_at: string; updated_at: string;
}
export interface Contact {
  id: string; name: string; account_id: string | null; account_source: "auto" | "manual"; role_in_account: string | null;
  identities: { id: string; kind: "email" | "slack" | "teams" | "widget"; external_key: string }[];
  custom: Record<string, unknown>; created_at: string; updated_at: string;
}
export interface AccountInput { name?: string; domains?: string[]; tier?: string | null; owner_membership_id?: string | null }

const accountsKey = (ws: string | null) => ["accounts", ws] as const;
type Page<T> = { data: T[]; next_cursor: string | null };

export function useAccounts(ws: string | null, q: string) {
  return useInfiniteQuery({
    queryKey: [...accountsKey(ws), "list", q],
    queryFn: ({ pageParam }) => api<Page<Account>>(`/v1/accounts?limit=50${q ? `&q=${encodeURIComponent(q)}` : ""}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`, { workspaceId: ws }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: !!ws,
  });
}

export function useAccount(ws: string | null, id: string) {
  return useQuery({ queryKey: [...accountsKey(ws), "one", id], queryFn: () => api<Account>(`/v1/accounts/${encodeURIComponent(id)}`, { workspaceId: ws }), enabled: !!ws && !!id });
}

export function useContacts(ws: string | null, accountId: string) {
  return useInfiniteQuery({
    queryKey: [...accountsKey(ws), "contacts", accountId],
    queryFn: ({ pageParam }) => api<Page<Contact>>(`/v1/contacts?account_id=${encodeURIComponent(accountId)}&limit=50${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`, { workspaceId: ws }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: !!ws,
  });
}

/** Create / update / delete an account, and add a contact to one. All invalidate the accounts cache. */
export function useAccountMutations(ws: string | null) {
  const qc = useQueryClient();
  const done = () => { void qc.invalidateQueries({ queryKey: accountsKey(ws) }); void qc.invalidateQueries({ queryKey: ["issues", ws] }); };
  return {
    create: useMutation({ mutationFn: (input: AccountInput & { name: string }) => api<Account>("/v1/accounts", { method: "POST", body: input, workspaceId: ws }), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...input }: AccountInput & { id: string }) => api<Account>(`/v1/accounts/${encodeURIComponent(id)}`, { method: "PATCH", body: input, workspaceId: ws }), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => api(`/v1/accounts/${encodeURIComponent(id)}`, { method: "DELETE", workspaceId: ws }), onSuccess: done }),
    addContact: useMutation({
      mutationFn: (input: { account_id: string; name?: string; email?: string; role_in_account?: string | null }) => api<Contact>("/v1/contacts", { method: "POST", body: input, workspaceId: ws }),
      onSuccess: done,
    }),
  };
}

/** Parses "acme.com, acme.io" into a domain list (the API normalises and validates each one). */
export const parseDomains = (text: string) => [...new Set(text.split(/[\s,;]+/).map((d) => d.trim().toLowerCase()).filter(Boolean))];

/** Whether the current member's role allows `permission` (UI hint only; the API enforces it). */
export const roleCan = (role: string | undefined, permission: Permission) => !!role && can(role as Role, permission);
