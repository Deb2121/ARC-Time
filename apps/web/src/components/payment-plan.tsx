"use client";

/**
 * Payment plan card on the project page: fixed-price milestones / retainer fees (brief §4.3, §4.10).
 * Lists items with status, lets the project manager add items and mark them ready for invoicing.
 */

import { Badge, Button, Card } from "@arc-tid/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { ApiError, api } from "@/lib/api";
import { fmtDay, fmtKr } from "@/lib/format";

interface Item {
  id: string;
  contractId: string;
  description: string;
  dueDate: string;
  amount: number;
  status: "planned" | "ready" | "invoiced";
}

/** Fixed-price payment plan / retainer fee schedule on the project page (brief §4.3). */
export function PaymentPlan({
  projectId,
  contracts,
  canEdit,
}: {
  projectId: string;
  contracts: { id: string; name: string; type: string }[];
  canEdit: boolean;
}) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const plan = useQuery({
    queryKey: ["plan", projectId],
    queryFn: () => api<Item[]>(`/projects/${projectId}/payment-plan`),
  });
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const planContracts = contracts.filter((c) => c.type !== "time_material");
  if (!planContracts.length) return null;
  const refresh = () => qc.invalidateQueries({ queryKey: ["plan", projectId] });
  const fail = (e: unknown) =>
    setError(e instanceof ApiError ? t(`err.${e.code}` as MessageKey) : t("common.error"));

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api(`/contracts/${f.get("contract")}/plan-items`, {
        method: "POST",
        body: JSON.stringify({
          description: f.get("description"),
          dueDate: f.get("dueDate"),
          amount: Number(String(f.get("amount")).replace(/\./g, "").replace(",", ".")),
        }),
      });
      setAdding(false);
      await refresh();
    } catch (err) {
      fail(err);
    }
  }

  const items = plan.data ?? [];
  const total = items.reduce((a, i) => a + i.amount, 0);

  return (
    <Card title={t("pp.title")}>
      <ul className="flex flex-col divide-y divide-line text-sm">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0 flex-1">
              <span className="block text-ink-900">{i.description}</span>
              <span className="text-xs text-ink-500">
                {fmtDay(i.dueDate, locale, { day: "numeric", month: "short", year: "numeric" })}
              </span>
            </span>
            <span className="whitespace-nowrap font-semibold tabular-nums text-ink-900">
              {fmtKr(i.amount, locale)}
            </span>
            <span className="flex w-full items-center justify-end gap-2 sm:w-auto">
              <Badge tone={i.status === "invoiced" ? "brand" : "neutral"}>
                {t(`pp.status.${i.status}` as MessageKey)}
              </Badge>
              {canEdit && i.status !== "invoiced" && (
                <button
                  type="button"
                  className="text-xs font-semibold text-ink-500 hover:text-brand-700"
                  onClick={() =>
                    api(`/plan-items/${i.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ status: i.status === "ready" ? "planned" : "ready" }),
                    })
                      .then(refresh)
                      .catch(fail)
                  }
                >
                  {i.status === "ready" ? t("pp.unready") : t("pp.markReady")}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex justify-between border-t border-line pt-2 text-sm font-semibold text-ink-900">
        <span>{t("common.total")}</span>
        <span className="tabular-nums">{fmtKr(total, locale)}</span>
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          ⚠ {error}
        </p>
      )}
      {canEdit && !adding && (
        <Button variant="ghost" className="mt-2" onClick={() => setAdding(true)}>
          + {t("pp.add")}
        </Button>
      )}
      {adding && (
        <form onSubmit={add} className="mt-3 flex flex-col gap-2 rounded-lg bg-surface-alt p-3 text-sm">
          {planContracts.length > 1 ? (
            <select
              name="contract"
              className="h-9 rounded border border-line px-2"
              aria-label={t("pr.contract")}
            >
              {planContracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <input type="hidden" name="contract" value={planContracts[0]?.id} />
          )}
          <input
            name="description"
            required
            placeholder={t("inv.description")}
            aria-label={t("inv.description")}
            className="h-9 rounded border border-line px-2"
          />
          <div className="flex gap-2">
            <input
              name="dueDate"
              type="date"
              required
              aria-label={t("pp.dueDate")}
              className="h-9 flex-1 rounded border border-line px-2"
            />
            <input
              name="amount"
              required
              inputMode="decimal"
              placeholder={t("inv.amount")}
              aria-label={t("inv.amount")}
              className="h-9 w-32 rounded border border-line px-2"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit">{t("common.save")}</Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
