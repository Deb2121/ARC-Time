"use client";

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { da, type MessageKey } from "./da";
import { en } from "./en";

export type Locale = "da" | "en";
const dictionaries: Record<Locale, Record<MessageKey, string>> = { da, en };
export const LOCALE_COOKIE = "arc_locale";

interface I18n {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ initial, children }: { initial: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initial);
  const setLocale = useCallback((l: Locale) => {
    // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API is not available in all supported browsers
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l;
    setLocaleState(l);
  }, []);
  const t = useCallback<I18n["t"]>(
    (key, vars) => {
      let s = dictionaries[locale][key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    },
    [locale],
  );
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n outside I18nProvider");
  return v;
}
