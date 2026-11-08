"use client";

/**
 * Expenses & mileage page (brief §4.7): the employee's own expenses per month, one form for a new expense or
 * mileage claim (receipt upload, VAT shown live, optional project and re-invoicing), and "submit for approval".
 */
import { addDays, lastDayOfMonth, monthOf, todayCopenhagen, vatSplit } from "@arc-tid/domain";
import { Badge, Button, Card } from "@arc-tid/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import type { TaskRef } from "@/components/timesheet/types";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { API_URL, ApiError, api, type UploadedFile, uploadFile } from "@/lib/api";
import { fmtDay, fmtKr } from "@/lib/format";

interface Expense {
  id: string;
  date: string;
  kind: "expense" | "mileage";
  description: string;
  typeName: string | null;
  projectNumber: string | null;
  projectName: string | null;
  grossAmount: number;
  vatAmount: number;
  km: number | null;
  fromPlace: string | null;
  toPlace: string | null;
  billable: boolean;
  receiptFileId: string | null;
  status: "draft" | "submitted" | "approved" | "rejected" | "invoiced";
  rejectComment: string | null;
}
interface Settings {
  types: { id: string; name: string; vatBp: number; vatDeductibleBp: number }[];
  mileageRates: { year: number; highRate: number; lowRate: number; thresholdKm: number }[];
}

const field =
  "h-10 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink-900";
const num = (v: string) => Number(v.replace(/\./g, "").replace(",", "."));

