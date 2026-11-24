"use client";

/**
 * Faktureringsplan on the case page (D-029): instalments with share of the fee, planned date, phase link and the
 * computed status (afventer → planlagt → klar → faktureret). Editing builds the plan from phase templates; it can
 * be saved as a draft at any time, and as active only when the instalments add up to exactly 100 % of the fee. On a
 * fixed price each instalment is a share (%) or an exact amount (kr) — the rate plan generator (D-039) writes amounts —
 * and the sum is checked in kroner against the fee.
 * "Fakturér rate" on a klar instalment creates an invoice draft with one line.
 */
import { FULL_BP, PHASE_TEMPLATES, todayCopenhagen } from "@arc-tid/domain";
import { Button, Card } from "@arc-tid/ui";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { fmtDay, fmtKr, fmtPct } from "@/lib/format";
import { Pill } from "./shared";

export interface PlanItem {
  id: string;
  sequence: number;
  description: string;
  taskId: string | null;
  percentageBp: number | null;
  amount: number;
  plannedDate: string;
  status: "afventer" | "planlagt" | "klar" | "faktureret";
  reserved: boolean;
  locked: boolean;
}
export interface Plan {
  contractId: string;
  name: string;
  type: "fixed_price" | "retainer";
  price: number | null;
  planActive: boolean;
  validation: { ok: boolean; totalBp: number; total: number } | null;
  items: PlanItem[];
}

interface Draft {
  id?: string;
  description: string;
  taskId: string;
  share: string;
  /** fixed price: a share of the fee or an exact amount; a retainer is always "kr" */
  unit: "pct" | "kr";
  plannedDate: string;
  locked: boolean;
}

const TONE = { afventer: "neutral", planlagt: "neutral", klar: "brand", faktureret: "success" } as const;
const num = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

