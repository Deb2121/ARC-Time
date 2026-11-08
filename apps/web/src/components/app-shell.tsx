"use client";

/**
 * Application frame: top bar (wordmark, language, user, sign out) and the role-filtered main navigation.
 * Navigation items are declared in NAV; each lists the roles that see it. Server-side checks still apply.
 */

import { hasRole, type Role } from "@arc-tid/domain";
import { Wordmark } from "@arc-tid/ui";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { api, setCsrfToken } from "@/lib/api";
import { LanguageSwitch } from "./language-switch";
import { useMe } from "./session";

interface NavItem {
  href: string;
  label: MessageKey;
  roles?: Role[]; // visible to anyone with one of these roles; undefined = everyone
  ready: boolean; // false = placeholder until its milestone ships
}

const NAV: NavItem[] = [
  { href: "/", label: "nav.home", ready: true },
  { href: "/timesheet", label: "nav.timesheet", ready: true },
  { href: "/approval", label: "nav.approval", roles: ["line_manager", "admin", "finance"], ready: true },
  { href: "/projects", label: "nav.projects", ready: true },
  {
    href: "/customers",
    label: "nav.customers",
    roles: ["project_manager", "finance", "admin", "management"],
    ready: true,
  },
  {
    href: "/planning",
    label: "nav.planning",
    roles: ["project_manager", "line_manager", "admin"],
    ready: false,
  },
  { href: "/invoicing", label: "nav.invoicing", roles: ["finance", "admin", "project_manager"], ready: true },
  { href: "/periods", label: "nav.periods", roles: ["finance", "admin", "management"], ready: true },
  { href: "/reports", label: "nav.reports", ready: true },
  { href: "/admin/settings", label: "nav.settings", roles: ["admin", "finance"], ready: true },
  {
    href: "/admin/price-lists",
    label: "nav.priceLists",
    roles: ["finance", "admin", "project_manager", "management"],
    ready: true,
  },
  {
    href: "/admin/people",
    label: "nav.people",
    roles: ["admin", "finance", "management", "line_manager"],
    ready: true,
  },
];

/** Wraps every signed-in page with the top bar, navigation and a skip-to-content link. */
export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    setCsrfToken(null);
    qc.clear();
    router.replace("/login");
  }

  const items = NAV.filter((n) => !n.roles || hasRole(me.roles, ...n.roles));

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:p-3"
      >
        {t("app.skipToContent")}
      </a>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface px-5">
        <Link href="/" className="rounded">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-4">
          <LanguageSwitch />
          <span
            className="grid h-8 w-8 place-items-center rounded-full bg-ink-900 text-xs font-semibold text-white"
            title={me.fullName}
          >
            {me.initials}
          </span>
          <button type="button" onClick={logout} className="text-sm text-ink-700 hover:text-ink-900">
            {t("auth.logout")}
          </button>
        </div>
      </header>
      <div className="flex">
        <nav
          aria-label={t("nav.main")}
          className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 border-r border-line bg-surface p-3 md:block"
        >
          <ul className="flex flex-col gap-0.5">
            {items.map((n) => {
              const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
              if (!n.ready) {
                return (
                  <li key={n.href}>
                    <span
                      aria-disabled="true"
                      className="flex items-center justify-between rounded-[var(--radius-control)] px-3 py-2 text-sm text-ink-500"
                    >
                      {t(n.label)}
                      <span className="text-[10px] uppercase tracking-wide">{t("nav.comingSoon")}</span>
                    </span>
                  </li>
                );
              }
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={`relative block rounded-[var(--radius-control)] px-3 py-2 text-sm font-semibold ${
                      active ? "bg-brand-50 text-brand-800" : "text-ink-700 hover:bg-surface-alt"
                    }`}
                  >
                    {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded bg-brand-600" />}
                    {t(n.label)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <main id="main" className="min-w-0 flex-1 p-6 lg:p-10">
          {children}
        </main>
      </div>
    </div>
  );
}
