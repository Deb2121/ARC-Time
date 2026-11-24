"use client";

/**
 * The end of a case's life (D-041): "Afslut fase" on a phase (two clicks: the instalment becomes klar at once and no
 * more hours can be registered) and the "Afslut sag" card for Admin with the checklist of what is still open.
 */
import { Button, Card } from "@arc-tid/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { fmtKr } from "@/lib/format";

/** Refreshes everything that shows phases, instalments or the case's status. */
function useRefresh(caseId: string) {
  const qc = useQueryClient();
  return () => {
    for (const key of [
      ["project", caseId],
      ["case-finance-detail", caseId],
      ["completion", caseId],
      ["case-finance"],
    ])
      void qc.invalidateQueries({ queryKey: key });
  };
}

/** "Afslut fase" / "Genåbn fase" for one phase; asks once before closing. */
export function PhaseStatusButton({
  caseId,
  taskId,
  name,
  closed,
}: {
  caseId: string;
  taskId: string;
  name: string;
  closed: boolean;
}) {
  const { t } = useI18n();
  const refresh = useRefresh(caseId);
  const [ask, setAsk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (status: "open" | "closed") =>
      api(`/tasks/${taskId}/phase-status`, { method: "POST", body: JSON.stringify({ status }) }),
    onSuccess: () => {
      setAsk(false);
      setError(null);
      refresh();
    },
    onError: (e) => {
      setAsk(false);
      setError(errorText(e, t));
    },
  });
  const link = "whitespace-nowrap text-xs font-semibold text-ink-500 hover:text-brand-700";
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {closed ? (
        <button type="button" className={link} onClick={() => m.mutate("open")} disabled={m.isPending}>
          {t("lc.reopenPhase")}
        </button>
      ) : ask ? (
        <span className="inline-flex items-center gap-2 text-xs">
          <span className="text-ink-700">{t("lc.closeAsk", { name })}</span>
          <button
            type="button"
            className="font-semibold text-brand-700 hover:underline"
            onClick={() => m.mutate("closed")}
            disabled={m.isPending}
          >
            {t("lc.closeYes")}
          </button>
          <button type="button" className="text-ink-500 hover:underline" onClick={() => setAsk(false)}>
            {t("common.cancel")}
          </button>
        </span>
      ) : (
        <button
          type="button"
          className={link}
          onClick={() => setAsk(true)}
          aria-label={`${t("lc.closePhase")}: ${name}`}
        >
          {t("lc.closePhase")}
        </button>
      )}
      {error && (
        <span role="alert" className="text-xs text-danger">
          ⚠ {error}
        </span>
      )}
    </span>
  );
}

interface Completion {
  status: string;
  canComplete: boolean;
  blockers: { code: string; count: number; amount?: number }[];
  unpaid: { count: number; amount: number };
}

/** The "Afslut sag" card (Admin): what is still open, and complete / reopen. */
export function CaseCompletion({ caseId }: { caseId: string }) {
  const { t, locale } = useI18n();
  const refresh = useRefresh(caseId);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["completion", caseId],
    queryFn: () => api<Completion>(`/projects/${caseId}/completion`),
  });
  const m = useMutation({
    mutationFn: (status: "completed" | "active") =>
      api(`/projects/${caseId}/status`, { method: "POST", body: JSON.stringify({ status }) }),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (e) => setError(errorText(e, t)),
  });
  if (!q.data?.canComplete) return null;
  const d = q.data;
  const done = d.status === "completed";
  const kr = (o: number) => fmtKr(o, locale, 2);

  return (
    <Card title={t("lc.title")}>
      {done ? (
        <p className="text-sm text-ink-700">{t("lc.isDone")}</p>
      ) : d.blockers.length ? (
        <>
          <p className="mb-2 text-sm text-ink-700">{t("lc.notYet")}</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {d.blockers.map((b) => (
              <li key={b.code} className="flex gap-2">
                <span aria-hidden="true" className="text-warning">
                  ●
                </span>
                <span>
                  {t(`lc.block.${b.code}` as MessageKey, { count: b.count })}
                  {b.amount ? <span className="tabular-nums text-ink-500"> · {kr(b.amount)}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-ink-700">✓ {t("lc.ready")}</p>
      )}
      {!done && d.unpaid.count > 0 && (
        <p className="mt-3 text-xs text-ink-500">
          {t("lc.unpaid", { count: d.unpaid.count, amount: kr(d.unpaid.amount) })}
        </p>
      )}
      <div className="mt-3">
        {done ? (
          <Button variant="secondary" onClick={() => m.mutate("active")} disabled={m.isPending}>
            {t("lc.reopenCase")}
          </Button>
        ) : (
          <Button onClick={() => m.mutate("completed")} disabled={m.isPending || d.blockers.length > 0}>
            {t("lc.complete")}
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs text-ink-500">{t(done ? "lc.doneHint" : "lc.hint")}</p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          ⚠ {error}
        </p>
      )}
    </Card>
  );
}
