"use client";

/**
 * Application frame: top bar (wordmark, language, user, sign out) and the main navigation, grouped by category.
 * The places themselves (and who sees them) are declared once in navigation.tsx. Server-side checks still apply.
 */

import { Wordmark } from "@arc-tid/ui";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { api, setCsrfToken } from "@/lib/api";
import { LanguageSwitch } from "./language-switch";
import { NavIcon, type NavItem, useNavigation } from "./navigation";
import { useMe } from "./session";

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

  const { home, groups } = useNavigation();
  const link = (n: NavItem) => {
    const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
    return (
      <li key={n.href}>
        <Link
          href={n.href}
          aria-current={active ? "page" : undefined}
          className={`relative flex items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-1.5 text-sm font-semibold ${
            active ? "bg-brand-50 text-brand-800" : "text-ink-700 hover:bg-surface-alt"
          }`}
        >
          {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded bg-brand-600" />}
          <NavIcon
            name={n.icon}
            className={`h-4 w-4 shrink-0 ${active ? "text-brand-700" : "text-ink-500"}`}
          />
          {t(n.label)}
        </Link>
      </li>
    );
  };

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
          className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 overflow-y-auto border-r border-line bg-surface p-3 md:block"
        >
          {home && <ul className="mb-2 flex flex-col gap-0.5">{link(home)}</ul>}
          {groups.map((g) => (
            <div key={g.category} className="mb-2">
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                {t(`navc.${g.category}` as MessageKey)}
              </p>
              <ul className="flex flex-col gap-0.5">{g.items.map(link)}</ul>
            </div>
          ))}
        </nav>
        <main id="main" className="min-w-0 flex-1 p-6 lg:p-10">
          {children}
        </main>
      </div>
    </div>
  );
}
