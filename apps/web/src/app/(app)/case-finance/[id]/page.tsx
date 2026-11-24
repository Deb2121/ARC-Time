"use client";

/**
 * Case finance page (D-029): honorarform, fee / forbrugt / faktureret / ikke faktureret / rest, the fee warning,
 * phase budget (with ekstraarbejde flags and — when switched on — % complete and a conto), hours per employee,
 * the billing plan and the invoice history with payment status.
 */
import { Button, Card } from "@arc-tid/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { BillingPlan, type Plan } from "@/components/case-finance/billing-plan";
import {
  type CaseRow,
  CaseStatusPill,
  DebtStatusPill,
  FeeTypePill,
  type ReceivableRow,
  Tile,
} from "@/components/case-finance/shared";
import { Subconsultants } from "@/components/case-finance/subconsultants";
import { PhaseStatusButton } from "@/components/case-lifecycle";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { fmtDay, fmtHours, fmtKr, fmtPct } from "@/lib/format";

interface Phase {
  id: string;
  wbs: string;
  name: string;
  level: number;
  status: "open" | "closed";
  extraWork: boolean;
  budgetHours: number;
  budgetAmount: number;
  hours: number;
  forbrugt: number;
  completionBp: number | null;
  acontoInvoiced: number;
  acontoSuggestion: number | null;
}
interface Detail extends CaseRow {
  phases: Phase[];
  employees: { userId: string; name: string; initials: string; hours: number; forbrugt: number }[];
  plans: Plan[];
  invoices: {
    booked: ReceivableRow[];
    drafts: { id: string; invoiceDate: string; subtotal: number; total: number; status: string }[];
  };
  settings: { warningBp: number; alertBp: number; acontoEnabled: boolean };
  canEdit: boolean;
  canInvoice: boolean;
}

