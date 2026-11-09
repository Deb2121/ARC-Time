"use client";

/**
 * The one list of places in the app (GRASP Information Expert for navigation): each item has a category, a short
 * description and an icon, and says who sees it (roles, or a capability from the server's role matrix — D-025).
 * The sidebar (app-shell.tsx) and the home page shortcuts (home-launcher.tsx) both read it, so they never drift.
 * Server-side checks still apply; this only decides what is shown.
 */
import { type Capability, hasRole, type Role } from "@arc-tid/domain";
import type { MessageKey } from "@/i18n/da";
import { useMe } from "./session";

/** Groups in the sidebar and on the home page, in display order. */
export const CATEGORIES = ["time", "team", "projects", "finance", "insight", "admin"] as const;
export type Category = (typeof CATEGORIES)[number];

/** Icon names drawn by <NavIcon>. */
export type IconName =
  | "home"
  | "clock"
  | "receipt"
  | "check"
  | "calendar"
  | "folder"
  | "building"
  | "invoice"
  | "lock"
  | "wallet"
  | "tag"
  | "chart"
  | "shield"
  | "users"
  | "cog"
  | "upload";

/** One place in the app. */
export interface NavItem {
  href: string;
  label: MessageKey;
  /** one line for the home page shortcut */
  description: MessageKey;
  category: Category | "home";
  icon: IconName;
  /** visible to anyone with one of these roles; undefined = everyone */
  roles?: Role[];
  /** or: visible when the role matrix allows this action */
  capability?: Capability;
}

/** All places, in sidebar order within each category. */
export const NAV: NavItem[] = [
  { href: "/", label: "nav.home", description: "nav.home", category: "home", icon: "home" },
  {
    href: "/timesheet",
    label: "nav.timesheet",
    description: "navd.timesheet",
    category: "time",
    icon: "clock",
  },
  {
    href: "/expenses",
    label: "nav.expenses",
    description: "navd.expenses",
    category: "time",
    icon: "receipt",
  },
  {
    href: "/approval",
    label: "nav.approval",
    description: "navd.approval",
    category: "team",
    icon: "check",
    roles: ["line_manager", "admin", "finance", "project_manager"],
  },
  {
    href: "/planning",
    label: "nav.planning",
    description: "navd.planning",
    category: "team",
    icon: "calendar",
    roles: ["project_manager", "line_manager", "admin", "finance", "management"],
  },
  {
    href: "/projects",
    label: "nav.projects",
    description: "navd.projects",
    category: "projects",
    icon: "folder",
  },
  {
    href: "/customers",
    label: "nav.customers",
    description: "navd.customers",
    category: "projects",
    icon: "building",
    roles: ["project_manager", "finance", "admin", "management"],
  },
  {
    href: "/invoicing",
    label: "nav.invoicing",
    description: "navd.invoicing",
    category: "finance",
    icon: "invoice",
    roles: ["finance", "admin", "project_manager"],
  },
  {
    href: "/periods",
    label: "nav.periods",
    description: "navd.periods",
    category: "finance",
    icon: "lock",
    capability: "period.view",
  },
  {
    href: "/payroll",
    label: "nav.payroll",
    description: "navd.payroll",
    category: "finance",
    icon: "wallet",
    capability: "payroll.export",
  },
  {
    href: "/admin/price-lists",
    label: "nav.priceLists",
    description: "navd.priceLists",
    category: "finance",
    icon: "tag",
    roles: ["finance", "admin", "project_manager", "management"],
  },
  { href: "/reports", label: "nav.reports", description: "navd.reports", category: "insight", icon: "chart" },
  {
    href: "/admin/audit",
    label: "nav.audit",
    description: "navd.audit",
    category: "insight",
    icon: "shield",
    capability: "audit.read",
  },
  {
    href: "/admin/people",
    label: "nav.people",
    description: "navd.people",
    category: "admin",
    icon: "users",
    roles: ["admin", "finance", "management", "line_manager"],
  },
  {
    href: "/admin/settings",
    label: "nav.settings",
    description: "navd.settings",
    category: "admin",
    icon: "cog",
    capability: "settings.read",
  },
  {
    href: "/admin/import",
    label: "nav.import",
    description: "navd.import",
    category: "admin",
    icon: "upload",
    capability: "data.import",
  },
];

/** The places the signed-in person may see, grouped by category (empty categories left out). */
export function useNavigation() {
  const me = useMe();
  const visible = NAV.filter((n) =>
    n.capability ? me.capabilities.includes(n.capability) : !n.roles || hasRole(me.roles, ...n.roles),
  );
  const groups = CATEGORIES.map((category) => ({
    category,
    items: visible.filter((n) => n.category === category),
  })).filter((g) => g.items.length > 0);
  return { home: visible.find((n) => n.category === "home"), groups };
}

/** SVG path data per icon (24×24, stroke-based, in the style of the design system). */
const PATHS: Record<IconName, string> = {
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3",
  check: "M4 12l5 5L20 6",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  folder: "M3 6h6l2 2h10v11H3z",
  building: "M5 21V4h10v17M15 9h4v12M8 8h2M8 12h2M8 16h2M3 21h18",
  invoice: "M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  wallet: "M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H3zM3 7l12-4v4M17 14h2",
  tag: "M3 12V4h8l10 10-8 8zM7.5 8.5h.01",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4",
  users:
    "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6",
  cog: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
};

/** A small line icon for navigation (decorative — the text next to it is the label). */
export function NavIcon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
