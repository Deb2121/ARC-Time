"use client";

/**
 * "Power BI og Excel" card on the reports page (D-028): the dataset addresses to paste into Power BI / Excel, and the
 * person's own read-only API tokens — create (shown once, with a copy button), see when last used, revoke.
 * Talks to /api-tokens (apps/api/src/routes/api-tokens.ts); the datasets come from the analytics service.
 */
import { Button, Card } from "@arc-tid/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { ANALYTICS_URL, ApiError, api } from "@/lib/api";
import { fmtDay } from "@/lib/format";

/** A token as listed (never the secret itself). */
interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** The datasets Power BI can load (see apps/analytics/arc_analytics/queries.py). */
export const DATASETS = [
  "time_entries",
  "project_kpis",
  "employee_kpis",
  "projects",
  "employees",
  "invoices",
] as const;

/** Card with dataset URLs and the person's Power BI tokens. */
export function PowerBiAccess() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const tokens = useQuery({ queryKey: ["api-tokens"], queryFn: () => api<TokenRow[]>("/api-tokens") });
  const [name, setName] = useState("Power BI");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fail = (e: unknown) =>
    setError(e instanceof ApiError ? t(`err.${e.code}` as MessageKey) : t("common.error"));
  const refresh = () => qc.invalidateQueries({ queryKey: ["api-tokens"] });
  const day = (iso: string) =>
    fmtDay(iso.slice(0, 10), locale, { day: "numeric", month: "short", year: "numeric" });
  const year = new Date().getFullYear();
  const active = (tokens.data ?? []).filter((tk) => !tk.revokedAt);
  const revokedCount = (tokens.data ?? []).length - active.length;

  async function create() {
    try {
      const r = await api<{ token: string }>("/api-tokens", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setFresh(r.token);
      setCopied(false);
      setError(null);
      await refresh();
    } catch (e) {
      fail(e);
    }
  }

  return (
    <Card title={t("pbi.title")}>
      <p className="mb-3 text-sm text-ink-700">{t("pbi.intro")}</p>
      <h3 className="mb-1 text-sm font-semibold text-ink-900">{t("pbi.datasets")}</h3>
      <ul className="mb-4 flex flex-col gap-1 text-xs">
        {DATASETS.map((d) => (
          <li key={d} className="flex flex-wrap gap-2">
            <span className="w-40 shrink-0 font-semibold text-ink-900">{t(`pbi.ds.${d}` as MessageKey)}</span>
            <code className="break-all text-ink-700">{`${ANALYTICS_URL}/v1/datasets/${d}?from=${year - 1}-01-01&to=${year}-12-31`}</code>
          </li>
        ))}
      </ul>

      <h3 className="mb-1 text-sm font-semibold text-ink-900">{t("pbi.tokens")}</h3>
      {fresh && (
        <div
          role="status"
          className="mb-3 flex flex-col gap-2 rounded-lg border border-line bg-surface-alt p-3 text-sm"
        >
          <span className="font-semibold text-ink-900">{t("pbi.copyNow")}</span>
          <code className="break-all">{fresh}</code>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => void navigator.clipboard.writeText(fresh).then(() => setCopied(true))}
            >
              {copied ? t("pbi.copied") : t("pbi.copy")}
            </Button>
            <Button variant="ghost" onClick={() => setFresh(null)}>
              {t("common.close")}
            </Button>
          </div>
        </div>
      )}
      <ul className="mb-3 divide-y divide-line text-sm">
        {active.map((tk) => (
          <li key={tk.id} className="flex flex-wrap items-center gap-3 py-2">
            <span className="flex-1">
              <span className="font-semibold text-ink-900">{tk.name}</span>{" "}
              <code className="text-xs text-ink-500">{tk.prefix}…</code>
              <span className="block text-xs text-ink-500">
                {tk.revokedAt
                  ? t("pbi.revoked", { date: day(tk.revokedAt) })
                  : t("pbi.meta", {
                      created: day(tk.createdAt),
                      expires: day(tk.expiresAt),
                      used: tk.lastUsedAt ? day(tk.lastUsedAt) : t("pbi.never"),
                    })}
              </span>
            </span>
            {!tk.revokedAt && (
              <Button
                variant="ghost"
                onClick={() =>
                  void api(`/api-tokens/${tk.id}`, { method: "DELETE" }).then(refresh).catch(fail)
                }
              >
                {t("pbi.revoke")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {active.length === 0 && <p className="mb-3 text-sm text-ink-500">{t("pbi.none")}</p>}
      {revokedCount > 0 && (
        <p className="mb-3 text-xs text-ink-500">{t("pbi.revokedCount", { count: revokedCount })}</p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-ink-900">{t("pbi.name")}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-10 w-72 rounded-[var(--radius-control)] border border-line bg-surface px-3"
          />
        </label>
        <Button disabled={name.trim().length < 2} onClick={() => void create()}>
          {t("pbi.create")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          ⚠ {error}
        </p>
      )}
      <p className="mt-3 text-xs text-ink-500">{t("pbi.hint")}</p>
    </Card>
  );
}
