"use client";

import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { SessionGate } from "@/components/session";
import { useI18n } from "@/i18n";

export default function AppLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <SessionGate fallback={<p className="p-10 text-ink-500">{t("common.loading")}</p>}>
      <AppShell>{children}</AppShell>
    </SessionGate>
  );
}
