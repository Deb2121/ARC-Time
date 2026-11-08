"use client";

/**
 * Expense approval list for line managers and Finance (brief §4.7, decision D-019): each submitted expense with
 * receipt link, approve, or reject with a required comment. Shown as a tab on the approval page.
 */
import { Button } from "@arc-tid/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { API_URL, ApiError, api } from "@/lib/api";
import { fmtDay, fmtKr } from "@/lib/format";

interface PendingExpense {
  id: string;
  employee: string;
  initials: string;
  date: string;
  kind: "expense" | "mileage";
  description: string;
  typeName: string | null;
  projectNumber: string | null;
  projectName: string | null;
  grossAmount: number;
  km: number | null;
  billable: boolean;
  receiptFileId: string | null;
}

/** Lists submitted expenses waiting for the signed-in approver. */
export function ExpenseApprovals() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const pending = useQuery({
    queryKey: ["expense-approvals"],
    queryFn: () => api<PendingExpense[]>("/expense-approvals"),
  });
  const [rejecting, setRejecting] = useState<{ id: string; comment: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = () => {
    setRejecting(null);
    setError(null);
    return qc.invalidateQueries({ queryKey: ["expense-approvals"] });
  };
  const fail = (e: unknown) =>
    setError(e instanceof ApiError ? t(`err.${e.code}` as MessageKey) : t("common.error"));

  if (pending.isLoading) return <p className="text-ink-500">{t("common.loading")}</p>;
  if (!pending.data?.length) return <p className="text-ink-500">{t("ap.noExpenses")}</p>;
  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-danger">
          ⚠ {error}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {pending.data.map((x) => (
          <li key={x.id} className="rounded-lg border border-line bg-surface">
            <div className="flex flex-wrap items-center gap-4 p-4 text-sm">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-ink-900 text-xs font-semibold text-white">
                {x.initials}
              </span>
              <div className="min-w-48 flex-1">
                <p className="font-semibold text-ink-900">
                  {x.employee} · {fmtDay(x.date, locale, { day: "numeric", month: "short" })}
                </p>
                <p className="text-ink-700">
                  {x.kind === "mileage"
                    ? `${t("ex.kind.mileage")} ${String(x.km).replace(".", ",")} km`
                    : (x.typeName ?? t("ex.kind.expense"))}{" "}
                  · {x.description}
                </p>
                <p className="text-xs text-ink-500">
                  {x.projectNumber ? `${x.projectNumber} ${x.projectName}` : t("ex.noProject")}
                  {x.billable ? ` · ${t("ex.billable")}` : ""}
                </p>
              </div>
              {x.receiptFileId && (
                <a
                  className="text-xs font-semibold text-brand-700 hover:underline"
                  href={`${API_URL}/api/v1/files/${x.receiptFileId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  📎 {t("ex.viewReceipt")}
                </a>
              )}
              <span className="w-28 text-right font-semibold tabular-nums text-ink-900">
                {fmtKr(x.grossAmount, locale, 2)}
              </span>
              <span className="flex gap-2">
                <Button variant="secondary" onClick={() => setRejecting({ id: x.id, comment: "" })}>
                  {t("ap.reject")}
                </Button>
                <Button
                  onClick={() => api(`/expenses/${x.id}/approve`, { method: "POST" }).then(done).catch(fail)}
                >
                  {t("ap.approve")}
                </Button>
              </span>
            </div>
            {rejecting?.id === x.id && (
              <form
                className="flex flex-wrap items-end gap-3 border-t border-line bg-surface-alt p-4 text-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (rejecting.comment.trim())
                    void api(`/expenses/${x.id}/reject`, {
                      method: "POST",
                      body: JSON.stringify({ comment: rejecting.comment }),
                    })
                      .then(done)
                      .catch(fail);
                }}
              >
                <label className="flex min-w-72 flex-1 flex-col gap-1">
                  <span className="font-semibold text-ink-900">{t("ap.rejectReason")}</span>
                  <input
                    // biome-ignore lint/a11y/noAutofocus: opened by the user's reject action
                    autoFocus
                    required
                    value={rejecting.comment}
                    onChange={(e) => setRejecting({ ...rejecting, comment: e.target.value })}
                    className="h-10 rounded-[var(--radius-control)] border border-line bg-surface px-3"
                  />
                </label>
                <Button type="submit" disabled={!rejecting.comment.trim()}>
                  {t("ap.reject")}
                </Button>
                <Button variant="ghost" onClick={() => setRejecting(null)}>
                  {t("common.cancel")}
                </Button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
