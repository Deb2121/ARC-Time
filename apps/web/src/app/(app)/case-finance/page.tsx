"use client";

/**
 * Sagsoversigt (D-029): one row per case with honorarform, timer, forbrugt, faktureret, ikke faktureret,
 * honorar/rest, næste rate and status; summary cards, filters, sorting on every column, a totals row that always
 * sums the visible rows, and an Excel export with the same filters. Second tab: "Rater klar til fakturering".
 */
import { type CaseFilter, type CaseStatus, type FeeType, matchesCaseFilter, sumRows } from "@arc-tid/domain";
import { Button } from "@arc-tid/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  type CaseRow,
  CaseStatusPill,
  FeeTypePill,
  FilterSelect,
  type Option,
  SortTh,
  Tile,
  useSort,
} from "@/components/case-finance/shared";
import { ExportButtons, withFormat } from "@/components/export-buttons";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { API_URL, api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { fmtAmount, fmtDay, fmtHours, fmtKr, fmtPct } from "@/lib/format";

interface Overview {
  rows: CaseRow[];
  cards: { activeCases: number; canInvoiceNow: number; instalmentsReady: number; casesAtRisk: number };
  options: { managers: Option[]; customers: Option[] };
}
interface ReadyRow {
  id: string;
  caseId: string;
  caseNumber: string;
  caseName: string;
  customerName: string;
  managerName: string | null;
  description: string;
  plannedDate: string;
  amount: number;
}

const STATUSES: CaseStatus[] = [
  "kan_faktureres",
  "rate_klar",
  "overskridelsesrisiko",
  "honorar_overskredet",
  "ajour",
];
const FEE_TYPES: FeeType[] = ["medgaaet_tid", "fast_honorar"];

export default function CaseFinancePage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"overview" | "ready">("overview");
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
      <header>
        <h1 className="text-3xl font-normal">{t("cf.title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-700">{t("cf.intro")}</p>
      </header>
      <div role="tablist" className="flex gap-1 border-b border-line">
        {(["overview", "ready"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === k ? "border-brand-600 text-ink-900" : "border-transparent text-ink-500 hover:text-ink-900"}`}
          >
            {t(`cf.tab.${k}` as MessageKey)}
          </button>
        ))}
      </div>
      {tab === "overview" ? <Overview /> : <ReadyList />}
    </div>
  );
}

function Overview() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const q = useQuery({ queryKey: ["case-finance"], queryFn: () => api<Overview>("/case-finance/cases") });
  const [filter, setFilter] = useState<Required<CaseFilter>>({
    feeType: "",
    managerId: "",
    customerId: "",
    status: "",
  });
  const rows = useMemo(
    () => (q.data?.rows ?? []).filter((r) => matchesCaseFilter(r, filter)),
    [q.data, filter],
  );
  const accessors = useMemo(
    () => ({
      number: (r: CaseRow) => r.number,
      name: (r: CaseRow) => r.name,
      customer: (r: CaseRow) => r.customerName,
      manager: (r: CaseRow) => r.managerName,
      feeType: (r: CaseRow) => r.feeType,
      hours: (r: CaseRow) => r.hours,
      forbrugt: (r: CaseRow) => r.forbrugt,
      faktureret: (r: CaseRow) => r.faktureret,
      ikkeFaktureret: (r: CaseRow) => r.ikkeFaktureret,
      rest: (r: CaseRow) => r.resthonorar,
      next: (r: CaseRow) => r.nextInstalment?.date ?? null,
      status: (r: CaseRow) => STATUSES.indexOf(r.caseStatus),
    }),
    [],
  );
  const sort = useSort(rows, accessors, "number");
  const totals = sumRows(rows, ["hours", "forbrugt", "faktureret", "ikkeFaktureret", "fee", "resthonorar"]);

  if (q.isLoading || !q.data) return <p className="text-ink-500">{t("common.loading")}</p>;
  const { cards, options } = q.data;
  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]);
  const kr = (n: number | null | undefined) => fmtKr(n, locale);
  const amt = (n: number | null | undefined) => fmtAmount(n, locale);
  const set = (k: keyof CaseFilter) => (v: string) => setFilter((f) => ({ ...f, [k]: v }));
  const all = [{ value: "", label: t("cf.filter.all") }];

  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("cf.title")}>
        <Tile label={t("cf.card.active")} value={String(cards.activeCases)} />
        <Tile label={t("cf.card.canInvoice")} value={kr(cards.canInvoiceNow)} />
        <Tile label={t("cf.card.ready")} value={String(cards.instalmentsReady)} />
        <Tile
          label={t("cf.card.risk")}
          value={String(cards.casesAtRisk)}
          tone={cards.casesAtRisk ? "danger" : undefined}
        />
      </section>

      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect
          label={t("cf.filter.feeType")}
          value={filter.feeType}
          onChange={set("feeType")}
          options={[...all, ...FEE_TYPES.map((f) => ({ value: f, label: t(`cf.fee.${f}` as MessageKey) }))]}
        />
        <FilterSelect
          label={t("cf.filter.manager")}
          value={filter.managerId}
          onChange={set("managerId")}
          options={[...all, ...options.managers.map((m) => ({ value: m.id, label: m.name }))]}
        />
        <FilterSelect
          label={t("cf.filter.customer")}
          value={filter.customerId}
          onChange={set("customerId")}
          options={[...all, ...options.customers.map((c) => ({ value: c.id, label: c.name }))]}
        />
        <FilterSelect
          label={t("cf.filter.status")}
          value={filter.status}
          onChange={set("status")}
          options={[...all, ...STATUSES.map((s) => ({ value: s, label: t(`cf.status.${s}` as MessageKey) }))]}
        />
      </div>

      <div className="-mb-2 flex flex-wrap items-end justify-between gap-3">
        <p className="text-xs text-ink-500">{t("cf.amountsNote")}</p>
        <ExportButtons
          align="end"
          href={(f) => `${API_URL}/api/v1/case-finance/cases?${withFormat(qs, f)}`}
        />
      </div>
      <div className="relative -mx-4 overflow-x-auto rounded-lg border border-line bg-surface sm:mx-0">
        <table className="w-full min-w-[940px] text-[13px]">
          <thead className="border-b border-line bg-surface-alt text-[11px] text-ink-500">
            <tr>
              <SortTh
                id="number"
                label={t("cf.col.number")}
                second={{ id: "name", label: t("cf.col.name") }}
                third={{ id: "feeType", label: t("cf.col.feeType") }}
                fourth={{ id: "status", label: t("cf.col.status") }}
                sort={sort}
              />
              <SortTh
                id="customer"
                label={t("cf.col.customer")}
                second={{ id: "manager", label: t("cf.col.manager") }}
                sort={sort}
              />
              <SortTh id="hours" label={t("cf.col.hours")} sort={sort} align="right" />
              <SortTh id="forbrugt" label={t("cf.col.forbrugt")} sort={sort} align="right" />
              <SortTh id="faktureret" label={t("cf.col.faktureret")} sort={sort} align="right" />
              <SortTh id="ikkeFaktureret" label={t("cf.col.ikkeFaktureret")} sort={sort} align="right" />
              <SortTh id="rest" label={t("cf.col.feeRest")} sort={sort} align="right" />
              <SortTh id="next" label={t("cf.col.nextInstalment")} sort={sort} />
            </tr>
          </thead>
          <tbody>
            {sort.sorted.map((r) => (
              <tr
                key={r.id}
                onClick={() => router.push(`/case-finance/${r.id}`)}
                className="cursor-pointer border-b border-line align-top last:border-0 hover:bg-surface-alt"
              >
                <td className="min-w-40 max-w-56 px-2 py-2">
                  <Link
                    href={`/case-finance/${r.id}`}
                    className="font-semibold tabular-nums text-ink-900 hover:text-brand-700"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {r.number}
                  </Link>
                  <span className="block text-ink-900">{r.name}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    <FeeTypePill feeType={r.feeType} />
                    <CaseStatusPill status={r.caseStatus} />
                  </span>
                </td>
                <td className="max-w-40 px-2 py-2">
                  <span className="block text-ink-900">{r.customerName}</span>
                  <span className="block text-xs text-ink-500">{r.managerName ?? "–"}</span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtHours(r.hours, locale)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{amt(r.forbrugt)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{amt(r.faktureret)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                  {r.ikkeFaktureret ? amt(r.ikkeFaktureret) : "–"}
                </td>
                <td className="w-28 px-2 py-2 text-right tabular-nums">
                  {r.fee === null ? (
                    "–"
                  ) : (
                    <span className="flex flex-col items-end">
                      <span>{amt(r.fee)}</span>
                      <span className="text-xs text-ink-700">
                        {t("cf.restShort")} {amt(r.resthonorar)}
                      </span>
                      <span
                        className={`text-xs font-semibold ${r.feeLevel === "alert" ? "text-danger" : r.feeLevel === "warning" ? "text-warning" : "font-normal text-ink-500"}`}
                      >
                        {r.feeWarning ?? `${fmtPct(r.forbrugtPct, locale)}`}
                      </span>
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-2">
                  {r.nextInstalment ? (
                    <span className="flex flex-col">
                      <span className="tabular-nums">
                        {fmtDay(r.nextInstalment.date, locale, {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                      <span className="text-xs text-ink-500 tabular-nums">
                        {amt(r.nextInstalment.amount)}
                      </span>
                    </span>
                  ) : (
                    "–"
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-ink-500">
                  {t("cf.empty")}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="border-t-2 border-line bg-surface-alt font-semibold text-ink-900">
            <tr className="align-top">
              <td className="px-2 py-2" colSpan={2}>
                {t("cf.total", { n: rows.length })}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtHours(totals.hours, locale)}</td>
              <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{amt(totals.forbrugt)}</td>
              <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                {amt(totals.faktureret)}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                {amt(totals.ikkeFaktureret)}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                {amt(totals.fee)}
                <span className="block text-xs font-normal text-ink-700">
                  {t("cf.restShort")} {amt(totals.resthonorar)}
                </span>
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

function ReadyList() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["ready-instalments"],
    queryFn: () => api<ReadyRow[]>("/case-finance/ready-instalments"),
  });
  const [done, setDone] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const invoice = useMutation({
    mutationFn: (id: string) =>
      api<{ invoiceId: string }>(`/case-finance/plan-items/${id}/invoice`, { method: "POST" }),
    onSuccess: (r, id) => {
      setDone((d) => ({ ...d, [id]: r.invoiceId }));
      setError(null);
      void qc.invalidateQueries({ queryKey: ["case-finance"] });
    },
    onError: (e) => setError(errorText(e, t)),
  });
  if (q.isLoading || !q.data) return <p className="text-ink-500">{t("common.loading")}</p>;
  if (!q.data.length) return <p className="text-ink-500">{t("cf.ready.empty")}</p>;
  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-danger">
          ⚠ {error}
        </p>
      )}
      <div className="relative -mx-4 overflow-x-auto rounded-lg border border-line bg-surface sm:mx-0">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b border-line bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                {t("cf.col.name")}
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                {t("cf.col.customer")}
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                {t("cf.ready.instalment")}
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                {t("cf.ready.date")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                {t("cf.ready.amount")}
              </th>
              <th scope="col" className="px-3 py-2">
                <span className="sr-only">{t("cf.ready.invoice")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="px-3 py-2">
                  <Link
                    href={`/case-finance/${r.caseId}`}
                    className="font-semibold text-ink-900 hover:text-brand-700"
                  >
                    <span className="text-ink-500">{r.caseNumber}</span> {r.caseName}
                  </Link>
                </td>
                <td className="px-3 py-2 text-ink-700">{r.customerName}</td>
                <td className="px-3 py-2 text-ink-900">{r.description}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  {fmtDay(r.plannedDate, locale, { day: "numeric", month: "short", year: "numeric" })}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">
                  {fmtKr(r.amount, locale)}
                </td>
                <td className="px-3 py-2 text-right">
                  {done[r.id] ? (
                    <Link
                      href={`/invoicing/${done[r.id]}`}
                      className="text-sm font-semibold text-brand-700 hover:underline"
                    >
                      {t("cf.ready.created")} → {t("cf.ready.open")}
                    </Link>
                  ) : (
                    <Button
                      variant="secondary"
                      disabled={invoice.isPending}
                      onClick={() => invoice.mutate(r.id)}
                    >
                      {t("cf.ready.invoice")}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
