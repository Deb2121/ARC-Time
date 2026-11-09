"use client";

import { addDays, todayCopenhagen } from "@arc-tid/domain";
import { Card, TextField } from "@arc-tid/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PowerBiAccess } from "@/components/power-bi-access";
import { HealthDot } from "@/components/progress";
import { useMe } from "@/components/session";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { ANALYTICS_URL, API_URL, api, can } from "@/lib/api";
import { fmtHours, fmtKr, fmtPct } from "@/lib/format";
import type { ProjectSummary } from "../projects/page";

const downloadLink =
  "inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-4 text-sm font-semibold text-ink-900 hover:bg-surface-alt";

export default function ReportsPage() {
  const { t, locale } = useI18n();
  const me = useMe();
  const seesKpis = can(me, "kpi.company");
  const rows = useQuery({
    queryKey: ["budget-actual"],
    queryFn: () => api<ProjectSummary[]>("/reports/budget-actual"),
  });
  const today = todayCopenhagen();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const h = (c: number) => fmtHours(c / 100, locale);
  const total = (rows.data ?? []).reduce(
    (a, r) => ({
      bh: a.bh + r.budgetHours,
      uh: a.uh + r.usedHours,
      v: a.v + r.usedValue,
      c: a.c + r.usedCost,
    }),
    { bh: 0, uh: 0, v: 0, c: 0 },
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <h1 className="text-3xl font-normal">{t("rp.title")}</h1>

      <Card title={t("rp.budgetActual")}>
        <div className="mb-4">
          <a className={downloadLink} href={`${API_URL}/api/v1/reports/budget-actual?format=csv`}>
            ↓ {t("common.download")}
          </a>
        </div>
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm tabular-nums">
            <thead className="border-y border-line bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th scope="col" className="px-5 py-2 text-left font-semibold">
                  {t("pr.name")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  {t("pr.budget")} t
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  {t("pr.used")} t
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  %
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  {t("pr.value")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  {t("pr.cost")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  {t("pr.margin")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  {t("pr.marginPct")}
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  {t("pr.health")}
                </th>
              </tr>
            </thead>
            <tbody>
              {(rows.data ?? []).map((r) => (
                <tr key={r.id} className="border-b border-line">
                  <td className="px-5 py-2 text-ink-900">
                    <span className="text-ink-500">{r.number}</span> {r.name}
                  </td>
                  <td className="px-3 py-2 text-right">{h(r.budgetHours)}</td>
                  <td className="px-3 py-2 text-right">{h(r.usedHours)}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(r.hoursConsumptionBp, locale)}</td>
                  <td className="px-3 py-2 text-right">{fmtKr(r.usedValue, locale)}</td>
                  <td className="px-3 py-2 text-right">{fmtKr(r.usedCost, locale)}</td>
                  <td className="px-3 py-2 text-right">{fmtKr(r.contributionMargin, locale)}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(r.marginBp, locale)}</td>
                  <td className="px-3 py-2">
                    <HealthDot health={r.health} label={t(`pr.health.${r.health}` as MessageKey)} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="font-semibold text-ink-900">
              <tr>
                <th scope="row" className="px-5 py-2 text-left">
                  {t("common.total")}
                </th>
                <td className="px-3 py-2 text-right">{h(total.bh)}</td>
                <td className="px-3 py-2 text-right">{h(total.uh)}</td>
                <td className="px-3 py-2 text-right">
                  {total.bh ? fmtPct(Math.round((total.uh * 10000) / total.bh), locale) : "–"}
                </td>
                <td className="px-3 py-2 text-right">{fmtKr(total.v, locale)}</td>
                <td className="px-3 py-2 text-right">{fmtKr(total.c, locale)}</td>
                <td className="px-3 py-2 text-right">{fmtKr(total.v - total.c, locale)}</td>
                <td className="px-3 py-2 text-right">
                  {total.v ? fmtPct(Math.round(((total.v - total.c) * 10000) / total.v), locale) : "–"}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card title={t("rp.timeEntries")}>
        <p className="mb-4 text-sm text-ink-700">{t("rp.timeEntriesIntro")}</p>
        <div className="flex flex-wrap items-end gap-3">
          <TextField
            label={t("rp.from")}
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
          <TextField
            label={t("rp.to")}
            type="date"
            value={to}
            min={from}
            max={addDays(today, 365)}
            onChange={(e) => setTo(e.target.value)}
          />
          <a
            className={downloadLink}
            href={`${API_URL}/api/v1/reports/time-entries?from=${from}&to=${to}&format=csv`}
          >
            ↓ {t("common.download")}
          </a>
          {seesKpis && (
            <a className={downloadLink} href={`${ANALYTICS_URL}/v1/kpi.xlsx?from=${from}&to=${to}`}>
              ↓ {t("rp.kpiExcel")}
            </a>
          )}
        </div>
        {seesKpis && <p className="mt-3 text-xs text-ink-500">{t("rp.kpiExcelHint")}</p>}
      </Card>

      {can(me, "analytics.token") && <PowerBiAccess />}
    </div>
  );
}
