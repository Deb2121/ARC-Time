"use client";

/**
 * Friendly error page for users: shown instead of technical details when a page fails. The details go to the
 * browser console only (for developers); the user gets a plain message and a way to try again.
 */
import { Button } from "@arc-tid/ui";
import Link from "next/link";
import { useEffect } from "react";
import { useI18n } from "@/i18n";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto flex max-w-lg flex-col items-start gap-4 px-6 py-24">
      <h1 className="text-2xl font-normal">{t("errpage.title")}</h1>
      <p className="text-ink-700">{t("errpage.body")}</p>
      <div className="flex gap-3">
        <Button onClick={reset}>{t("errpage.retry")}</Button>
        <Link
          href="/"
          className="inline-flex h-10 items-center rounded-[var(--radius-control)] px-4 text-sm font-semibold text-ink-700 hover:bg-surface-alt"
        >
          {t("errpage.home")}
        </Link>
      </div>
      {error.digest && <p className="text-xs text-ink-500">{t("errpage.ref", { ref: error.digest })}</p>}
    </main>
  );
}
