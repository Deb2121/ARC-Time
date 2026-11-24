"use client";

import { todayCopenhagen } from "@arc-tid/domain";
import { Badge, Button } from "@arc-tid/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { CaseLabel, splitHeading } from "@/components/case-label";
import { useMe } from "@/components/session";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { api, can } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { fmtDay, fmtHours, fmtKr } from "@/lib/format";
import { matchesSearch } from "@/lib/search";

interface BasisRow {
  projectId: string;
  number: string;
  name: string;
  customerId: string;
  customerName: string;
  managerInitials: string | null;
  hours: number;
  value: number;
  oldest: string | null;
  milestones: number;
  milestoneCount: number;
  expenses: number;
  total: number;
}
export interface InvoiceListRow {
  id: string;
  number: number | null;
  type: "invoice" | "credit";
  status: "draft" | "ready" | "booked";
  invoiceDate: string;
  dueDate: string;
  heading: string | null;
  total: number;
  customerName: string;
  projectNumber: string | null;
}

const input = "h-10 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm";
type Tab = "basis" | "drafts" | "booked";

export default function InvoicingPage() {
  return (
    <Suspense>
      <Invoicing />
    </Suspense>
  );
}

function Invoicing() {
  const { t } = useI18n();
  const params = useSearchParams();
  const router = useRouter();
  const tab = (params.get("tab") as Tab) ?? "basis";
  const tabs: Tab[] = ["basis", "drafts", "booked"];
  // The field keeps its own text (typing stays instant); the URL follows after a short pause so the search
  // survives a tab switch, reload or shared link.
  const [q, setQ] = useState(params.get("q") ?? "");
  const go = (nextTab: Tab, nextQ: string) =>
    router.replace(`/invoicing?tab=${nextTab}${nextQ ? `&q=${encodeURIComponent(nextQ)}` : ""}`);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the typed text should update the URL
  useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    const id = setTimeout(() => go(tab, q), 300);
    return () => clearTimeout(id);
  }, [q]);
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <h1 className="text-3xl font-normal">{t("inv.title")}</h1>
      <div role="tablist" aria-label={t("inv.title")} className="flex gap-1 border-b border-line">
        {tabs.map((x) => (
          <button
            key={x}
            type="button"
            role="tab"
            aria-selected={tab === x}
            onClick={() => go(x, q)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === x ? "border-brand-600 text-ink-900" : "border-transparent text-ink-500 hover:text-ink-900"}`}
          >
            {t(`inv.tab.${x}` as MessageKey)}
          </button>
        ))}
      </div>
      <label className="flex max-w-md flex-col gap-1 text-sm">
        <span className="font-semibold text-ink-900">{t("inv.search")}</span>
        <span className="relative">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("inv.searchPlaceholder")}
            className={`${input} w-full pr-9 [&::-webkit-search-cancel-button]:appearance-none`}
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label={t("inv.searchClear")}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded px-1.5 text-ink-500 hover:text-ink-900"
            >
              ✕
            </button>
          )}
        </span>
      </label>
      <div role="tabpanel">
        {tab === "basis" ? (
          <Basis q={q} />
        ) : (
          <InvoiceList status={tab === "drafts" ? "open" : "booked"} q={q} />
        )}
      </div>
    </div>
  );
}

/** Count line "Viser 2 af 14 sager" while a search is active. */
function SearchCount({ q, shown, total }: { q: string; shown: number; total: number }) {
  const { t } = useI18n();
  if (!q.trim()) return null;
  return (
    <p className="text-sm text-ink-700">
      {shown ? t("inv.showing", { shown, total }) : t("inv.noMatch", { q: q.trim() })}
    </p>
  );
}

function Basis({ q }: { q: string }) {
  const { t, locale } = useI18n();
  const me = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const today = todayCopenhagen();
  const [upTo, setUpTo] = useState(today);
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [grouping, setGrouping] = useState("task");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const basis = useQuery({
    queryKey: ["basis", upTo],
    queryFn: () => api<BasisRow[]>(`/invoicing/basis?upTo=${upTo}`),
  });
  const allRows = basis.data ?? [];
  // The table, the totals, "select all" and "Opret kladde for valgte" follow the search.
  const rows = allRows.filter((r) => matchesSearch(q, r.number, r.name, r.customerName));
  const isFinance = can(me, "invoice.prepare_all");

  const create = useMutation({
    mutationFn: async () => {
      const ids: string[] = [];
      for (const r of rows.filter((x) => selected.has(x.projectId))) {
        const res = await api<{ id: string }>("/invoices/drafts", {
          method: "POST",
          body: JSON.stringify({
            customerId: r.customerId,
            projectIds: [r.projectId],
            upTo,
            invoiceDate,
            grouping,
          }),
        });
        ids.push(res.id);
      }
      return ids;
    },
    onSuccess: (ids) => {
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ["basis"] });
      if (ids.length === 1) router.push(`/invoicing/${ids[0]}`);
      else setMessage(t("inv.created", { count: ids.length }));
    },
    onError: (e) => setMessage(errorText(e, t)),
  });
  const bulk = useMutation({
    mutationFn: () =>
      api<{ created: string[] }>("/invoices/bulk-drafts", {
        method: "POST",
        body: JSON.stringify({ upTo, invoiceDate, grouping }),
      }),
    onSuccess: (r) => {
      setConfirmAll(false);
      void qc.invalidateQueries({ queryKey: ["basis"] });
      setMessage(t("inv.created", { count: r.created.length }));
    },
    onError: (e) => {
      setConfirmAll(false);
      setMessage(errorText(e, t));
    },
  });

  const sum = rows.reduce(
    (a, r) => ({ h: a.h + r.hours, v: a.v + r.value, m: a.m + r.milestones, x: a.x + r.expenses }),
    { h: 0, v: 0, m: 0, x: 0 },
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-ink-900">{t("inv.upTo")}</span>
          <input type="date" className={input} value={upTo} onChange={(e) => setUpTo(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-ink-900">{t("inv.invoiceDate")}</span>
          <input
            type="date"
            className={input}
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-ink-900">{t("inv.grouping")}</span>
          <select className={input} value={grouping} onChange={(e) => setGrouping(e.target.value)}>
            {["task", "employee", "task_employee", "summary"].map((g) => (
              <option key={g} value={g}>
                {t(`inv.group.${g}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>
        <Button disabled={!selected.size || create.isPending} onClick={() => create.mutate()}>
          {t("inv.createSelected", { count: selected.size })}
        </Button>
        {isFinance && !confirmAll && (
          <Button variant="secondary" disabled={!allRows.length} onClick={() => setConfirmAll(true)}>
            {t("inv.createAll")}
          </Button>
        )}
      </div>
      {confirmAll && (
        <div
          role="alertdialog"
          aria-label={t("inv.createAll")}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm"
        >
          <p className="text-ink-900">
            {t(q.trim() ? "inv.createAllConfirmFiltered" : "inv.createAllConfirm", { count: allRows.length })}
          </p>
          <Button disabled={bulk.isPending} onClick={() => bulk.mutate()}>
            {t("inv.createAllYes", { count: allRows.length })}
          </Button>
          <Button variant="ghost" onClick={() => setConfirmAll(false)}>
            {t("common.cancel")}
          </Button>
        </div>
      )}
      <SearchCount q={q} shown={rows.length} total={allRows.length} />
      {message && (
        <p role="status" className="text-sm text-ink-700">
          {message}{" "}
          <Link href="/invoicing?tab=drafts" className="font-semibold text-brand-700 hover:underline">
            {t("inv.tab.drafts")} →
          </Link>
        </p>
      )}
      {basis.isLoading && <p className="text-ink-500">{t("common.loading")}</p>}
      {!basis.isLoading && !allRows.length && <p className="text-ink-500">{t("inv.nothing")}</p>}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[880px] text-sm tabular-nums">
            <thead className="border-b border-line bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th scope="col" className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label={t("ap.selectAll")}
                    checked={rows.length > 0 && rows.every((r) => selected.has(r.projectId))}
                    onChange={(e) =>
                      setSelected(new Set(e.target.checked ? rows.map((r) => r.projectId) : []))
                    }
                  />
                </th>
                <th scope="col" className="px-4 py-3 text-left font-semibold">
                  {t("inv.caseCustomer")}
                </th>
                <th scope="col" className="px-4 py-3 text-left font-semibold">
                  {t("pr.manager")}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">
                  {t("inv.hours")}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">
                  {t("inv.timeValue")}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">
                  {t("inv.milestones")}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">
                  {t("inv.expenses")}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">
                  {t("inv.total")}
                </th>
                <th scope="col" className="px-4 py-3 text-left font-semibold">
                  {t("inv.oldest")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.projectId} className="border-b border-line hover:bg-surface-alt">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label={`${r.number} ${r.name}`}
                      checked={selected.has(r.projectId)}
                      onChange={(e) => {
                        const n = new Set(selected);
                        if (e.target.checked) n.add(r.projectId);
                        else n.delete(r.projectId);
                        setSelected(n);
                      }}
                    />
                  </td>
                  <td className="max-w-md px-4 py-3">
                    <CaseLabel number={r.number} name={r.name} sub={r.customerName} />
                  </td>
                  <td className="px-4 py-3 text-ink-700">{r.managerInitials}</td>
                  <td className="px-4 py-3 text-right">{fmtHours(r.hours, locale, true)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {r.value ? fmtKr(r.value, locale) : ""}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {r.milestones ? fmtKr(r.milestones, locale) : ""}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {r.expenses ? fmtKr(r.expenses, locale) : ""}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-ink-900">
                    {fmtKr(r.total, locale)}
                  </td>
                  <td className="px-4 py-3">
                    {r.oldest ? fmtDay(r.oldest, locale, { day: "numeric", month: "short" }) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="font-semibold text-ink-900">
              <tr>
                <td />
                <th scope="row" colSpan={2} className="px-4 py-3 text-left">
                  {t("common.total")}
                </th>
                <td className="px-4 py-3 text-right">{fmtHours(sum.h, locale)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right">{fmtKr(sum.v, locale)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right">{fmtKr(sum.m, locale)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right">{fmtKr(sum.x, locale)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  {fmtKr(sum.v + sum.m + sum.x, locale)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function InvoiceList({ status, q }: { status: "open" | "booked"; q: string }) {
  const { t, locale } = useI18n();
  const list = useQuery({
    queryKey: ["invoices", status],
    queryFn: () => api<InvoiceListRow[]>(`/invoices?status=${status}`),
  });
  if (list.isLoading) return <p className="text-ink-500">{t("common.loading")}</p>;
  if (!list.data?.length) return <p className="text-ink-500">{t("inv.empty")}</p>;
  const shown = list.data.filter((i) =>
    matchesSearch(q, i.projectNumber, i.heading, i.customerName, i.number),
  );
  return (
    <div className="flex flex-col gap-4">
      <SearchCount q={q} shown={shown.length} total={list.data.length} />
      {shown.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[820px] text-sm tabular-nums">
            <thead className="border-b border-line bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-semibold">
                  {t("inv.number")}
                </th>
                <th scope="col" className="px-4 py-3 text-left font-semibold">
                  {t("inv.invoiceDate")}
                </th>
                <th scope="col" className="px-4 py-3 text-left font-semibold">
                  {t("inv.caseCustomer")}
                </th>
                <th scope="col" className="px-4 py-3 text-left font-semibold">
                  {t("ap.status")}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">
                  {t("inv.total")}
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.id} className="border-b border-line last:border-0 hover:bg-surface-alt">
                  <td className="px-4 py-3 font-semibold">
                    <Link
                      href={`/invoicing/${i.id}`}
                      className="text-ink-900 hover:text-brand-700 hover:underline"
                    >
                      {i.number ?? "—"}
                      {i.type === "credit" && (
                        <span className="ml-2 text-xs font-normal text-ink-500">{t("inv.credit")}</span>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {fmtDay(i.invoiceDate, locale, { day: "numeric", month: "short", year: "numeric" })}
                  </td>
                  <td className="max-w-md px-4 py-3">
                    <CaseLabel {...splitHeading(i.heading, i.projectNumber)} sub={i.customerName} />
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={i.status === "booked" ? "brand" : "neutral"}>
                      {t(`inv.status.${i.status}` as MessageKey)}
                    </Badge>
                  </td>
                  <td
                    className={`whitespace-nowrap px-4 py-3 text-right font-semibold ${i.total < 0 ? "text-danger" : "text-ink-900"}`}
                  >
                    {fmtKr(i.total, locale, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
