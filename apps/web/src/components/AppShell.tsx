import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { NAV, type NavItem } from "./nav.ts";
import { ChevronDownIcon, KeyboardIcon, Logo, LogoutIcon, MenuIcon, MoonIcon, PanelIcon, PlusIcon, SearchIcon, SunIcon } from "./icons.tsx";
import type { Theme } from "../theme.ts";
import type { SessionUser, WorkspaceMembership } from "../lib/api.ts";
import { useIssueStats } from "../lib/issues.ts";
import { NewIssueDialog } from "./NewIssueDialog.tsx";
import { ShortcutsDialog } from "./ShortcutsDialog.tsx";
import { Avatar } from "./issue-ui.tsx";

export interface ShellUser {
  user: SessionUser;
  workspaceName: string;
  onSignOut: () => void;
}

/** Shell actions available to pages (e.g. Overview's "New issue" button). */
const ShellContext = createContext<{ openNewIssue: () => void }>({ openNewIssue: () => undefined });
export const useShell = () => useContext(ShellContext);

const SIDEBAR_KEY = "tickzy.sidebar";
const readCollapsed = () => { try { return localStorage.getItem(SIDEBAR_KEY) === "rail"; } catch { return false; } };

const GROUP_LABEL: Record<NavItem["group"], string> = { support: "Menu", ai: "AI & insights", system: "Workspace" };
const displayName = (u: SessionUser) => u.name.trim() || u.email;
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

function SidebarLink({ item, compact, count }: { item: NavItem; compact: boolean; count?: number | null | undefined }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      aria-label={compact ? item.label : undefined}
      title={compact ? item.label : undefined}
      activeOptions={{ exact: item.to === "/" }}
      className={`flex min-h-10 items-center gap-3 rounded-xl text-[14px] text-muted no-underline hover:text-fg ${compact ? "justify-center px-0" : "px-3"}`}
      activeProps={{ "aria-current": "page", className: "bg-panel font-medium !text-fg shadow-[0_1px_2px_rgba(0,0,0,0.06),inset_0_0_0_1px_var(--border)]" }}
    >
      <Icon size={18} />
      {!compact && <span className="flex-1">{item.label}</span>}
      {!compact && count ? <span className="text-[12px] font-medium tabular-nums text-muted" aria-label={`${count} issues`}>{count}</span> : null}
    </Link>
  );
}

/** ≥1280px: full sidebar (collapsible) · 768–1279px: icon rail (ux-spec §2.6, design v2). */
function Sidebar({ compact, collapsed, onToggle, onSearch, onShortcuts, user, workspaceName, counts }: {
  compact: boolean; collapsed: boolean; onToggle: () => void; onSearch: () => void; onShortcuts: () => void; user: SessionUser; workspaceName: string;
  counts: Partial<Record<string, number | null>>;
}) {
  const groups = (["support", "ai", "system"] as const).map((g) => ({ g, items: NAV.filter((n) => n.group === g) }));
  const visibility = compact ? (collapsed ? "hidden md:flex" : "hidden md:flex xl:hidden") : (collapsed ? "hidden" : "hidden xl:flex");
  const label = "px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted";
  return (
    <nav aria-label="Primary" data-testid={compact ? "icon-rail" : "sidebar"}
      className={`${visibility} ${compact ? "w-[68px] items-center px-2" : "w-[264px] px-4"} sticky top-0 h-screen shrink-0 flex-col gap-6 py-5`}>
      <div className={`flex items-center ${compact ? "flex-col gap-3" : "justify-between px-1"}`}>
        <Link to="/" className="flex items-center gap-2.5 text-fg no-underline">
          <Logo />
          {!compact && <span className="text-[19px] font-semibold tracking-tight">Tickzy</span>}
        </Link>
        <button type="button" onClick={onToggle} className="hidden h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg xl:inline-flex"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <PanelIcon size={18} />
        </button>
      </div>

      {!compact && (
        <div className="flex flex-col">
          <span className={label}>Quick actions</span>
          <button type="button" onClick={onSearch} className="flex h-10 items-center gap-2.5 rounded-xl border border-line bg-panel px-3 text-[14px] text-muted hover:text-fg">
            <SearchIcon size={16} />
            <span className="flex-1 text-left">Search</span>
            <kbd className="rounded-md border border-line bg-surface-2 px-1.5 text-[11px] font-semibold">/</kbd>
          </button>
        </div>
      )}

      <div className="flex min-h-0 w-full flex-1 flex-col gap-5 overflow-y-auto">
        {groups.map(({ g, items }) => (
          <div key={g} className="flex w-full flex-col gap-0.5">
            {!compact && <span className={label}>{GROUP_LABEL[g]}</span>}
            {items.map((item) => <SidebarLink key={item.to} item={item} compact={compact} count={counts[item.to]} />)}
          </div>
        ))}
        <div className="flex w-full flex-col gap-0.5">
          {!compact && <span className={label}>Help & support</span>}
          <button type="button" onClick={onShortcuts} aria-label={compact ? "Keyboard shortcuts" : undefined} title={compact ? "Keyboard shortcuts" : undefined}
            className={`flex min-h-10 items-center gap-3 rounded-xl text-[14px] text-muted hover:text-fg ${compact ? "justify-center" : "px-3"}`}>
            <KeyboardIcon size={18} />
            {!compact && <span>Keyboard shortcuts</span>}
          </button>
        </div>
      </div>

      {compact ? (
        <span title={user.email}><Avatar name={displayName(user)} size={34} /></span>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-panel p-3">
          <Avatar name={displayName(user)} size={36} />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-[14px] font-semibold">{displayName(user)}</span>
            <span className="truncate text-[12px] text-muted">{user.name.trim() ? user.email : workspaceName}</span>
          </span>
        </div>
      )}
    </nav>
  );
}