export default function CaseFinanceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["case-finance-detail", id],
    queryFn: () => api<Detail>(`/case-finance/cases/${id}`),
  });
  const [error, setError] = useState<string | null>(null);
  if (q.isError) return <p className="text-danger">{errorText(q.error, t)}</p>;
  if (q.isLoading || !q.data) return <p className="text-ink-500">{t("common.loading")}</p>;
  const d = q.data;
  const kr = (n: number | null | undefined) => fmtKr(n, locale);
  const date = (s: string) => fmtDay(s, locale, { day: "numeric", month: "short", year: "numeric" });
  const fixed = d.feeType === "fast_honorar";
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["case-finance-detail", id] });
    void qc.invalidateQueries({ queryKey: ["case-finance"] });
  };
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError(null);
      refresh();
    } catch (e) {
      setError(errorText(e, t));
    }
  };
  const patchTask = (taskId: string, body: object) =>
    run(() => api(`/case-finance/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(body) }));

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header>
        <Link href="/case-finance" className="text-sm text-ink-500 hover:text-ink-900">
          ← {t("cf.back")}
        </Link>
        <h1 className="mt-2 text-3xl font-normal">
          <span className="text-ink-500">{d.number}</span> {d.name}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-ink-700">
          <span>{d.customerName}</span>
          <span>·</span>
          <span>
            {t("cf.col.manager")}: {d.managerName ?? "–"}
          </span>
          <FeeTypePill feeType={d.feeType} />
          <CaseStatusPill status={d.caseStatus} />
          <Link href={`/projects/${d.id}`} className="text-ink-500 hover:text-brand-700">
            {t("cf.openCase")} →
          </Link>
        </p>
      </header>

      {d.feeWarning && (
        <p
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm font-semibold ${d.feeLevel === "alert" ? "border-danger/40 bg-danger/10 text-danger" : "border-warning/40 bg-warning/10 text-warning"}`}
        >
          ⚠ {d.feeWarning}
        </p>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" aria-label={t("cf.title")}>
        <Tile
          label={t("cf.col.hours")}
          value={fmtHours(d.hours, locale)}
          sub={`${t("cf.col.kostpris")} ${kr(d.kostpris)}${d.underraadgivere ? ` · ${t("lc.ofWhichSubs", { amount: kr(d.underraadgivere) })}` : ""}`}
        />
        <Tile label={t("cf.col.forbrugt")} value={kr(d.forbrugt)} />
        <Tile label={t("cf.col.faktureret")} value={kr(d.faktureret)} />
        <Tile label={t("cf.col.ikkeFaktureret")} value={kr(d.ikkeFaktureret)} />
        {fixed ? (
          <Tile
            label={t("cf.case.rest")}
            value={kr(d.resthonorar)}
            sub={`${t("cf.case.fee")} ${kr(d.fee)} · ${t("cf.case.pct")} ${fmtPct(d.forbrugtPct, locale)}`}
            tone={d.feeLevel === "alert" ? "danger" : undefined}
          />
        ) : (
          <Tile label={t("cf.case.fee")} value="–" sub={t("cf.fee.medgaaet_tid")} />
        )}
      </section>

      {error && (
        <p role="alert" className="text-sm text-danger">
          ⚠ {error}
        </p>
      )}

      <div className="flex flex-col gap-5">
        <Card title={t("cf.case.phases")} className="min-w-0">
          {fixed && <p className="-mt-2 mb-3 text-xs text-ink-500">{t("cf.case.extraWorkHint")}</p>}
          <div className="relative -mx-5 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-y border-line bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th scope="col" className="px-5 py-2 text-left font-semibold">
                    {t("cf.case.phase")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    {t("cf.case.budget")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    {t("cf.col.hours")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    {t("cf.col.forbrugt")}
                  </th>
                  {d.settings.acontoEnabled && fixed && (
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      {t("cf.case.completion")}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {d.phases.map((p) => (
                  <tr key={p.id} className="border-b border-line align-top last:border-0">
                    <td className="px-5 py-2" style={{ paddingLeft: `${1.25 + (p.level - 1) * 1.25}rem` }}>
                      <span className={p.level === 1 ? "font-semibold text-ink-900" : "text-ink-900"}>
                        <span className="mr-2 text-ink-500 tabular-nums">{p.wbs}</span>
                        {p.name}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        {p.extraWork && (
                          <span className="font-semibold text-brand-700">{t("cf.case.extraWork")}</span>
                        )}
                        {p.status === "closed" && <span className="text-ink-500">{t("cf.case.closed")}</span>}
                        {d.canEdit && p.level === 1 && (
                          <PhaseStatusButton
                            caseId={d.id}
                            taskId={p.id}
                            name={p.name}
                            closed={p.status === "closed"}
                          />
                        )}
                        {fixed && d.canEdit && (
                          <button
                            type="button"
                            className="text-ink-500 hover:text-brand-700"
                            onClick={() => patchTask(p.id, { extraWork: !p.extraWork })}
                          >
                            {p.extraWork ? t("cf.case.unmarkExtra") : t("cf.case.markExtra")}
                          </button>
                        )}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {fmtHours(p.budgetHours, locale)} t
                      {p.budgetAmount > 0 && (
                        <span className="block text-xs text-ink-500">{kr(p.budgetAmount)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtHours(p.hours, locale)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{kr(p.forbrugt)}</td>
                    {d.settings.acontoEnabled && fixed && (
                      <td className="px-3 py-2 text-right">
                        {!p.extraWork && p.budgetAmount > 0 && (
                          <span className="flex flex-col items-end gap-1">
                            <input
                              aria-label={`${t("cf.case.completion")} ${p.name}`}
                              inputMode="decimal"
                              defaultValue={
                                p.completionBp === null ? "" : String(p.completionBp / 100).replace(".", ",")
                              }
                              disabled={!d.canEdit}
                              onBlur={(e) => {
                                const v = e.target.value.trim();
                                const pct = v === "" ? null : Number(v.replace(",", "."));
                                if (pct === (p.completionBp === null ? null : p.completionBp / 100)) return;
                                void patchTask(p.id, { completion: pct });
                              }}
                              className="h-8 w-16 rounded border border-line bg-surface px-2 text-right tabular-nums"
                            />
                            {d.canInvoice && (p.acontoSuggestion ?? 0) > 0 && (
                              <Button
                                variant="secondary"
                                className="h-8 px-2 text-xs"
                                onClick={() =>
                                  run(() =>
                                    api(`/case-finance/tasks/${p.id}/aconto-invoice`, { method: "POST" }),
                                  )
                                }
                              >
                                {t("cf.case.acontoInvoice", { amount: kr(p.acontoSuggestion) })}
                              </Button>
                            )}
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid items-start gap-5 lg:grid-cols-[3fr_2fr]">
          <div className="flex min-w-0 flex-col gap-5">
            {d.plans.map((plan) => (
              <BillingPlan
                key={plan.contractId}
                plan={plan}
                phases={d.phases}
                caseId={d.id}
                canEdit={d.canEdit}
                canInvoice={d.canInvoice}
              />
            ))}
            <Subconsultants caseId={d.id} phases={d.phases} fixedFee={fixed} />
          </div>
          <Card title={t("cf.case.employees")}>
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th scope="col" className="py-1 text-left font-semibold">
                    {t("cf.case.employee")}
                  </th>
                  <th scope="col" className="py-1 text-right font-semibold">
                    {t("cf.col.hours")}
                  </th>
                  <th scope="col" className="py-1 text-right font-semibold">
                    {t("cf.col.forbrugt")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.employees.map((e) => (
                  <tr key={e.userId} className="border-t border-line">
                    <td className="py-1.5 text-ink-900">{e.name}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtHours(e.hours, locale)}</td>
                    <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{kr(e.forbrugt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>

      <Card title={t("cf.case.invoices")}>
        {!d.invoices.booked.length && !d.invoices.drafts.length ? (
          <p className="text-sm text-ink-500">{t("cf.case.noInvoices")}</p>
        ) : (
          <div className="relative -mx-5 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-y border-line bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th scope="col" className="px-5 py-2 text-left font-semibold">
                    {t("dl.col.number")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    {t("dl.col.invoiceDate")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    {t("dl.col.dueDate")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    {t("dl.col.total")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    {t("dl.col.outstanding")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    {t("dl.col.status")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.invoices.drafts.map((x) => (
                  <tr key={x.id} className="border-b border-line">
                    <td className="px-5 py-2">
                      <Link
                        href={`/invoicing/${x.id}`}
                        className="font-semibold text-brand-700 hover:underline"
                      >
                        {t("cf.case.draft")}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{date(x.invoiceDate)}</td>
                    <td className="px-3 py-2">–</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{kr(x.total)}</td>
                    <td className="px-3 py-2 text-right">–</td>
                    <td className="px-3 py-2 text-ink-500">{t("cf.case.draft")}</td>
                  </tr>
                ))}
                {[...d.invoices.booked].reverse().map((x) => (
                  <tr key={x.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-2">
                      <Link
                        href={`/invoicing/${x.id}`}
                        className="font-semibold text-ink-900 hover:text-brand-700"
                      >
                        {x.number}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{date(x.invoiceDate)}</td>
                    <td className="px-3 py-2">{date(x.dueDate)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {kr(x.total - x.credited)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {kr(x.outstanding)}
                    </td>
                    <td className="px-3 py-2">
                      <DebtStatusPill status={x.status} daysOverdue={x.daysOverdue} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
