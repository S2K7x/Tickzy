import type { ComponentType } from "react";
import { AccountsIcon, BookIcon, ChartIcon, InboxIcon, MineIcon, OverviewIcon, SettingsIcon, SparkIcon } from "./icons.tsx";

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  group: "support" | "ai" | "system";
  /** Shown in the phone bottom tab bar (max 4 + "More"). */
  mobile?: boolean;
}

/** Information architecture — docs/ux/ux-spec.md §1. */
export const NAV: NavItem[] = [
  { to: "/", label: "Overview", icon: OverviewIcon, group: "support", mobile: true },
  { to: "/inbox", label: "Inbox", icon: InboxIcon, group: "support", mobile: true },
  { to: "/mine", label: "My issues", icon: MineIcon, group: "support", mobile: true },
  { to: "/accounts", label: "Accounts", icon: AccountsIcon, group: "support", mobile: true },
  { to: "/ai", label: "AI agent", icon: SparkIcon, group: "ai" },
  { to: "/knowledge", label: "Knowledge", icon: BookIcon, group: "ai" },
  { to: "/analytics", label: "Analytics", icon: ChartIcon, group: "ai" },
  { to: "/settings", label: "Settings", icon: SettingsIcon, group: "system" },
];
