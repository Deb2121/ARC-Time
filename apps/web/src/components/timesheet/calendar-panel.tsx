"use client";
/**
 * "From my calendar" panel on the timesheet (docs/spec/integrations.md R6): lists the week's Outlook meetings (read
 * only), lets the employee tick some and register them as draft hours on one task, or ignore them. Talks to
 * /timesheet/calendar/* (apps/api/src/routes/calendar.ts). Shows a plain explanation when the import is switched
 * off or the user has not signed in with Microsoft.
 */

import { Badge, Button } from "@arc-tid/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { API_URL, ApiError, api } from "@/lib/api";
import { fmtDay, fmtHours } from "@/lib/format";
import type { TaskRef } from "./types";

/** One meeting-day from the API. */
interface CalendarItem {
  eventId: string;
  subject: string;
  date: string;
  from: string;
  to: string;
  hours: number;
  state: "new" | "imported" | "ignored";
}

/** The calendar panel for one week; `onClose` hides it. */
export function CalendarPanel({ weekStart, onClose }: { weekStart: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [taskId, setTaskId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cal = useQuery({
    queryKey: ["calendar", weekStart],
    queryFn: () =>
      api<{ status: "disabled" | "not_connected" | "connected"; items: CalendarItem[] }>(
        `/timesheet/calendar/${weekStart}`,
      ),
  });
  const tasks = useQuery({ queryKey: ["ts-tasks"], queryFn: () => api<TaskRef[]>("/timesheet/tasks") });
  const key = (i: CalendarItem) => `${i.eventId}|${i.date}`;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["calendar", weekStart] });
    void qc.invalidateQueries({ queryKey: ["week", weekStart] });
  };
  const fail = (e: unknown) =>
    setError(e instanceof ApiError ? t(`err.${e.code}` as MessageKey) : t("common.error"));

  const importPicked = useMutation({
    mutationFn: () =>
      api("/timesheet/calendar/import", {
        method: "POST",
        body: JSON.stringify({
          items: (cal.data?.items ?? [])
            .filter((i) => picked.has(key(i)))
            .map((i) => ({ eventId: i.eventId, date: i.date, subject: i.subject, taskId, hours: i.hours })),
        }),
      }),
    onSuccess: () => {
      setPicked(new Set());
      setError(null);
      refresh();
    },
    onError: fail,
  });
  const ignore = useMutation({
    mutationFn: (i: CalendarItem) =>
      api("/timesheet/calendar/ignore", {
        method: "POST",
        body: JSON.stringify({ eventId: i.eventId, date: i.date }),
      }),
    onSuccess: refresh,
    onError: fail,
  });

  const toggle = (k: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  let body: React.ReactNode;
  if (!cal.data) body = <p className="text-sm text-ink-500">{t("common.loading")}</p>;
  else if (cal.data.status === "disabled") body = <p className="text-sm text-ink-700">{t("cal.disabled")}</p>;
  else if (cal.data.status === "not_connected")
    body = (
      <p className="text-sm text-ink-700">
        {t("cal.notConnected")}{" "}
        <a
          href={`${API_URL}/api/v1/auth/entra/login`}
          className="font-semibold text-brand-700 hover:underline"
        >
          {t("auth.entra")} →
        </a>
      </p>
    );
  else if (cal.data.items.length === 0) body = <p className="text-sm text-ink-700">{t("cal.empty")}</p>;
  else
    body = (
      <>
        <ul className="divide-y divide-line">
          {cal.data.items.map((i) => (
            <li key={key(i)} className="flex items-center gap-3 py-2 text-sm">
              {i.state === "new" ? (
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--color-brand-600)]"
                  checked={picked.has(key(i))}
                  onChange={() => toggle(key(i))}
                  aria-label={`${i.subject}, ${fmtDay(i.date, locale, { weekday: "long" })} ${i.from}–${i.to}`}
                />
              ) : (
                <span className="h-4 w-4" aria-hidden="true" />
              )}
              <span className="w-28 shrink-0 first-letter:uppercase text-ink-500">
                {fmtDay(i.date, locale, { weekday: "short", day: "numeric" })} · {i.from}–{i.to}
              </span>
              <span className={`flex-1 ${i.state === "new" ? "text-ink-900" : "text-ink-500"}`}>
                {i.subject}
              </span>
              <span className="tabular-nums text-ink-700">{fmtHours(i.hours, locale)} t</span>
              {i.state === "new" ? (
                <button
                  type="button"
                  className="text-xs text-ink-500 hover:underline"
                  onClick={() => ignore.mutate(i)}
                >
                  {t("cal.ignore")}
                </button>
              ) : (
                <Badge>{t(i.state === "imported" ? "cal.imported" : "cal.ignored")}</Badge>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <label htmlFor="cal-task" className="text-sm text-ink-700">
            {t("cal.registerOn")}
          </label>
          <select
            id="cal-task"
            className="h-10 min-w-64 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
          >
            <option value="">{t("cal.chooseTask")}</option>
            {(tasks.data ?? []).map((x) => (
              <option key={x.taskId} value={x.taskId}>
                {x.projectNumber} {x.projectName} · {x.taskName}
              </option>
            ))}
          </select>
          <Button
            onClick={() => importPicked.mutate()}
            disabled={!taskId || picked.size === 0 || importPicked.isPending}
          >
            {t("cal.import", { count: picked.size })}
          </Button>
        </div>
      </>
    );

  return (
    <section aria-labelledby="cal-title" className="rounded-lg border border-line bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="cal-title" className="text-base font-medium">
          {t("cal.title")}
        </h2>
        <button type="button" onClick={onClose} className="text-sm text-ink-500 hover:underline">
          {t("common.close")}
        </button>
      </div>
      {body}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <p className="mt-3 text-xs text-ink-500">{t("cal.readOnly")}</p>
    </section>
  );
}