/** <768px: bottom tab bar with 4 primary destinations + More. */
function BottomTabs() {
  const items = NAV.filter((n) => n.mobile);
  const cls = "flex min-h-[52px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted no-underline";
  const active = { "aria-current": "page" as const, className: "font-semibold !text-fg" };
  return (
    <nav aria-label="Primary" data-testid="bottom-tabs" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line bg-panel px-1 pb-[max(env(safe-area-inset-bottom),12px)] pt-1.5 md:hidden">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link key={item.to} to={item.to} activeOptions={{ exact: item.to === "/" }} className={cls} activeProps={active}>
            <Icon size={22} />
            {item.label === "My issues" ? "Mine" : item.label}
          </Link>
        );
      })}
      <Link to="/more" className={cls} activeProps={active}>
        <MenuIcon size={22} />
        More
      </Link>
    </nav>
  );
}

/**
 * Popover menu: Escape and outside clicks close it; focus returns to the trigger. The trigger's accessible name comes
 * from its content (visible text + screen-reader text), so it always contains what is visible (WCAG 2.5.3).
 */
function Menu({ label, trigger, children, align = "right" }: { label: string; trigger: ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button ref={button} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-xl text-fg">
        {trigger}
      </button>
      {open && (
        <div role="menu" aria-label={label} className={`absolute top-[calc(100%+8px)] z-30 min-w-[220px] rounded-xl border border-line bg-surface p-1.5 shadow-lg ${align === "right" ? "right-0" : "left-0"}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
const menuItem = "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14px] text-fg hover:bg-surface-2";

function TopBar({ theme, onToggleTheme, user, workspaceName, workspaces, currentWorkspaceId, onSelectWorkspace, onSignOut, onNewIssue, onShortcuts, page, searchRef }: {
  theme: Theme; onToggleTheme: () => void; workspaces: WorkspaceMembership[]; currentWorkspaceId: string | null; onSelectWorkspace: (id: string) => void;
  onNewIssue: () => void; onShortcuts: () => void; page: string; searchRef: React.RefObject<HTMLInputElement | null>;
} & ShellUser) {
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  const iconBtn = "inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-panel text-fg hover:bg-surface-2";
  function search(e: FormEvent) {
    e.preventDefault();
    const q = term.trim();
    void navigate({ to: "/inbox", search: (q ? { q } : {}) as never });
  }
  return (
    <header className="sticky top-0 z-10 flex min-h-[64px] items-center justify-between gap-3 border-b border-line bg-panel px-4 py-3 md:static md:px-6">
      <div className="flex min-w-0 items-center gap-2 text-[14px] sm:text-[15px]">
        <span className="md:hidden"><Logo size={28} /></span>
        <Menu label="Switch workspace" align="left" trigger={<span className="flex min-w-0 max-w-[110px] items-center gap-1.5 font-medium sm:max-w-[200px]"><span className="truncate">{workspaceName}</span><span className="sr-only">, switch workspace</span><ChevronDownIcon size={16} className="shrink-0 text-muted" /></span>}>
          {(close) => (
            <>
              {workspaces.map((w) => (
                <button key={w.workspace_id} type="button" role="menuitemradio" aria-checked={w.workspace_id === currentWorkspaceId} className={menuItem}
                  onClick={() => { onSelectWorkspace(w.workspace_id); close(); void navigate({ to: "/" }); }}>
                  <span className="flex-1 truncate">{w.name}</span>
                  {w.workspace_id === currentWorkspaceId && <span className="text-[12px] text-muted">Current</span>}
                </button>
              ))}
              <div className="my-1 h-px bg-line" />
              <Link to="/onboarding" role="menuitem" className={`${menuItem} no-underline`} onClick={close}><PlusIcon size={16} />Create workspace</Link>
            </>
          )}
        </Menu>
        <span className="hidden text-muted sm:inline" aria-hidden="true">/</span>
        <span className="hidden truncate font-medium sm:inline" aria-current="page">{page}</span>
      </div>

      <form role="search" onSubmit={search} className="hidden h-10 min-w-0 max-w-[460px] flex-1 items-center gap-2.5 rounded-xl border border-line bg-surface-2 px-3 text-muted lg:flex">
        <SearchIcon size={16} />
        <label htmlFor="global-search" className="sr-only">Search issues</label>
        <input id="global-search" ref={searchRef} type="search" value={term} onChange={(e) => setTerm(e.target.value)}
          placeholder="Search issues or press “/”" className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-fg outline-none placeholder:text-muted" />
      </form>

      <div className="flex shrink-0 items-center gap-2">
        <Link to="/inbox" aria-label="Search" className={`${iconBtn} lg:hidden`}><SearchIcon size={18} /></Link>
        <button type="button" onClick={onToggleTheme} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} className={iconBtn}>
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
        <button type="button" onClick={onNewIssue} aria-label="New issue" title="New issue (c)" className={iconBtn}>
          <PlusIcon size={18} />
        </button>
        <Menu label="Account menu" trigger={<><span className="sr-only">Account menu</span><Avatar name={displayName(user)} size={38} /></>}>
          {(close) => (
            <>
              <div className="px-2.5 py-2">
                <div className="truncate text-[14px] font-semibold">{displayName(user)}</div>
                <div className="truncate text-[12px] text-muted">{user.email}</div>
              </div>
              <div className="my-1 h-px bg-line" />
              <button type="button" role="menuitem" className={menuItem} onClick={() => { close(); onShortcuts(); }}><KeyboardIcon size={16} />Keyboard shortcuts</button>
              <button type="button" role="menuitem" className={menuItem} onClick={() => { close(); onSignOut(); }}><LogoutIcon size={16} />Sign out</button>
            </>
          )}
        </Menu>
      </div>
    </header>
  );
}

const PAGE_TITLES: [string, string][] = [["/inbox", "Inbox"], ["/mine", "My issues"], ["/settings", "Settings"], ["/more", "More"], ...NAV.map((n) => [n.to, n.label] as [string, string])];

export function AppShell({ theme, onToggleTheme, children, workspaceId, workspaces = [], onSelectWorkspace = () => undefined, fullBleed, ...shellUser }: {
  theme: Theme; onToggleTheme: () => void; children?: ReactNode; workspaceId: string | null;
  workspaces?: WorkspaceMembership[]; onSelectWorkspace?: (id: string) => void;
  /** Full-height main area without page padding (inbox). */ fullBleed?: boolean;
} & ShellUser) {
  const [creating, setCreating] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const searchRef = useRef<HTMLInputElement>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const stats = useIssueStats(workspaceId);
  const counts = { "/inbox": stats.data?.counts.waiting_on_us, "/mine": stats.data?.counts.mine };
  const page = PAGE_TITLES.find(([p]) => (p === "/" ? pathname === "/" : pathname.startsWith(p)))?.[1] ?? "Overview";

  const toggleSidebar = () => setCollapsed((c) => {
    try { localStorage.setItem(SIDEBAR_KEY, c ? "full" : "rail"); } catch { /* not persisted */ }
    return !c;
  });
  // Focus the search box; on small screens it is hidden (cannot take focus), so open the inbox instead.
  const focusSearch = () => {
    searchRef.current?.focus();
    if (document.activeElement !== searchRef.current) void navigate({ to: "/inbox" });
  };

  // Global keys: "/" or ⌘K search, "?" shortcuts, "c" new issue (ux-spec §2.5).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); focusSearch(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || creating || shortcuts) return;
      if (e.key === "/") { e.preventDefault(); focusSearch(); }
      else if (e.key === "?") { e.preventDefault(); setShortcuts(true); }
      else if (e.key === "c") { e.preventDefault(); setCreating(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const sidebarProps = { collapsed, onToggle: toggleSidebar, onSearch: focusSearch, onShortcuts: () => setShortcuts(true), user: shellUser.user, workspaceName: shellUser.workspaceName, counts };
  return (
    <ShellContext.Provider value={{ openNewIssue: () => setCreating(true) }}>
      <div className="flex min-h-screen bg-bg text-fg">
        <Sidebar compact={false} {...sidebarProps} />
        <Sidebar compact {...sidebarProps} />
        <div className="flex min-w-0 flex-1 flex-col md:h-screen md:py-2 md:pr-2">
          <div className="flex min-h-0 flex-1 flex-col bg-panel md:overflow-hidden md:rounded-2xl md:border md:border-line md:shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <TopBar theme={theme} onToggleTheme={onToggleTheme} onNewIssue={() => setCreating(true)} onShortcuts={() => setShortcuts(true)}
              workspaces={workspaces} currentWorkspaceId={workspaceId} onSelectWorkspace={onSelectWorkspace} page={page} searchRef={searchRef} {...shellUser} />
            <main id="main" className={`min-h-0 flex-1 md:overflow-y-auto ${fullBleed ? "pb-24 md:pb-0" : "pb-28 md:pb-10"}`}>
              <div className={fullBleed ? "h-full" : "mx-auto w-full max-w-[1400px] px-4 pt-6 md:px-8"}>{children ?? <Outlet />}</div>
            </main>
          </div>
        </div>
        <BottomTabs />
        {creating && <NewIssueDialog workspaceId={workspaceId} onClose={() => setCreating(false)} />}
        {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
      </div>
    </ShellContext.Provider>
  );
}
