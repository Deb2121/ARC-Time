"use client";

/**
 * Underrådgivere on the case page (D-039): per sub-consultant the fee in the rate plan vs registered invoices, the
 * registered invoices themselves, and a form to register one (supplier, invoice no., date, amount excl. VAT, phase,
 * re-invoice to the customer with an optional markup). Invoices on a customer invoice are locked.
 */
import { Button, Card } from "@arc-tid/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { fmtDay, fmtKr } from "@/lib/format";

interface SubInvoice {
  id: string;
  supplier: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  amount: number;
  taskId: string | null;
  phase: string | null;
  note: string | null;
  rebill: boolean;
  markupBp: number;
  invoiced: boolean;
  locked: boolean;
}
interface Overview {
  billable: boolean;
  canEdit: boolean;
  invoices: SubInvoice[];
  suppliers: { name: string; budget: number | null; registered: number; remaining: number | null }[];
  total: number;
}

const field = "h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm";
const num = (s: FormDataEntryValue | null) =>
  Number(
    String(s ?? "")
      .replace(/\s/g, "")
      .replace(/\./g, "")
      .replace(",", "."),
  );

/** The sub-consultants card; `phases` are the case's top-level tasks; `fixedFee` = the case has a fixed price. */
export function Subconsultants({
  caseId,
  phases,
  fixedFee,
}: {
  caseId: string;
  phases: { id: string; name: string; level: number }[];
  fixedFee: boolean;
}) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [form, setForm] = useState<SubInvoice | "new" | null>(null);
  const [rebill, setRebill] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["subconsultants", caseId],
    queryFn: () => api<Overview>(`/case-finance/cases/${caseId}/subconsultants`),
    retry: false,
  });
  const done = () => {
    setForm(null);
    setError(null);
    void qc.invalidateQueries({ queryKey: ["subconsultants", caseId] });
  };
  const save = useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: object }) =>
      id
        ? api(`/case-finance/subconsultant-invoices/${id}`, { method: "PUT", body: JSON.stringify(body) })
        : api(`/case-finance/cases/${caseId}/subconsultants`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: done,
    onError: (e) => setError(errorText(e, t)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/case-finance/subconsultant-invoices/${id}`, { method: "DELETE" }),
    onSuccess: done,
    onError: (e) => setError(errorText(e, t)),
  });
  if (!q.data) return null;
  const d = q.data;
  const kr = (o: number) => fmtKr(o, locale, 2);
  const editing = form && form !== "new" ? form : null;

  function open(x: SubInvoice | "new") {
    setError(null);
    setRebill(x === "new" ? false : x.rebill);
    setForm(x);
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const amount = num(f.get("amount"));
    if (!Number.isFinite(amount) || amount <= 0) return setError(t("sc.amountRequired"));
    save.mutate({
      id: editing?.id ?? null,
      body: {
        supplier: String(f.get("supplier") ?? ""),
        invoiceNumber: String(f.get("invoiceNumber") ?? "") || null,
        invoiceDate: String(f.get("invoiceDate") ?? ""),
        amount,
        taskId: String(f.get("taskId") ?? "") || null,
        note: String(f.get("note") ?? "") || null,
        rebill,
        markupPct: rebill ? num(f.get("markup")) || 0 : 0,
      },
    });
  }

  return (
    <Card title={t("sc.title")}>
      <p className="mb-3 text-xs text-ink-500">{t(fixedFee ? "sc.hintFixed" : "sc.hint")}</p>
      {d.suppliers.length > 0 && (
        <table className="mb-4 w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-ink-500">
            <tr className="border-b border-line">
              <th className="py-1.5 text-left font-semibold">{t("sc.supplier")}</th>
              <th className="py-1.5 text-right font-semibold">{t("sc.budget")}</th>
              <th className="py-1.5 text-right font-semibold">{t("sc.registered")}</th>
              <th className="py-1.5 text-right font-semibold">{t("sc.remaining")}</th>
            </tr>
          </thead>
          <tbody>
            {d.suppliers.map((s) => (
              <tr key={s.name} className="border-b border-line last:border-0">
                <td className="py-1.5">{s.name}</td>
                <td className="py-1.5 text-right tabular-nums">{s.budget === null ? "–" : kr(s.budget)}</td>
                <td className="py-1.5 text-right tabular-nums">{kr(s.registered)}</td>
                <td
                  className={`py-1.5 text-right tabular-nums ${s.remaining !== null && s.remaining < 0 ? "font-semibold text-danger" : ""}`}
                >
                  {s.remaining === null ? "–" : kr(s.remaining)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {d.invoices.length ? (
        <ul className="flex flex-col divide-y divide-line text-sm">
          {d.invoices.map((i) => (
            <li key={i.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-ink-900">{i.supplier}</span>
                {i.invoiceNumber && (
                  <span className="text-ink-500">
                    {" "}
                    · {t("sc.invoiceNo")} {i.invoiceNumber}
                  </span>
                )}
                <span className="block text-xs text-ink-500">
                  {fmtDay(i.invoiceDate, locale, { day: "numeric", month: "short", year: "numeric" })}
                  {i.phase && ` · ${i.phase}`}
                  {i.note && ` · ${i.note}`}
                  {" · "}
                  {i.rebill
                    ? t("sc.rebillYes", { pct: String(i.markupBp / 100).replace(".", ",") })
                    : t("sc.rebillNo")}
                  {i.invoiced ? ` · ${t("sc.invoiced")}` : i.locked ? ` · ${t("sc.onDraft")}` : ""}
                </span>
              </span>
              <span className="tabular-nums">{kr(i.amount)}</span>
              {d.canEdit && !i.locked && (
                <span className="flex gap-2 text-xs font-semibold">
                  <button type="button" className="text-ink-500 hover:text-brand-700" onClick={() => open(i)}>
                    {t("sc.edit")}
                  </button>
                  <button
                    type="button"
                    className="text-ink-500 hover:text-danger"
                    onClick={() => remove.mutate(i.id)}
                    disabled={remove.isPending}
                  >
                    {t("pr.removeMember")}
                  </button>
                </span>
              )}
            </li>
          ))}
          <li className="flex justify-between py-2 font-semibold">
            <span>{t("sc.total")}</span>
            <span className="tabular-nums">{kr(d.total)}</span>
          </li>
        </ul>
      ) : (
        <p className="text-sm text-ink-500">{t("sc.empty")}</p>
      )}

      {d.canEdit && !form && (
        <Button variant="ghost" className="mt-2" onClick={() => open("new")}>
          + {t("sc.add")}
        </Button>
      )}
      {form && (
        <form
          key={editing?.id ?? "new"}
          onSubmit={submit}
          className="mt-3 grid gap-3 rounded-lg bg-surface-alt p-4 text-sm sm:grid-cols-2"
        >
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-ink-900">{t("sc.supplier")}</span>
            <input
              name="supplier"
              required
              defaultValue={editing?.supplier ?? ""}
              list="sc-suppliers"
              className={field}
            />
            <datalist id="sc-suppliers">
              {d.suppliers.map((s) => (
                <option key={s.name} value={s.name} />
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-ink-900">{t("sc.invoiceNo")}</span>
            <input name="invoiceNumber" defaultValue={editing?.invoiceNumber ?? ""} className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-ink-900">{t("sc.date")}</span>
            <input
              name="invoiceDate"
              type="date"
              required
              defaultValue={editing?.invoiceDate ?? new Date().toISOString().slice(0, 10)}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-ink-900">{t("sc.amount")}</span>
            <input
              name="amount"
              required
              inputMode="decimal"
              defaultValue={editing ? String(editing.amount / 100).replace(".", ",") : ""}
              className={`${field} text-right tabular-nums`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-ink-900">{t("sc.phase")}</span>
            <select name="taskId" defaultValue={editing?.taskId ?? ""} className={field}>
              <option value="">{t("sc.noPhase")}</option>
              {phases
                .filter((p) => p.level === 1)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-ink-900">{t("sc.note")}</span>
            <input name="note" defaultValue={editing?.note ?? ""} className={field} />
          </label>
          <fieldset className="flex flex-col gap-2 sm:col-span-2">
            <legend className="mb-1 font-semibold text-ink-900">{t("sc.rebill")}</legend>
            <label className="flex items-center gap-2">
              <input type="radio" checked={!rebill} onChange={() => setRebill(false)} />
              {t("sc.rebillNoOption")}
            </label>
            <label className={`flex items-center gap-2 ${d.billable ? "" : "text-ink-500"}`}>
              <input type="radio" checked={rebill} onChange={() => setRebill(true)} disabled={!d.billable} />
              {d.billable ? t("sc.rebillYesOption") : t("sc.rebillDisabled")}
            </label>
            {rebill && (
              <label className="flex w-48 flex-col gap-1">
                <span className="text-xs font-semibold text-ink-900">{t("sc.markup")}</span>
                <input
                  name="markup"
                  inputMode="decimal"
                  defaultValue={editing ? String(editing.markupBp / 100).replace(".", ",") : "0"}
                  className={`${field} text-right tabular-nums`}
                />
              </label>
            )}
            {rebill && fixedFee && <p className="text-xs text-ink-500">{t("sc.rebillFixedWarn")}</p>}
          </fieldset>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>
              {t("common.save")}
            </Button>
            <Button variant="ghost" onClick={() => setForm(null)}>
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          ⚠ {error}
        </p>
      )}
    </Card>
  );
}
