"use client";

/**
 * "Alle funktioner": every place the person may use, in category cards. Kept off the home page so the home page
 * stays a calm overview of the person's own week; reached from the sidebar.
 */
import { HomeLauncher } from "@/components/home-launcher";
import { useI18n } from "@/i18n";

/** The page with all shortcuts, grouped by topic. */
export default function MenuPage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header>
        <h1 className="text-3xl font-normal">{t("nav.menu")}</h1>
        <p className="mt-2 text-ink-700">{t("menu.intro")}</p>
      </header>
      <HomeLauncher />
    </div>
  );
}
