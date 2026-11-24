"use client";

/**
 * Debitorliste (D-029): booked invoices with due date, amount incl. VAT, paid, outstanding, status and reminders;
 * ageing cards; filters (only unpaid by default, only overdue, all; customer; case; PM); sorting; Excel export;
 * and — for Finance — "Registrér betaling" (full or partial, with date) and "Registrér rykker" (1st–3rd).
 */
import { AGEING_BUCKETS, addDays, daysBetween, todayCopenhagen } from "@arc-tid/domain";
import { Button } from "@arc-tid/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type FormEvent, Fragment, useMemo, useState } from "react";
import {
  DebtStatusPill,
  FilterSelect,
  type Option,
  type ReceivableRow,
  SortTh,
  Tile,
  useSort,
} from "@/components/case-finance/shared";
import { ExportButtons, withFormat } from "@/components/export-buttons";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { API_URL, api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { fmtAmount, fmtDay, fmtKr } from "@/lib/format";

interface Debtors {
  rows: ReceivableRow[];
  ageing: { total: number; buckets: Record<string, number> };
  options: { customers: Option[]; cases: Option[]; managers: Option[] };
  canManage: boolean;
  integration: boolean;
}
type View = "unpaid" | "overdue" | "all";

export default function DebtorsPage() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [filter, setFilter] = useState({
    view: "unpaid" as View,
    customerId: "",
    projectId: "",
    managerId: "",
  });
  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]);
  const q = useQuery({
    queryKey: ["debtors", qs.toString()],
    queryFn: () => api<Debtors>(`/receivables?${qs}`),
  });
  const [dialog, setDialog] = useState<{ kind: "payment" | "reminder"; row: ReceivableRow } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Why "+ Rykker" cannot be used on a row (not overdue yet / 3 reminders given), shown under the buttons on click.
  const [reminderWhy, setReminderWhy] = useState<string | null>(null);
  const accessors = useMemo(
    () => ({
      number: (r: ReceivableRow) => r.number,
      customer: (r: ReceivableRow) => r.customerName,
      case: (r: ReceivableRow) => r.caseLabel,
      invoiceDate: (r: ReceivableRow) => r.invoiceDate,
      dueDate: (r: ReceivableRow) => r.dueDate,
      total: (r: ReceivableRow) => r.total - r.credited,
      paid: (r: ReceivableRow) => r.paid,
      outstanding: (r: ReceivableRow) => r.outstanding,
      status: (r: ReceivableRow) => r.daysOverdue,
      reminders: (r: ReceivableRow) => r.reminders.length,
    }),
    [],
  );
  const sort = useSort(q.data?.rows ?? [], accessors, "dueDate");
  const amt = (n: number) => fmtAmount(n, locale, 2);
  const date = (s: string) => fmtDay(s, locale, { day: "numeric", month: "short", year: "numeric" });
  const refresh = () => qc.invalidateQueries({ queryKey: ["debtors"] });
  const all = [{ value: "", label: t("cf.filter.all") }];

  async function sync() {
    try {
      const r = await api<{ updated: number }>("/receivables/sync", { method: "POST" });
      setMessage(t("dl.synced", { n: r.updated }));
      await refresh();
    } catch (e) {
      setMessage(errorText(e, t));
    }
  }

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
      <header>
        <h1 className="text-3xl font-normal">{t("dl.title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-700">{t("dl.intro")}</p>
      </header>

      {q.data && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6" aria-label={t("dl.title")}>
          <Tile compact label={t("dl.card.total")} value={fmtKr(q.data.ageing.total, locale)} />
          {AGEING_BUCKETS.map((b) => (
            <Tile
              compact
              key={b}
              label={t(`dl.bucket.${b}` as MessageKey)}
              value={fmtKr(q.data.ageing.buckets[b] ?? 0, locale)}
              tone={b !== "ikke_forfalden" && (q.data.ageing.buckets[b] ?? 0) > 0 ? "danger" : undefined}
            />
          ))}
        </section>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="mb-1 font-semibold text-ink-900">{t("dl.col.status")}</legend>
          <div className="flex overflow-hidden rounded-[var(--radius-control)] border border-line">
            {(["unpaid", "overdue", "all"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={filter.view === v}
                onClick={() => setFilter((f) => ({ ...f, view: v }))}
                className={`h-10 px-3 text-sm font-semibold ${filter.view === v ? "bg-ink-900 text-white" : "bg-surface text-ink-700 hover:bg-surface-alt"}`}
              >
                {t(`dl.view.${v}` as MessageKey)}
              </button>
            ))}
          </div>
        </fieldset>
        {q.data && (
          <>
            <FilterSelect
              label={t("cf.filter.customer")}
              value={filter.customerId}
              onChange={(v) => setFilter((f) => ({ ...f, customerId: v }))}
              options={[...all, ...q.data.options.customers.map((c) => ({ value: c.id, label: c.name }))]}
            />
            <FilterSelect
              label={t("dl.filter.case")}
              value={filter.projectId}
              onChange={(v) => setFilter((f) => ({ ...f, projectId: v }))}
              options={[...all, ...q.data.options.cases.map((c) => ({ value: c.id, label: c.name }))]}
            />
            <FilterSelect
              label={t("cf.filter.manager")}
              value={filter.managerId}
              onChange={(v) => setFilter((f) => ({ ...f, managerId: v }))}
              options={[...all, ...q.data.options.managers.map((c) => ({ value: c.id, label: c.name }))]}
            />
          </>
        )}
      </div>
      <div className="-mb-2 flex flex-wrap items-end justify-end gap-3">
        {q.data?.canManage && q.data.integration && (
          <Button variant="secondary" onClick={sync}>
            ⟳ {t("dl.sync")}
          </Button>
        )}
        <ExportButtons align="end" href={(f) => `${API_URL}/api/v1/receivables?${withFormat(qs, f)}`} />
      </div>
      {message && (
        <p role="status" className="text-sm text-ink-700">
          {message}
        </p>
      )}

      {q.isLoading || !q.data ? (
        <p className="text-ink-500">{t("common.loading")}</p>
      ) : (
        <div className="relative -mx-4 overflow-x-auto rounded-lg border border-line bg-surface sm:mx-0">
          <p className="border-b border-line px-3 py-1.5 text-xs text-ink-500">{t("dl.amountsNote")}</p>
          <table className="w-full min-w-[900px] text-[13px]">
            <thead className="border-b border-line bg-surface-alt text-[11px] text-ink-500">
              <tr>
                <SortTh
                  id="number"
                  label={t("dl.col.number")}
                  second={{ id: "invoiceDate", label: t("dl.col.invoiceDate") }}
                  sort={sort}
                />
                <SortTh
                  id="customer"
                  label={t("dl.col.customer")}
                  second={{ id: "case", label: t("dl.col.case") }}
                  sort={sort}
                />
                <SortTh id="dueDate" label={t("dl.col.dueDate")} sort={sort} />
                <SortTh
                  id="total"
                  label={t("dl.col.total")}
                  second={{ id: "paid", label: t("dl.col.paid") }}
                  sort={sort}
                  align="right"
                />
                <SortTh id="outstanding" label={t("dl.col.outstanding")} sort={sort} align="right" />
                <SortTh
                  id="status"
                  label={t("dl.col.status")}
                  second={{ id: "reminders", label: t("dl.col.reminders") }}
                  sort={sort}
                />
                {q.data.canManage && (
                  <th scope="col" className="px-2 py-2">
                    <span className="sr-only">{t("dl.payment")}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {sort.sorted.map((r) => (
                <Fragment key={r.id}>
                  <tr className="border-b border-line align-top last:border-0">
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums">
                      <Link
                        href={`/invoicing/${r.id}`}
                        className="font-semibold text-ink-900 hover:text-brand-700"
                      >
                        {r.number}
                      </Link>
                      <span className="block text-xs text-ink-500">{date(r.invoiceDate)}</span>
                    </td>
                    <td className="min-w-44 max-w-64 px-2 py-2">
                      <span className="block text-ink-900">{r.customerName}</span>
                      {r.projectId ? (
                        <Link
                          href={`/case-finance/${r.projectId}`}
                          className="block text-xs text-ink-500 hover:text-brand-700"
                        >
                          {r.caseLabel}
                        </Link>
                      ) : (
                        <span className="block text-xs text-ink-500">–</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">{date(r.dueDate)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                      {amt(r.total - r.credited)}
                      <span className="block text-xs text-ink-500">
                        {t("dl.col.paid")} {r.paid ? amt(r.paid) : "–"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums">
                      {amt(r.outstanding)}
                    </td>
                    <td className="px-2 py-2">
                      <DebtStatusPill status={r.status} daysOverdue={r.daysOverdue} />
                      {r.reminders.length > 0 && (
                        <span className="mt-1 block whitespace-nowrap text-xs text-ink-700">
                          {t("dl.level", { n: Math.max(...r.reminders) })}
                          {r.lastReminder && ` · ${date(r.lastReminder)}`}
                        </span>
                      )}
                    </td>
                    {q.data.canManage && (
                      <td className="whitespace-nowrap px-2 py-2 text-right">
                        {r.outstanding > 0 && (
                          <span className="flex flex-col items-end gap-1">
                            <Button
                              variant="secondary"
                              className="h-7 px-2.5 text-xs"
                              aria-label={t("dl.payment")}
                              title={t("dl.payment")}
                              onClick={() => setDialog({ kind: "payment", row: r })}
                            >
                              + {t("dl.paymentShort")}
                            </Button>
                            <ReminderButton
                              row={r}
                              open={reminderWhy === r.id}
                              onToggle={() => setReminderWhy(reminderWhy === r.id ? null : r.id)}
                              onRemind={() => setDialog({ kind: "reminder", row: r })}
                            />
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                  {reminderWhy === r.id && (
                    <tr className="border-b border-line bg-surface-alt/60">
                      <td colSpan={7} className="px-3 py-3">
                        <ReminderInfo row={r} onClose={() => setReminderWhy(null)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {!q.data.rows.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-ink-500">
                    {t("dl.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {dialog && (
        <ActionDialog
          kind={dialog.kind}
          row={dialog.row}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

/** Registrér betaling / Registrér rykker as a small modal form. */
function ActionDialog({
  kind,
  row,
  onClose,
  onDone,
}: {
  kind: "payment" | "reminder";
  row: ReceivableRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const [full, setFull] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const today = todayCopenhagen();
  const nextLevel = (row.reminders.length ? Math.max(...row.reminders) : 0) + 1;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      if (kind === "payment") {
        const amount = Number(
          String(f.get("amount") ?? "")
            .replace(/\./g, "")
            .replace(",", "."),
        );
        await api(`/receivables/invoices/${row.id}/payments`, {
          method: "POST",
          body: JSON.stringify({ full, amount: full ? undefined : amount, paidOn: f.get("date") }),
        });
      } else {
        await api(`/receivables/invoices/${row.id}/reminders`, {
          method: "POST",
          body: JSON.stringify({ level: nextLevel, sentOn: f.get("date") }),
        });
      }
      onDone();
    } catch (err) {
      setError(errorText(err, t));
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <button
        type="button"
        aria-label={t("common.close")}
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink-900/40"
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="dl-dialog-title"
        onSubmit={submit}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        className="relative flex w-full max-w-md flex-col gap-4 rounded-lg bg-surface p-5 shadow-xl"
      >
        <h2 id="dl-dialog-title" className="text-lg font-medium">
          {kind === "payment" ? t("dl.payment") : t("dl.reminder")} · {row.number}
        </h2>
        <p className="text-sm text-ink-700">
          {row.customerName} · {t("dl.col.outstanding")}{" "}
          <span className="font-semibold tabular-nums text-ink-900">{fmtKr(row.outstanding, locale, 2)}</span>
        </p>
        {kind === "payment" ? (
          <fieldset className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="kind" checked={full} onChange={() => setFull(true)} />
              {t("dl.full", { amount: fmtKr(row.outstanding, locale, 2) })}
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="kind" checked={!full} onChange={() => setFull(false)} />
              {t("dl.partial")}
            </label>
            {!full && (
              <input
                name="amount"
                required
                inputMode="decimal"
                aria-label={t("bp.amount")}
                placeholder={t("bp.amount")}
                className="h-10 rounded border border-line bg-surface px-3 tabular-nums"
              />
            )}
          </fieldset>
        ) : (
          <p className="text-sm font-semibold text-ink-900">{t("dl.level", { n: nextLevel })}</p>
        )}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-ink-900">
            {kind === "payment" ? t("dl.paidOn") : t("dl.sentOn")}
          </span>
          <input
            name="date"
            type="date"
            required
            defaultValue={today}
            max={today}
            className="h-10 rounded border border-line bg-surface px-3"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-danger">
            ⚠ {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit">{t("common.save")}</Button>
        </div>
      </form>
    </div>
  );
}

/** Why "+ Rykker" cannot be used on a row: not due yet, or all three reminders sent (null = it can be used). */
const reminderBlock = (row: ReceivableRow) =>
  row.daysOverdue <= 0 ? "notYet" : row.reminders.length >= 3 ? "max" : null;

/**
 * "+ Rykker" (always shown, so people see the function exists). On an overdue invoice it opens the reminder dialog;
 * otherwise it is grey and a click unfolds `ReminderInfo` under the invoice row.
 */
function ReminderButton({
  row,
  open,
  onToggle,
  onRemind,
}: {
  row: ReceivableRow;
  open: boolean;
  onToggle: () => void;
  onRemind: () => void;
}) {
  const { t } = useI18n();
  const blocked = reminderBlock(row);
  return (
    <Button
      variant="ghost"
      className={`h-7 px-2.5 text-xs ${blocked ? "text-ink-500 opacity-60" : ""} ${open ? "bg-surface-alt opacity-100" : ""}`}
      aria-label={t("dl.reminder")}
      aria-disabled={blocked ? true : undefined}
      aria-expanded={blocked ? open : undefined}
      onClick={blocked ? onToggle : onRemind}
    >
      + {t("dl.reminderShort")}
    </Button>
  );
}

/**
 * The card under an invoice row explaining why no reminder can be sent: when the payment deadline ends, the first
 * day a reminder can be sent and a countdown — or that all three reminders have been sent.
 */
function ReminderInfo({ row, onClose }: { row: ReceivableRow; onClose: () => void }) {
  const { t, locale } = useI18n();
  const blocked = reminderBlock(row);
  if (!blocked) return null;
  const day = (d: string) => fmtDay(d, locale, { day: "numeric", month: "long", year: "numeric" });
  const firstDay = addDays(row.dueDate, 1);
  const daysLeft = Math.max(1, daysBetween(todayCopenhagen(), firstDay));
  return (
    <div
      role="status"
      className={`ml-auto flex max-w-xl gap-3 rounded-lg border bg-surface p-4 shadow-sm ${blocked === "notYet" ? "border-warning/40" : "border-line"}`}
    >
      <span
        aria-hidden="true"
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${blocked === "notYet" ? "bg-warning/15 text-warning" : "bg-surface-alt text-ink-700"}`}
      >
        {blocked === "notYet" ? (
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M16 3v4M8 3v4M3 10h18M12 14v3l2 1" />
          </svg>
        ) : (
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 4h16v12H5.2L4 17.2z" />
            <path d="M8 9h8M8 12h5" />
          </svg>
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-left">
        <p className="font-semibold text-ink-900">
          {t(blocked === "notYet" ? "dl.why.notYetTitle" : "dl.why.maxTitle")} · {row.number}
        </p>
        {blocked === "notYet" ? (
          <>
            <p className="text-sm text-ink-700">{t("dl.why.notYetText", { due: day(row.dueDate) })}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-surface-alt px-3 py-2 text-sm">
              <span className="text-ink-700">{t("dl.why.firstDay")}</span>
              <span className="font-semibold text-ink-900">{day(firstDay)}</span>
              <span className="ml-auto rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning">
                {daysLeft === 1 ? t("dl.why.tomorrow") : t("dl.why.inDays", { days: daysLeft })}
              </span>
            </div>
          </>
        ) : (
          <p className="text-sm text-ink-700">{t("dl.why.maxText")}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("common.close")}
        className="-mt-1 -mr-1 h-7 w-7 shrink-0 rounded text-ink-500 hover:bg-surface-alt hover:text-ink-900"
      >
        ✕
      </button>
    </div>
  );
}
