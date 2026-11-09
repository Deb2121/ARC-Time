"use client";

/**
 * GDPR actions for one employee (docs/spec/administration.md, D-026), shown to Admin in the employee panel:
 * download everything about the person (data-subject export), and erase a former employee — with a preview of
 * what is kept (bookkeeping, pseudonymised) and removed, blockers explained, a required reason and a confirmation.
 */
import { Button } from "@arc-tid/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { API_URL, ApiError, api } from "@/lib/api";

/** Shape of GET /admin/employees/:id/erasure. */
interface ErasurePreview {
  alreadyErased: boolean;
  blockers: string[];
  keep: { timeEntries: number; expenses: number };
  remove: { draftEntries: number; competencies: number; plannedHours: number };
}

/** Export + erasure controls for the employee with `userId`. */
export function GdprSection({ userId }: { userId: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const preview = useQuery({
    queryKey: ["erasure", userId],
    queryFn: () => api<ErasurePreview>(`/admin/employees/${userId}/erasure`),
    enabled: open,
  });

  async function erase() {
    try {
      const r = await api<{ pseudonym: string }>(`/admin/employees/${userId}/erase`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setMsg(t("gdpr.erased", { name: r.pseudonym }));
      setOpen(false);
      await qc.invalidateQueries();
    } catch (e) {
      setMsg(e instanceof ApiError ? t(`gdpr.block.${e.code}` as MessageKey) : t("common.error"));
    }
  }

  const p = preview.data;
  return (
    <section className="mt-6 border-t border-line pt-4 text-sm">
      <h3 className="mb-2 font-semibold text-ink-900">{t("gdpr.title")}</h3>
      <div className="flex flex-wrap gap-2">
        <a
          className="inline-flex h-9 items-center rounded-[var(--radius-control)] border border-line bg-surface px-3 font-semibold text-ink-900 hover:bg-surface-alt"
          href={`${API_URL}/api/v1/admin/employees/${userId}/gdpr-export`}
        >
          ↓ {t("gdpr.export")}
        </a>
        {!open && (
          <Button variant="ghost" onClick={() => setOpen(true)}>
            {t("gdpr.erase")}
          </Button>
        )}
      </div>
      {open && p && (
        <div className="mt-3 flex flex-col gap-2 rounded-lg bg-surface-alt p-3">
          {p.alreadyErased ? (
            <p>{t("gdpr.alreadyErased")}</p>
          ) : p.blockers.length ? (
            <ul className="text-warning">
              {p.blockers.map((b) => (
                <li key={b}>⚠ {t(`gdpr.block.${b}` as MessageKey)}</li>
              ))}
            </ul>
          ) : (
            <>
              <p>{t("gdpr.keep", { entries: p.keep.timeEntries, expenses: p.keep.expenses })}</p>
              <p>
                {t("gdpr.remove", {
                  drafts: p.remove.draftEntries,
                  competencies: p.remove.competencies,
                  planned: p.remove.plannedHours,
                })}
              </p>
              <label className="flex flex-col gap-1">
                <span className="font-semibold text-ink-900">{t("gdpr.reason")}</span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2"
                />
              </label>
              <p className="text-xs text-danger">{t("gdpr.irreversible")}</p>
              <div className="flex gap-2">
                <Button disabled={reason.trim().length < 3} onClick={() => void erase()}>
                  {t("gdpr.confirm")}
                </Button>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  {t("common.cancel")}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      {msg && (
        <p role="status" className="mt-2 text-ink-700">
          {msg}
        </p>
      )}
    </section>
  );
}
