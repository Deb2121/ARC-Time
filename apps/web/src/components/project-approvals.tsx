"use client";

/**
 * Project manager approval list (docs/spec/approval.md, mode pm_then_line_manager, decision D-022): each
 * employee's submitted hours on the caller's projects, grouped per week and project, with the entries behind them.
 * Approve, or reject with a required comment (only that project's hours go back). Tab on the approval page;
 * talks to /approvals/projects (apps/api/src/services/project-approval.ts).
 */
import { Button } from "@arc-tid/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { ApiError, api } from "@/lib/api";
import { fmtDay, fmtHours, weekLabel } from "@/lib/format";

/** One employee × week × project waiting for the project manager. */
interface PmItem {
  userId: string;
  fullName: string;
  weekStart: string;
  projectId: string;
  projectNumber: string;
  projectName: string;
  hours: number;
  billable: number;
  entries: { date: string; taskName: string; hours: number; comment: string | null }[];
}

/** Lists the project manager's open approval steps. */
export function ProjectApprovals() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const inbox = useQuery({
    queryKey: ["pm-approvals"],
    queryFn: () => api<{ enabled: boolean; items: PmItem[] }>("/approvals/projects"),
  });
  const [rejecting, setRejecting] = useState<{ key: string; comment: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = (x: PmItem) => `${x.userId}|${x.weekStart}|${x.projectId}`;
  const decide = (x: PmItem, decision: "approve" | "reject", comment?: string) =>
    api("/approvals/projects/decide", {
      method: "POST",
      body: JSON.stringify({
        userId: x.userId,
        weekStart: x.weekStart,
        projectId: x.projectId,
        decision,
        comment,
      }),
    })
      .then(() => {
        setRejecting(null);
        setError(null);
        void qc.invalidateQueries({ queryKey: ["pm-approvals"] });
        void qc.invalidateQueries({ queryKey: ["approvals"] });
      })
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? t(`err.${e.code}` as MessageKey) : t("common.error")),
      );

  if (inbox.isLoading) return <p className="text-ink-500">{t("common.loading")}</p>;
  if (!inbox.data?.enabled) return <p className="text-ink-500">{t("ap.pmDisabled")}</p>;
  if (!inbox.data.items.length) return <p className="text-ink-500">{t("ap.pmEmpty")}</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-700">{t("ap.pmIntro")}</p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          ⚠ {error}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {inbox.data.items.map((x) => (
          <li key={key(x)} className="rounded-lg border border-line bg-surface">
            <div className="flex flex-wrap items-center gap-4 p-4 text-sm">
              <div className="min-w-56 flex-1">
                <p className="font-semibold text-ink-900">
                  {x.fullName} · {weekLabel(x.weekStart, locale)}
                </p>
                <p className="text-ink-700">
                  {x.projectNumber} {x.projectName}
                </p>
              </div>
              <span className="tabular-nums text-ink-900">
                {fmtHours(x.hours, locale)} t
                <span className="text-ink-500">
                  {" "}
                  · {t("ap.pmBillable", { hours: fmtHours(x.billable, locale) })}
                </span>
              </span>
              <span className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setOpen(open === key(x) ? null : key(x))}
                  aria-expanded={open === key(x)}
                >
                  {t("ap.pmEntries", { count: x.entries.length })}
                </Button>
                <Button variant="secondary" onClick={() => setRejecting({ key: key(x), comment: "" })}>
                  {t("ap.reject")}
                </Button>
                <Button onClick={() => void decide(x, "approve")}>{t("ap.approve")}</Button>
              </span>
            </div>
            {open === key(x) && (
              <table className="w-full border-t border-line text-sm">
                <tbody>
                  {x.entries.map((e) => (
                    <tr
                      key={`${e.date}-${e.taskName}-${e.hours}`}
                      className="border-b border-line last:border-0"
                    >
                      <td className="w-32 px-4 py-2 first-letter:uppercase text-ink-500">
                        {fmtDay(e.date, locale, { weekday: "short", day: "numeric", month: "short" })}
                      </td>
                      <td className="px-4 py-2 text-ink-900">{e.taskName}</td>
                      <td className="px-4 py-2 text-ink-700">{e.comment ?? ""}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtHours(e.hours, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {rejecting?.key === key(x) && (
              <form
                className="flex flex-wrap items-end gap-3 border-t border-line bg-surface-alt p-4 text-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (rejecting.comment.trim().length >= 3) void decide(x, "reject", rejecting.comment);
                }}
              >
                <label className="flex min-w-72 flex-1 flex-col gap-1">
                  <span className="font-semibold text-ink-900">{t("ap.rejectReason")}</span>
                  <input
                    // biome-ignore lint/a11y/noAutofocus: opened by the user's reject action
                    autoFocus
                    required
                    minLength={3}
                    value={rejecting.comment}
                    onChange={(e) => setRejecting({ ...rejecting, comment: e.target.value })}
                    className="h-10 rounded-[var(--radius-control)] border border-line bg-surface px-3"
                  />
                </label>
                <Button type="submit" disabled={rejecting.comment.trim().length < 3}>
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