export default function ExpensesPage() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const today = todayCopenhagen();
  const [month, setMonth] = useState(monthOf(today));
  const [form, setForm] = useState<"expense" | "mileage" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["expenses", month],
    queryFn: () => api<Expense[]>(`/expenses?month=${month}`),
  });
  const settings = useQuery({
    queryKey: ["expense-settings"],
    queryFn: () => api<Settings>("/expenses/settings"),
  });
  const tasks = useQuery({ queryKey: ["ts-tasks"], queryFn: () => api<TaskRef[]>("/timesheet/tasks") });
  const projects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const x of tasks.data ?? [])
      if (x.customerName) seen.set(x.projectId, `${x.projectNumber} ${x.projectName}`);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tasks.data]);
  const rows = list.data ?? [];
  const drafts = rows.filter((r) => r.status === "draft" || r.status === "rejected");
  const total = rows.reduce((a, r) => a + r.grossAmount, 0);
  const refresh = () => qc.invalidateQueries({ queryKey: ["expenses"] });
  const fail = (e: unknown) =>
    setError(e instanceof ApiError ? t(`err.${e.code}` as MessageKey) : t("common.error"));
  const monthLabel = (m: string) => fmtDay(m, locale, { month: "long", year: "numeric" });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-normal">{t("ex.title")}</h1>
          <p className="mt-1 text-ink-700">{t("ex.intro")}</p>
        </div>
        {!form && (
          <div className="flex gap-2">
            <Button onClick={() => setForm("expense")}>+ {t("ex.newExpense")}</Button>
            <Button variant="secondary" onClick={() => setForm("mileage")}>
              + {t("ex.newMileage")}
            </Button>
          </div>
        )}
      </header>

      {error && (
        <p role="alert" className="text-sm text-danger">
          ⚠ {error}
        </p>
      )}
      {form && settings.data && (
        <ExpenseForm
          kind={form}
          settings={settings.data}
          projects={projects}
          onDone={() => {
            setForm(null);
            setError(null);
            void refresh();
          }}
          onError={fail}
        />
      )}

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              aria-label={t("ts.prev")}
              onClick={() => setMonth(monthOf(addDays(month, -1)))}
            >
              ←
            </Button>
            <span className="min-w-36 text-center font-semibold text-ink-900 first-letter:uppercase">
              {monthLabel(month)}
            </span>
            <Button
              variant="secondary"
              aria-label={t("ts.next")}
              onClick={() => setMonth(monthOf(addDays(lastDayOfMonth(month), 1)))}
            >
              →
            </Button>
          </div>
          {drafts.length > 0 && (
            <Button
              onClick={() =>
                api("/expenses/submit", {
                  method: "POST",
                  body: JSON.stringify({ ids: drafts.map((d) => d.id) }),
                })
                  .then(refresh)
                  .catch(fail)
              }
            >
              {t("ex.submitAll", { count: drafts.length })}
            </Button>
          )}
        </div>
        {rows.length === 0 && <p className="py-6 text-center text-sm text-ink-500">{t("ex.empty")}</p>}
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <span className="w-20 text-ink-500">
                {fmtDay(r.date, locale, { day: "numeric", month: "short" })}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-ink-900">
                  {r.kind === "mileage"
                    ? `${t("ex.kind.mileage")} ${String(r.km).replace(".", ",")} km`
                    : (r.typeName ?? t("ex.kind.expense"))}{" "}
                  · {r.description}
                </span>
                <span className="block text-xs text-ink-500">
                  {r.kind === "mileage" && r.fromPlace ? `${r.fromPlace} → ${r.toPlace} · ` : ""}
                  {r.projectNumber ? `${r.projectNumber} ${r.projectName}` : t("ex.noProject")}
                  {r.billable ? ` · ${t("ex.billable")}` : ""}
                </span>
                {r.status === "rejected" && r.rejectComment && (
                  <span className="block text-xs text-danger">
                    ⚠ {t("ex.rejected", { comment: r.rejectComment })}
                  </span>
                )}
              </span>
              {r.receiptFileId && (
                <a
                  className="text-xs font-semibold text-brand-700 hover:underline"
                  href={`${API_URL}/api/v1/files/${r.receiptFileId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  📎 {t("ex.viewReceipt")}
                </a>
              )}
              <span className="w-28 text-right font-semibold tabular-nums text-ink-900">
                {fmtKr(r.grossAmount, locale, 2)}
              </span>
              <Badge tone={r.status === "approved" || r.status === "invoiced" ? "brand" : "neutral"}>
                {t(`ex.status.${r.status}` as MessageKey)}
              </Badge>
              {(r.status === "draft" || r.status === "rejected") && (
                <button
                  type="button"
                  className="text-xs font-semibold text-ink-500 hover:text-danger"
                  onClick={() => api(`/expenses/${r.id}`, { method: "DELETE" }).then(refresh).catch(fail)}
                >
                  {t("ex.delete")}
                </button>
              )}
            </li>
          ))}
        </ul>
        {rows.length > 0 && (
          <p className="mt-3 flex justify-between border-t border-line pt-3 text-sm font-semibold text-ink-900">
            <span>{t("ex.total")}</span>
            <span className="tabular-nums">{fmtKr(total, locale, 2)}</span>
          </p>
        )}
      </Card>
    </div>
  );
}

/** The registration form for one expense or mileage claim. */
function ExpenseForm({
  kind,
  settings,
  projects,
  onDone,
  onError,
}: {
  kind: "expense" | "mileage";
  settings: Settings;
  projects: [string, string][];
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  const { t, locale } = useI18n();
  const today = todayCopenhagen();
  const [typeId, setTypeId] = useState(settings.types[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [projectId, setProjectId] = useState("");
  const [billable, setBillable] = useState(false);
  const [receipt, setReceipt] = useState<UploadedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const type = settings.types.find((x) => x.id === typeId);
  const preview =
    amount && !Number.isNaN(num(amount))
      ? vatSplit(Math.round(num(amount) * 100), type?.vatBp ?? 2500)
      : null;
  const rate = settings.mileageRates.find((r) => r.year === Number(today.slice(0, 4)));
  const kr2 = (ore: number) => (ore / 100).toFixed(2).replace(".", ",");

  async function onFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      setReceipt(await uploadFile(file));
    } catch (e) {
      onError(e);
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api("/expenses", {
        method: "POST",
        body: JSON.stringify({
          kind,
          date: f.get("date"),
          description: f.get("description"),
          projectId: projectId || null,
          billable: Boolean(projectId) && billable,
          markupPct: f.get("markup") ? num(String(f.get("markup"))) : 0,
          ...(kind === "expense"
            ? { expenseTypeId: typeId || null, amount: num(amount), receiptFileId: receipt?.id ?? null }
            : {
                km: num(String(f.get("km"))),
                fromPlace: f.get("from") || undefined,
                toPlace: f.get("to") || undefined,
              }),
        }),
      });
      onDone();
    } catch (err) {
      onError(err);
    }
  }

  return (
    <Card title={t(kind === "expense" ? "ex.newExpense" : "ex.newMileage")}>
      <form onSubmit={submit} className="grid gap-4 text-sm sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-ink-900">{t("ex.date")}</span>
          <input name="date" type="date" required defaultValue={today} max={today} className={field} />
        </label>
        {kind === "expense" ? (
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-ink-900">{t("ex.type")}</span>
            <select className={field} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              {settings.types.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-ink-900">{t("ex.km")}</span>
            <input name="km" required inputMode="decimal" className={field} />
            {rate && (
              <span className="text-xs text-ink-500">
                {t("ex.mileageRate", {
                  rate: kr2(rate.highRate),
                  km: rate.thresholdKm.toLocaleString(locale === "da" ? "da-DK" : "en-GB"),
                  low: kr2(rate.lowRate),
                })}
              </span>
            )}
          </label>
        )}
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="font-semibold text-ink-900">{t("ex.description")}</span>
          <input name="description" required maxLength={300} className={field} />
        </label>
        {kind === "expense" ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="font-semibold text-ink-900">{t("ex.amount")}</span>
              <input
                required
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={field}
              />
              {preview && (
                <span className="text-xs tabular-nums text-ink-500">
                  {t("ex.net")} {kr2(preview.net)} · {t("ex.vat")} {kr2(preview.vat)}
                </span>
              )}
            </label>
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-ink-900">{t("ex.receipt")}</span>
              {receipt ? (
                <span className="flex h-10 items-center gap-2 text-ink-900">
                  📎 {receipt.filename}
                  <button
                    type="button"
                    className="text-xs text-ink-500 hover:text-danger"
                    onClick={() => setReceipt(null)}
                  >
                    ✕
                  </button>
                </span>
              ) : (
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  capture="environment"
                  disabled={uploading}
                  onChange={(e) => onFile(e.target.files?.[0])}
                  className="text-sm file:mr-3 file:rounded-[var(--radius-control)] file:border file:border-line file:bg-surface file:px-3 file:py-2 file:text-sm file:font-semibold"
                  aria-label={t("ex.receipt")}
                />
              )}
              <span className="text-xs text-ink-500">{t("ex.receiptHint")}</span>
            </div>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1">
              <span className="font-semibold text-ink-900">{t("ex.from")}</span>
              <input name="from" maxLength={200} className={field} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-semibold text-ink-900">{t("ex.to")}</span>
              <input name="to" maxLength={200} className={field} />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-ink-900">{t("ex.project")}</span>
          <select className={field} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">{t("ex.noProject")}</option>
            {projects.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col justify-end gap-2">
          <label className={`flex items-center gap-2 ${projectId ? "" : "opacity-50"}`}>
            <input
              type="checkbox"
              disabled={!projectId}
              checked={billable && Boolean(projectId)}
              onChange={(e) => setBillable(e.target.checked)}
            />
            {t("ex.billable")}
          </label>
          {billable && projectId && (
            <label className="flex items-center gap-2">
              <span>{t("ex.markup")}</span>
              <input name="markup" inputMode="decimal" defaultValue="0" className={`${field} w-20`} />
            </label>
          )}
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={uploading}>
            {t(kind === "expense" ? "ex.save" : "ex.saveMileage")}
          </Button>
          <Button variant="ghost" onClick={onDone}>
            {t("common.cancel")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
