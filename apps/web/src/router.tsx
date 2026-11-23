import { createRootRoute, createRoute, createRouter, createMemoryHistory, Navigate, Outlet, useRouterState, type RouterHistory } from "@tanstack/react-router";
import { AppShell } from "./components/AppShell.tsx";
import { Overview } from "./pages/Overview.tsx";
import { Placeholder } from "./pages/Placeholder.tsx";
import { Accounts } from "./pages/Accounts.tsx";
import { AccountProfile } from "./pages/AccountProfile.tsx";
import { SignIn } from "./pages/SignIn.tsx";
import { VerifyLink } from "./pages/VerifyLink.tsx";
import { Onboarding } from "./pages/Onboarding.tsx";
import { Invite } from "./pages/Invite.tsx";
import { More } from "./pages/More.tsx";
import { Inbox, type InboxSearch } from "./pages/Inbox.tsx";
import { SearchPage } from "./pages/Search.tsx";
import { SORTS, VIEWS } from "./lib/issues.ts";
import { SettingsLayout } from "./pages/settings/SettingsLayout.tsx";
import { Members } from "./pages/settings/Members.tsx";
import { ApiTokens } from "./pages/settings/ApiTokens.tsx";
import { useCurrentWorkspace, useSession, useSignOut } from "./lib/session.ts";
import { useTheme } from "./theme.ts";

const PUBLIC_PATHS = new Set(["/sign-in", "/auth/verify", "/invite"]);

function FullScreenMessage({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-4 text-center text-fg">
      <p role="status" className="m-0 text-sm text-muted">{title}</p>
      {children}
    </div>
  );
}

/** Route guard (T-105): signed-out → sign-in; signed-in without a workspace → onboarding; else the app shell. */
function Root() {
  const { theme, toggle } = useTheme();
  const session = useSession();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const workspace = useCurrentWorkspace(session.data);
  const signOut = useSignOut();

  if (session.isPending) return <FullScreenMessage title="Loading Tickzy…" />;
  if (session.isError) {
    return (
      <FullScreenMessage title="Tickzy is unreachable right now.">
        <button type="button" className="rounded-[10px] border border-line bg-surface px-4 py-2 text-sm font-semibold" onClick={() => void session.refetch()}>Try again</button>
      </FullScreenMessage>
    );
  }
  const data = session.data;
  const isPublic = PUBLIC_PATHS.has(pathname);
  if (!data) return isPublic ? <Outlet /> : <Navigate to="/sign-in" replace />;
  if (pathname === "/sign-in") return <Navigate to="/" replace />;
  if (pathname === "/auth/verify" || pathname === "/invite") return <Outlet />; // invite works with or without a workspace
  if (data.workspaces.length === 0) return pathname === "/onboarding" ? <Outlet /> : <Navigate to="/onboarding" replace />;
  if (pathname === "/onboarding") return <Outlet />; // creating an additional workspace
  return (
    <AppShell
      theme={theme}
      onToggleTheme={toggle}
      user={data.user}
      workspaceName={workspace.current?.name ?? ""}
      workspaceId={workspace.current?.workspace_id ?? null}
      workspaces={workspace.workspaces}
      onSelectWorkspace={workspace.select}
      fullBleed={pathname === "/inbox" || pathname === "/mine"}
      onSignOut={() => void signOut()}
    />
  );
}

const rootRoute = createRootRoute({ component: Root });
const page = <const P extends string>(path: P, component: () => React.JSX.Element) =>
  createRoute({ getParentRoute: () => rootRoute, path, component });

const settingsRoute = page("/settings", SettingsLayout);

/** Inbox URL state (ux-spec: URLs are the source of truth for view state). Unknown values are dropped. */
function inboxSearch(s: Record<string, unknown>): InboxSearch {
  const out: InboxSearch = {};
  if (typeof s.view === "string" && VIEWS.some((v) => v.id === s.view)) out.view = s.view as InboxSearch["view"];
  if (typeof s.sort === "string" && SORTS.some((x) => x.id === s.sort)) out.sort = s.sort as InboxSearch["sort"];
  if (typeof s.issue === "string" && /^[\w-]{1,64}$/.test(s.issue)) out.issue = s.issue;
  if (typeof s.q === "string" && s.q.trim()) out.q = s.q.slice(0, 200);
  // Filters: comma lists of plain tokens / ids only (the API validates values again).
  for (const k of ["priority", "channel", "team", "label", "account"] as const) {
    if (typeof s[k] === "string" && /^[\w,-]{1,300}$/.test(s[k])) out[k] = s[k];
  }
  return out;
}

const routeTree = rootRoute.addChildren([
  page("/", Overview),
  createRoute({ getParentRoute: () => rootRoute, path: "/inbox", component: () => <Inbox />, validateSearch: inboxSearch }),
  createRoute({ getParentRoute: () => rootRoute, path: "/mine", component: () => <Inbox defaultView="mine" />, validateSearch: inboxSearch }),
  createRoute({ getParentRoute: () => rootRoute, path: "/accounts", component: Accounts,
    validateSearch: (s: Record<string, unknown>): { q?: string } => (typeof s.q === "string" && s.q.trim() ? { q: s.q.slice(0, 100) } : {}) }),
  createRoute({ getParentRoute: () => rootRoute, path: "/accounts/$accountId", component: AccountProfile,
    validateSearch: (s: Record<string, unknown>): { tab?: "contacts" } => (s.tab === "contacts" ? { tab: "contacts" } : {}) }),
  page("/ai", () => <Placeholder title="AI agent" milestone="M5" description="Copilot drafts, shadow mode, backtests and spend limits." />),
  page("/knowledge", () => <Placeholder title="Knowledge" milestone="M5" description="Docs and resolved issues the AI answers from." />),
  page("/analytics", () => <Placeholder title="Analytics" milestone="M4" description="Volume, response times, SLA compliance and AI outcomes." />),
  settingsRoute.addChildren([
    createRoute({ getParentRoute: () => settingsRoute, path: "/", component: () => <Navigate to="/settings/members" replace /> }),
    createRoute({ getParentRoute: () => settingsRoute, path: "members", component: Members }),
    createRoute({ getParentRoute: () => settingsRoute, path: "api-tokens", component: ApiTokens }),
  ]),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/sign-in",
    component: SignIn,
    validateSearch: (s: Record<string, unknown>): { email?: string; error?: string } => ({
      ...(typeof s.email === "string" ? { email: s.email.slice(0, 254) } : {}),
      ...(typeof s.error === "string" ? { error: s.error.slice(0, 40) } : {}),
    }),
  }),
  page("/invite", Invite),
  createRoute({ getParentRoute: () => rootRoute, path: "/search", component: SearchPage,
    validateSearch: (s: Record<string, unknown>): { q?: string } => (typeof s.q === "string" && s.q.trim() ? { q: s.q.slice(0, 500) } : {}) }),
  page("/auth/verify", VerifyLink),
  page("/onboarding", Onboarding),
  page("/more", More),
]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, ...(history ? { history } : {}) });
}

export const testHistory = (path = "/") => createMemoryHistory({ initialEntries: [path] });

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
