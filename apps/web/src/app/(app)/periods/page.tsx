"use client";

import { Badge, Button, Card } from "@arc-tid/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useMe } from "@/components/session";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { ApiError, api, can } from "@/lib/api";
import { fmtDay, fmtHours, fmtKr, fmtPct } from "@/lib/format";

interface Period {
  id: string;
  month: string;
  status: "open" | "closed";
  closedAt: string | null;
  checklist: { code: string; count: number }[];
}
interface Report {
  month: string;
  wipTimeMaterial: number;
  wipByProject: { projectNumber: string; projectName: string; hours: number; value: number }[];
  fixedPrice: {
    contractId: string;
    projectNumber: string;
    projectName: string;
    price: number;
    completionBp: number;
    recognisedToDate: number;
    recognisedThisMonth: number;
    invoicedToDate: number;
    balance: number;
  }[];
  retainers: {
    contractId: string;
    projectNumber: string;
    projectName: string;
    invoiced: number;
    usedHours: number;
    poolHours: number;
    deferred: number;
  }[];
}

const th = "px-4 py-2 font-semibold";

export default function PeriodsPage() {
  const { t, locale } = useI18n();
  const me = useMe();
  const qc = useQueryClient();
  const canClose = can(me, "period.close");
  const periods = useQuery({ queryKey: ["periods"], queryFn: () => api<Period[]>("/periods") });
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; warnings: { code: string; count: number }[] } | null>(
    null,
  );
  const [reopening, setReopening] = useState<{ id: string; reason: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = periods.data ?? [];
  const month = selected ?? list.filter((p) => p.status === "open")[0]?.month ?? list.at(-1)?.month ?? null;
  const report = useQuery({
    queryKey: ["period-report", month],
    queryFn: () => api<Report>(`/periods/${month}/report`),
    enabled: Boolean(month),
  });

  const firstOpen = list.find((p) => p.status === "open");
  const lastClosed = [...list].reverse().find((p) => p.status === "closed");
  const label = (m: string) => fmtDay(m, locale, { month: "long", year: "numeric" });

  async function close(id: string, acknowledge: boolean) {
    try {
      const res = await api<{ closed: boolean; warnings: { code: string; count: number }[] }>(
        `/periods/${id}/close`,
        {
          method: "POST",
          body: JSON.stringify({ acknowledge }),
        },
      );
      setPending(res.closed ? null : { id, warnings: res.warnings });
      setError(null);
      await qc.invalidateQueries({ queryKey: ["periods"] });
      await qc.invalidateQueries({ queryKey: ["period-report"] });
    } catch (e) {
      setError(e instanceof ApiError ? t(`err.${e.code}` as MessageKey) : t("common.error"));
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header>
        <h1 className="text-3xl font-normal">{t("per.title")}</h1>
        <p className="mt-1 text-ink-700">{t("per.intro")}</p>
      </header>
      {error && (
        <p role="alert" className="text-sm text-danger">
          ⚠ {error}
        </p>
      )}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {list.map((p) => (
          <li
            key={p.id}
            className={`flex flex-col gap-2 rounded-lg border bg-surface p-4 ${month === p.month ? "border-brand-600" : "border-line"}`}
          >
            <button type="button" onClick={() => setSelected(p.month)} className="text-left">
              <span className="block font-semibold text-ink-900 first-letter:uppercase">
                {label(p.month)}
              </span>
              <Badge tone={p.status === "closed" ? "brand" : "neutral"}>
                {t(`per.status.${p.status}` as MessageKey)}
              </Badge>
            </button>
            {p.status === "open" &&
              p.checklist.map((w) => (
                <p key={w.code} className="text-xs text-warning">
                  ⚠ {t(`per.warn.${w.code}` as MessageKey, { count: w.count })}
                </p>
              ))}
            {canClose &&
              p.id === firstOpen?.id &&
              (pending?.id === p.id ? (
                <Button onClick={() => close(p.id, true)}>{t("per.closeAnyway")}</Button>
              ) : (
                <Button variant="secondary" onClick={() => close(p.id, false)}>
                  {t("per.close")}
                </Button>
              ))}
            {canClose && p.id === lastClosed?.id && !reopening && (
              <Button variant="ghost" onClick={() => setReopening({ id: p.id, reason: "" })}>
                {t("per.reopen")}
              </Button>
            )}
            {reopening?.id === p.id && (
              <form
                className="flex flex-col gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void api(`/periods/${p.id}/reopen`, {
                    method: "POST",
                    body: JSON.stringify({ reason: reopening.reason }),
                  })
                    .then(() => {
                      setReopening(null);
                      return qc.invalidateQueries({ queryKey: ["periods"] });
                    })
                    .catch((err) =>
                      setError(
                        err instanceof ApiError ? t(`err.${err.code}` as MessageKey) : t("common.error"),
                      ),
                    );
                }}
              >
                <input
                  aria-label={t("per.reopenReason")}
                  placeholder={t("per.reopenReason")}
                  required
                  value={reopening.reason}
                  onChange={(e) => setReopening({ ...reopening, reason: e.target.value })}
                  className="h-9 rounded-[var(--radius-control)] border border-line px-2 text-sm"
                />
                <Button type="submit">{t("per.reopen")}</Button>
              </form>
            )}
          </li>
        ))}
      </ul>

      {month && report.data && (
        <>
          <h2 className="text-2xl font-normal first-letter:uppercase">
            {t("per.report")} · {label(month)}
          </h2>
          <Card title={`${t("per.wip")}: ${fmtKr(report.data.wipTimeMaterial, locale)}`}>
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="border-y border-line bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th scope="col" className={`${th} text-left`}>
                      {t("pr.name")}
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      {t("inv.hours")}
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      {t("pr.value")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.data.wipByProject.map((w) => (
                    <tr key={w.projectNumber} className="border-b border-line">
                      <td className="px-4 py-2 text-ink-900">
                        <span className="text-ink-500">{w.projectNumber}</span> {w.projectName}
                      </td>
                      <td className="px-4 py-2 text-right">{fmtHours(w.hours, locale)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right">{fmtKr(w.value, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title={t("per.fixed")}>
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm tabular-nums">
                <thead className="border-y border-line bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th scope="col" className={`${th} text-left`}>
                      {t("pr.name")}
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      {t("pr.price")}
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      {t("per.completion")}
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      {t("per.recognisedToDate")}
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      {t("per.thisMonth")}
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      {t("per.invoicedToDate")}
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      {t("per.balance")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.data.fixedPrice.map((f) => (
                    <tr key={f.contractId} className="border-b border-line">
                      <td className="px-4 py-2 text-ink-900">
                        <span className="text-ink-500">{f.projectNumber}</span> {f.projectName}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right">{fmtKr(f.price, locale)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right">
                        {fmtPct(f.completionBp, locale)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right">
                        {fmtKr(f.recognisedToDate, locale)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right font-semibold text-ink-900">
                        {fmtKr(f.recognisedThisMonth, locale)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right">
                        {fmtKr(f.invoicedToDate, locale)}
                      </td>
                      <td
                        className={`whitespace-nowrap px-4 py-2 text-right ${f.balance < 0 ? "text-warning" : "text-ink-900"}`}
                      >
                        {fmtKr(f.balance, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title={t("per.retainers")}>
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="border-y border-line bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th scope="col" className={`${th} text-left`}>
                      {t("pr.name")}
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      {t("per.invoiced")}
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      {t("per.used")}
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      {t("per.pool")}
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      {t("per.deferred")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.data.retainers.map((r) => (
                    <tr key={r.contractId} className="border-b border-line">
                      <td className="px-4 py-2 text-ink-900">
                        <span className="text-ink-500">{r.projectNumber}</span> {r.projectName}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right">{fmtKr(r.invoiced, locale)}</td>
                      <td className="px-4 py-2 text-right">{fmtHours(r.usedHours, locale)}</td>
                      <td className="px-4 py-2 text-right">{fmtHours(r.poolHours, locale)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right font-semibold text-ink-900">
                        {fmtKr(r.deferred, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
