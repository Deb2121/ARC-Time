"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { I18nProvider, type Locale } from "@/i18n";

export function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <I18nProvider initial={locale}>{children}</I18nProvider>
    </QueryClientProvider>
  );
}
