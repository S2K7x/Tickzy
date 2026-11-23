import type { ReactNode } from "react";
import { Link, Outlet } from "@tanstack/react-router";
import { NAV, type NavItem } from "./nav.ts";
import { Logo, MenuIcon, MoonIcon, PlusIcon, SearchIcon, SunIcon } from "./icons.tsx";
import type { Theme } from "../theme.ts";
import type { SessionUser } from "../lib/api.ts";

export interface ShellUser {
  user: SessionUser;
  workspaceName: string;
  onSignOut: () => void;
}

function initials(u: SessionUser): string {
  const source = u.name.trim() || u.email.split("@")[0] || "?";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

const GROUP_LABEL: Record<NavItem["group"], string> = { support: "Support", ai: "AI & insights", system: "Workspace" };

function SidebarLink({ item, compact }: { item: NavItem; compact: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      aria-label={compact ? item.label : undefined}
      title={compact ? item.label : undefined}
      activeOptions={{ exact: item.to === "/" }}
      className={`flex min-h-10 items-center gap-2.5 rounded-[10px] text-sm text-muted no-underline hover:text-fg ${compact ? "justify-center px-0" : "px-2.5"}`}
      activeProps={{ "aria-current": "page", className: "bg-surface-2 font-semibold !text-fg shadow-[inset_0_0_0_1px_var(--border)]" }}
    >
      <Icon size={18} />
      {!compact && <span className="flex-1">{item.label}</span>}
    </Link>
  );
}

/** ≥1280px: full sidebar · 768–1279px: icon rail (ux-spec §2.6). */
function Sidebar({ compact }: { compact: boolean }) {
  const groups = (["support", "ai", "system"] as const).map((g) => ({ g, items: NAV.filter((n) => n.group === g) }));
  return (
    <nav
      aria-label="Primary"
      data-testid={compact ? "icon-rail" : "sidebar"}
      className={`${compact ? "hidden md:flex xl:hidden w-16 items-center" : "hidden xl:flex w-[248px]"} sticky top-0 h-screen shrink-0 flex-col gap-5 border-r border-line bg-surface px-3 py-4`}
    >
      <Link to="/" className="flex items-center gap-2.5 px-1 text-fg no-underline">
        <Logo />
        {!compact && <span className="text-[19px] font-bold tracking-tight">Tickzy</span>}
      </Link>
      {groups.map(({ g, items }) => (
        <div key={g} className="flex w-full flex-col gap-0.5">
          {!compact && <span className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{GROUP_LABEL[g]}</span>}
          {items.map((item) => (
            <SidebarLink key={item.to} item={item} compact={compact} />
          ))}
        </div>
      ))}
    </nav>
  );
}

/** <768px: bottom tab bar with 4 primary destinations + More. */
function BottomTabs() {
  const items = NAV.filter((n) => n.mobile);
  return (
    <nav aria-label="Primary" data-testid="bottom-tabs" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line bg-surface px-1 pb-[max(env(safe-area-inset-bottom),12px)] pt-1.5 md:hidden">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: item.to === "/" }}
            className="flex min-h-[52px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted no-underline"
            activeProps={{ "aria-current": "page", className: "font-semibold !text-accent-fg" }}
          >
            <Icon size={22} />
            {item.label === "My issues" ? "Mine" : item.label}
          </Link>
        );
      })}
      <Link to="/more" className="flex min-h-[52px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted no-underline" activeProps={{ "aria-current": "page", className: "font-semibold !text-accent-fg" }}>
        <MenuIcon size={22} />
        More
      </Link>
    </nav>
  );
}

function TopBar({ theme, onToggleTheme, user, workspaceName, onSignOut }: { theme: Theme; onToggleTheme: () => void } & ShellUser) {
  const iconBtn = "inline-flex h-10 w-10 items-center justify-center rounded-[11px] border border-line bg-surface text-fg";
  return (
    <header className="sticky top-0 z-10 flex min-h-[64px] items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 md:px-8">
      <div className="flex items-center gap-2 md:hidden">
        <Logo size={28} />
      </div>
      <label className="hidden h-10 min-w-0 max-w-[420px] flex-1 items-center gap-2.5 rounded-[11px] border border-line bg-surface-2 px-3 text-muted sm:flex">
        <SearchIcon size={16} />
        <span className="sr-only">Search</span>
        <input type="search" placeholder="Search issues, accounts, messages" className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-fg outline-none" />
        <kbd className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-muted">⌘K</kbd>
      </label>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" aria-label="Search" className={`${iconBtn} sm:hidden`}>
          <SearchIcon size={18} />
        </button>
        <button type="button" disabled title="Creating issues arrives in M2" className="hidden h-10 cursor-not-allowed items-center gap-2 whitespace-nowrap rounded-[11px] bg-accent px-3.5 text-[13px] font-semibold text-white opacity-60 lg:inline-flex">
          <PlusIcon size={16} />
          New issue
        </button>
        <button type="button" onClick={onToggleTheme} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} className={iconBtn}>
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
        <span className="mx-1 hidden h-7 w-px bg-line sm:block" aria-hidden="true" />
        <div className="hidden items-center gap-2.5 sm:flex">
          <span aria-hidden="true" title={`${user.email} · ${workspaceName}`} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[13px] font-bold text-accent-fg">{initials(user)}</span>
          <span className="hidden flex-col leading-tight lg:flex">
            <span className="max-w-[180px] truncate text-[13px] font-semibold" title={user.email}>{user.name || user.email}</span>
            <span className="max-w-[180px] truncate text-xs text-muted">{workspaceName}</span>
          </span>
        </div>
        <button type="button" onClick={onSignOut} className="inline-flex h-10 shrink-0 items-center whitespace-nowrap rounded-[11px] border border-line bg-surface px-3 text-[13px] font-medium text-fg">
          Sign out
        </button>
      </div>
    </header>
  );
}

export function AppShell({ theme, onToggleTheme, children, ...shellUser }: { theme: Theme; onToggleTheme: () => void; children?: ReactNode } & ShellUser) {
  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <Sidebar compact={false} />
      <Sidebar compact />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar theme={theme} onToggleTheme={onToggleTheme} {...shellUser} />
        <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 px-4 pb-28 pt-6 md:px-8 md:pb-10">
          {children ?? <Outlet />}
        </main>
      </div>
      <BottomTabs />
    </div>
  );
}
