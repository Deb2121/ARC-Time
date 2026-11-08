"use client";

/**
 * DA/EN language toggle. Stores the choice in a cookie via the i18n provider (see src/i18n/index.tsx).
 */

import { type Locale, useI18n } from "@/i18n";

const NAMES: Record<Locale, string> = { da: "Dansk", en: "English" };

/** Two pressed-state buttons (Dansk / English) that switch the UI language immediately. */
export function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();
  return (
    <fieldset className="flex items-center gap-1 text-xs">
      <legend className="sr-only">{t("common.language")}</legend>
      {(["da", "en"] as Locale[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          aria-label={NAMES[l]}
          lang={l}
          className={`rounded px-2 py-1 font-semibold uppercase ${locale === l ? "bg-ink-900 text-white" : "text-ink-500 hover:text-ink-900"}`}
        >
          {l}
        </button>
      ))}
    </fieldset>
  );
}