/** The billing plan card for one fixed-fee or retainer contract. */
export function BillingPlan({
  plan,
  phases,
  caseId,
  canEdit,
  canInvoice,
}: {
  plan: Plan;
  phases: { id: string; wbs: string; name: string; level: number }[];
  caseId: string;
  canEdit: boolean;
  canInvoice: boolean;
}) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Draft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const fixed = plan.type === "fixed_price";
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["case-finance-detail", caseId] });
    void qc.invalidateQueries({ queryKey: ["case-finance"] });
  };
  const fail = (e: unknown) => setError(errorText(e, t));
  const date = (d: string) => fmtDay(d, locale, { day: "numeric", month: "short", year: "numeric" });

  function startEdit() {
    setError(null);
    setEditing(
      plan.items.map((i) => ({
        id: i.id,
        description: i.description,
        taskId: i.taskId ?? "",
        share:
          fixed && i.percentageBp !== null
            ? String(i.percentageBp / 100).replace(".", ",")
            : String(i.amount / 100).replace(".", ","),
        unit: fixed && i.percentageBp !== null ? ("pct" as const) : ("kr" as const),
        plannedDate: i.plannedDate,
        locked: i.locked,
      })),
    );
  }

  // the plan's sum in øre: shares of the fee plus exact amounts (the server checks the same, to the øre)
  const fee = plan.price ?? 0;
  const pctRows = (editing ?? []).filter((d) => d.unit === "pct");
  const allPct = fixed && pctRows.length === (editing ?? []).length;
  const pctBp = pctRows.reduce((a, d) => a + Math.round((num(d.share) || 0) * 100), 0);
  const sumOre =
    (allPct && pctBp === FULL_BP ? fee : Math.round((fee * pctBp) / FULL_BP)) +
    (editing ?? [])
      .filter((d) => d.unit === "kr")
      .reduce((a, d) => a + Math.round((num(d.share) || 0) * 100), 0);
  const sharesBp = fee > 0 ? Math.round((sumOre * FULL_BP) / fee) : 0;
  const sumOk = !fixed || (fee > 0 && sumOre === fee);

  async function save(activate: boolean) {
    if (!editing) return;
    try {
      await api(`/case-finance/contracts/${plan.contractId}/plan`, {
        method: "PUT",
        body: JSON.stringify({
          activate,
          items: editing.map((d) => ({
            id: d.id,
            description: d.description,
            taskId: d.taskId || null,
            percentage: fixed && d.unit === "pct" ? num(d.share) : null,
            amount: fixed && d.unit === "pct" ? null : num(d.share),
            plannedDate: d.plannedDate,
          })),
        }),
      });
      setEditing(null);
      setError(null);
      refresh();
    } catch (e) {
      fail(e);
    }
  }

  async function invoice(id: string) {
    try {
      const r = await api<{ invoiceId: string }>(`/case-finance/plan-items/${id}/invoice`, {
        method: "POST",
      });
      setDrafts((d) => ({ ...d, [id]: r.invoiceId }));
      refresh();
    } catch (e) {
      fail(e);
    }
  }

  const update = (idx: number, patch: Partial<Draft>) =>
    setEditing((rows) => rows?.map((r, i) => (i === idx ? { ...r, ...patch } : r)) ?? null);
  const addRow = (name?: string) =>
    setEditing((rows) => {
      const list = rows ?? [];
      const phase = name ? phases.find((p) => p.name.toLowerCase().includes(name.toLowerCase())) : undefined;
      return [
        ...list,
        {
          description: name ? `Rate ${list.length + 1} · ${name}` : `Rate ${list.length + 1}`,
          taskId: phase?.id ?? "",
          share: "",
          unit: fixed ? ("pct" as const) : ("kr" as const),
          plannedDate: list.at(-1)?.plannedDate ?? todayCopenhagen(),
          locked: false,
        },
      ];
    });

  return (
    <Card title={`${t("bp.title")} · ${plan.name}`}>
      <p className="-mt-2 mb-3 flex flex-wrap items-center gap-2 text-sm text-ink-700">
        <Pill tone={plan.planActive ? "success" : "warning"}>
          {plan.planActive ? t("bp.activePlan") : t("bp.draftPlan")}
        </Pill>
        {plan.price !== null && fixed && (
          <span>
            {t("cf.case.fee")}:{" "}
            <span className="font-semibold tabular-nums text-ink-900">{fmtKr(plan.price, locale)}</span>
          </span>
        )}
        {plan.validation && !plan.validation.ok && (
          <span className="text-warning">
            {t("bp.sum", { pct: fmtPct(plan.validation.totalBp, locale) })}
          </span>
        )}
      </p>

      {!editing && (
        <>
          {plan.items.length ? (
            <ol className="flex flex-col divide-y divide-line text-sm">
              {plan.items.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                  <span className="w-6 text-ink-500 tabular-nums">{i.sequence}.</span>
                  <span className="min-w-48 flex-1">
                    <span className="block text-ink-900">{i.description}</span>
                    <span className="text-xs text-ink-500">
                      {date(i.plannedDate)}
                      {i.percentageBp !== null && ` · ${fmtPct(i.percentageBp, locale)}`}
                      {i.taskId && ` · ${phases.find((p) => p.id === i.taskId)?.name ?? ""}`}
                    </span>
                  </span>
                  <span className="whitespace-nowrap font-semibold tabular-nums text-ink-900">
                    {fmtKr(i.amount, locale)}
                  </span>
                  <span className="flex min-w-36 items-center justify-end gap-2">
                    <Pill tone={TONE[i.status]}>{t(`bp.status.${i.status}` as MessageKey)}</Pill>
                    {i.reserved && <Pill tone="neutral">{t("bp.onDraft")}</Pill>}
                  </span>
                  {canInvoice && i.status === "klar" && !i.reserved && !drafts[i.id] && (
                    <Button variant="secondary" className="h-8" onClick={() => invoice(i.id)}>
                      {t("cf.ready.invoice")}
                    </Button>
                  )}
                  {drafts[i.id] && (
                    <Link
                      href={`/invoicing/${drafts[i.id]}`}
                      className="text-xs font-semibold text-brand-700 hover:underline"
                    >
                      {t("cf.ready.open")} →
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-ink-500">{t("bp.empty")}</p>
          )}
          <p className="mt-3 text-xs text-ink-500">{t("bp.readyRule")}</p>
          {canEdit && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button variant="ghost" onClick={startEdit}>
                {t("bp.edit")}
              </Button>
              {fixed && (
                <Link
                  href={`/projects/${caseId}/rateplan?contract=${plan.contractId}`}
                  className="text-sm font-semibold text-brand-700 hover:underline"
                >
                  {t("fp.open")} →
                </Link>
              )}
            </div>
          )}
        </>
      )}

      {editing && (
        <div className="flex flex-col gap-3 text-sm">
          <div className="relative -mx-5 overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th scope="col" className="w-[38%] px-5 py-1 text-left font-semibold">
                    {t("bp.name")}
                  </th>
                  <th scope="col" className="w-[26%] px-2 py-1 text-left font-semibold">
                    {t("bp.phaseLink")}
                  </th>
                  <th scope="col" className="px-2 py-1 text-right font-semibold">
                    {fixed ? t("bp.share") : t("bp.amount")}
                  </th>
                  <th scope="col" className="px-2 py-1 text-left font-semibold">
                    {t("bp.date")}
                  </th>
                  <th scope="col" className="px-2 py-1">
                    <span className="sr-only">{t("bp.remove")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {editing.map((d, idx) => (
                  <tr key={d.id ?? `new-${idx}`}>
                    <td className="px-5 py-1">
                      <input
                        aria-label={t("bp.name")}
                        value={d.description}
                        onChange={(e) => update(idx, { description: e.target.value })}
                        className="h-9 w-full rounded border border-line bg-surface px-2"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <select
                        aria-label={t("bp.phaseLink")}
                        value={d.taskId}
                        disabled={d.locked}
                        onChange={(e) => update(idx, { taskId: e.target.value })}
                        className="h-9 w-full rounded border border-line bg-surface px-2"
                      >
                        <option value="">{t("bp.noPhase")}</option>
                        {phases.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.wbs} {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-right whitespace-nowrap">
                      <input
                        aria-label={fixed ? t("bp.share") : t("bp.amount")}
                        inputMode="decimal"
                        value={d.share}
                        disabled={d.locked}
                        onChange={(e) => update(idx, { share: e.target.value })}
                        className={`h-9 rounded border border-line bg-surface px-2 text-right tabular-nums ${d.unit === "kr" ? "w-32" : "w-20"}`}
                      />
                      {fixed ? (
                        <select
                          aria-label={t("bp.unit")}
                          value={d.unit}
                          disabled={d.locked}
                          onChange={(e) => update(idx, { unit: e.target.value as Draft["unit"] })}
                          className="ml-1 h-9 rounded border border-line bg-surface px-1 text-xs"
                        >
                          <option value="pct">%</option>
                          <option value="kr">kr</option>
                        </select>
                      ) : (
                        <span className="ml-1 text-xs text-ink-500">kr</span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="date"
                        aria-label={t("bp.date")}
                        value={d.plannedDate}
                        disabled={d.locked}
                        onChange={(e) => update(idx, { plannedDate: e.target.value })}
                        className="h-9 rounded border border-line bg-surface px-2"
                      />
                    </td>
                    <td className="px-2 py-1 text-right">
                      {!d.locked && (
                        <button
                          type="button"
                          className="text-xs font-semibold text-ink-500 hover:text-danger"
                          onClick={() => setEditing((rows) => rows?.filter((_, i) => i !== idx) ?? null)}
                        >
                          {t("bp.remove")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => addRow()}>
              + {t("bp.add")}
            </Button>
            <span className="text-xs text-ink-500">{t("bp.template")}:</span>
            {PHASE_TEMPLATES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => addRow(p)}
                className="rounded-[var(--radius-pill)] border border-line px-2.5 py-0.5 text-xs text-ink-700 hover:bg-surface-alt"
              >
                {p}
              </button>
            ))}
          </div>
          {fixed && (
            <p className={`font-semibold ${sumOk ? "text-success" : "text-warning"}`}>
              {t("bp.sum", { pct: fmtPct(sharesBp, locale) })}
              {plan.price !== null && ` · ${fmtKr(sumOre, locale, 2)} / ${fmtKr(fee, locale, 2)}`}
            </p>
          )}
          {!sumOk && <p className="text-xs text-ink-500">{t("bp.mustBe100")}</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => save(true)} disabled={!sumOk || !editing.length}>
              {t("bp.activate")}
            </Button>
            <Button variant="secondary" onClick={() => save(false)}>
              {t("bp.saveDraft")}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          ⚠ {error}
        </p>
      )}
    </Card>
  );
}
