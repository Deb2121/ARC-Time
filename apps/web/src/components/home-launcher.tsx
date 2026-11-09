"use client";

/**
 * "Hvad vil du gøre?" on the home page: every place the person may use, grouped in category cards with an icon,
 * a name and one line about what it is for. Reads the same list as the sidebar (navigation.tsx), so it only shows
 * what the server's role matrix allows.
 */
import Link from "next/link";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { NavIcon, useNavigation } from "./navigation";

/** Category cards with shortcuts to each place. */
export function HomeLauncher() {
  const { t } = useI18n();
  const { groups } = useNavigation();
  return (
    <section aria-labelledby="launcher-title" className="flex flex-col gap-3">
      <h2 id="launcher-title" className="text-lg font-medium">
        {t("home.launcher")}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => (
          <div key={g.category} className="rounded-lg border border-line bg-surface p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
              {t(`navc.${g.category}` as MessageKey)}
            </h3>
            <ul className="flex flex-col gap-1">
              {g.items.map((n) => (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    className="group flex items-start gap-3 rounded-[var(--radius-control)] p-2 hover:bg-surface-alt"
                  >
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700 group-hover:bg-brand-600 group-hover:text-white">
                      <NavIcon name={n.icon} className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink-900">{t(n.label)}</span>
                      <span className="block text-xs text-ink-500">{t(n.description)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
