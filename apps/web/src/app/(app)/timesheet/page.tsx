"use client";

import { addDays, roundToStep, startOfIsoWeek, todayCopenhagen } from "@arc-tid/domain";
import { Badge, Button } from "@arc-tid/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useMe } from "@/components/session";
import { changeAbsenceType, removeAbsenceRow } from "@/components/timesheet/absence-actions";
import { CalendarPanel } from "@/components/timesheet/calendar-panel";
import { DayView } from "@/components/timesheet/day-view";
import { TaskPicker } from "@/components/timesheet/task-picker";
import {
  absenceRowKey,
  type Row,
  type TaskRef,
  taskRowKey,
  type WeekData,
} from "@/components/timesheet/types";
import { type RowAction, rowLabel, type Selected, WeekGrid } from "@/components/timesheet/week-grid";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { ApiError, api, type Person } from "@/lib/api";
import { fmtDay, fmtFlex, fmtHours, fmtPct, weekLabel } from "@/lib/format";

const TIMER_KEY = "arc_timer";
interface Timer {
  rowKey: string;
  taskId: string;
  label: string;
  startedAt: number;
}
const readTimer = (): Timer | null => {
  try {
    const raw = localStorage.getItem(TIMER_KEY);
    return raw ? (JSON.parse(raw) as Timer) : null;
  } catch {
    return null;
  }
};

export default function TimesheetPage() {
  return (
    <Suspense>
      <Timesheet />
    </Suspense>
  );
}

function Timesheet() {
  const { t, locale } = useI18n();
  const me = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const weekStart = startOfIsoWeek(params.get("week") ?? todayCopenhagen());
  const viewUser = params.get("user");
  const isOwn = !viewUser || viewUser === me.id;
  const view = params.get("view") === "day" ? "day" : "week";
  const today = todayCopenhagen();
  const dayParam = params.get("day");
  const selectedDay =
    dayParam && dayParam >= weekStart && dayParam <= addDays(weekStart, 6)
      ? dayParam
      : today >= weekStart && today <= addDays(weekStart, 6)
        ? today
        : weekStart;

  const week = useQuery({
    queryKey: ["week", weekStart, viewUser ?? "me"],
    queryFn: () => api<WeekData>(`/timesheet/week/${weekStart}${isOwn ? "" : `?userId=${viewUser}`}`),
  });
  const people = useQuery({ queryKey: ["users"], queryFn: () => api<Person[]>("/users"), enabled: !isOwn });
  const viewedName = people.data?.find((p) => p.id === viewUser)?.fullName;

  const [extraRows, setExtraRows] = useState<Row[]>([]);
  const [showCalendar, setShowCalendar] = useState(false);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [panel, setPanel] = useState<{
    sel: Selected;
    hours: number | null;
    comment: string;
    billable: boolean;
    error?: string;
  } | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [timer, setTimer] = useState<Timer | null>(null);
  const [, tick] = useState(0);

  useEffect(() => setTimer(readTimer()), []);
  useEffect(() => {
    if (!timer) return;
    const id = setInterval(() => tick((x) => x + 1), 15_000);
    return () => clearInterval(id);
  }, [timer]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset local rows when the week changes
  useEffect(() => {
    setExtraRows([]);
    setSelected(null);
    setPanel(null);
  }, [weekStart, viewUser]);

  const data = week.data;
  const rows = useMemo(() => {
    const server = data?.rows ?? [];
    const keys = new Set(server.map((r) => r.key));
    const sortKey = (r: Row) =>
      r.kind === "task"
        ? `0 ${r.ref.projectNumber} ${r.ref.wbs
            .split(".")
            .map((n) => n.padStart(3, "0"))
            .join(".")}`
        : `1 ${r.ref.code}`;
    // Each row key once: server rows win, and an extra row added twice is kept only once.
    const extras = extraRows.filter((r) => !keys.has(r.key) && keys.add(r.key));
    return [...server, ...extras].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  }, [data, extraRows]);
  const rowKeys = useMemo(
    () => new Set(rows.flatMap((r) => (r.kind === "task" ? [r.ref.taskId] : []))),
    [rows],
  );

  /** Navigates within the timesheet, keeping the viewed user and the week/day view in the URL. */
  const go = (w: string, v: "week" | "day" = view, day?: string) =>
    router.push(
      `/timesheet?week=${w}${isOwn ? "" : `&user=${viewUser}`}${v === "day" ? `&view=day${day ? `&day=${day}` : ""}` : ""}`,
    );
  const refresh = () => qc.invalidateQueries({ queryKey: ["week"] });

  const addTaskRow = (x: TaskRef) =>
    setExtraRows((r) => [...r, { key: taskRowKey(x.taskId), kind: "task", ref: x, cells: {} }]);

  const copyRows = useMutation({
    mutationFn: () => api<TaskRef[]>(`/timesheet/week/${weekStart}/previous-rows`),
    onSuccess: (list) => {
      for (const x of list) if (!rowKeys.has(x.taskId)) addTaskRow(x);
    },
  });

  const [actionError, setActionError] = useState<string | null>(null);
  const showError = (e: unknown) =>
    setActionError(e instanceof ApiError ? t(`err.${e.code}` as MessageKey) : t("common.error"));
  const submit = useMutation({
    mutationFn: () =>
      api<{ status: string; warnings: string[] }>(`/timesheet/week/${weekStart}/submit`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () => {
      setConfirmSubmit(false);
      setActionError(null);
      void refresh();
    },
    onError: showError,
  });
  const reopen = useMutation({
    mutationFn: () => api(`/timesheet/week/${weekStart}/reopen`, { method: "POST" }),
    onSuccess: () => void refresh(),
    onError: showError,
  });

  /** Removes an absence row, or moves its hours to another absence type (wrong reason chosen). */
  async function rowAction(a: RowAction) {
    setActionError(null);
    try {
      if (a.type === "remove") await removeAbsenceRow(a.row);
      else
        await changeAbsenceType(
          a.row,
          a.toCodeId,
          rows.find((r) => r.key === absenceRowKey(a.toCodeId)),
        );
      setExtraRows((x) => x.filter((r) => r.key !== a.row.key));
      setSelected(null);
    } catch (e) {
      showError(e);
    }
    await refresh();
  }

  const selRow = rows.find((r) => r.key === selected?.rowKey);

  function openPanel(sel: Selected, hours: number | null = null) {
    const r = rows.find((x) => x.key === sel.rowKey);
    const cell = r?.cells[sel.date];
    setPanel({
      sel,
      hours: hours ?? cell?.hours ?? null,
      comment: cell?.comment ?? "",
      billable:
        cell?.billable ?? (r?.kind === "task" ? (r.ref.taskBillable ?? r.ref.billable ?? true) : false),
    });
  }

  async function savePanel() {
    if (!panel) return;
    const r = rows.find((x) => x.key === panel.sel.rowKey);
    if (!r) return;
    try {
      await api("/timesheet/entries", {
        method: "PUT",
        body: JSON.stringify({
          date: panel.sel.date,
          ...(r.kind === "task"
            ? { taskId: r.ref.taskId, billable: panel.billable }
            : { absenceCodeId: r.ref.absenceCodeId }),
          hours: panel.hours ?? r.cells[panel.sel.date]?.hours ?? 0,
          comment: panel.comment,
        }),
      });
      setPanel(null);
      await refresh();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "invalid";
      setPanel({ ...panel, error: t(`err.${code}` as MessageKey) });
    }
  }

  function startTimer() {
    if (selRow?.kind !== "task") return;
    const tm: Timer = {
      rowKey: selRow.key,
      taskId: selRow.ref.taskId,
      label: rowLabel(selRow, locale),
      startedAt: Date.now(),
    };
    localStorage.setItem(TIMER_KEY, JSON.stringify(tm));
    setTimer(tm);
  }
  async function stopTimer() {
    if (!timer) return;
    const minutes = (Date.now() - timer.startedAt) / 60_000;
    const centi = Math.max(25, roundToStep(Math.round((minutes * 100) / 60))); // D-013: nearest quarter, min 0,25
    const today = todayCopenhagen();
    const current = await api<WeekData>(`/timesheet/week/${startOfIsoWeek(today)}`);
    const existing = current.rows.find((r) => r.key === timer.rowKey)?.cells[today]?.hours ?? 0;
    await api("/timesheet/entries", {
      method: "PUT",
      body: JSON.stringify({ date: today, taskId: timer.taskId, hours: existing + centi / 100 }),
    });
    localStorage.removeItem(TIMER_KEY);
    setTimer(null);
    await refresh();
  }

  if (week.isLoading || !data) return <p className="text-ink-500">{t("common.loading")}</p>;
  if (week.isError)
    return (
      <p role="alert" className="text-danger">
        {t("common.error")}
      </p>
    );

  const lastReject = [...data.events].reverse().find((e) => e.action === "reject");
  const statusTone = data.status === "approved" ? "brand" : "neutral";
  const elapsed = timer ? Math.floor((Date.now() - timer.startedAt) / 60_000) : 0;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-ink-500">{weekLabel(weekStart, locale)}</p>
          <h1 className="mt-1 flex items-center gap-3 text-3xl font-normal">
            {t("ts.title")} <Badge tone={statusTone}>{t(`ts.status.${data.status}` as MessageKey)}</Badge>
          </h1>
          {!isOwn && (
            <p className="mt-1 text-sm text-ink-700">{t("ts.viewing", { name: viewedName ?? "…" })}</p>
          )}
        </div>
        <nav aria-label={t("ts.title")} className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => go(addDays(weekStart, -7))} aria-label={t("ts.prev")}>
            ←
          </Button>
          <Button variant="secondary" onClick={() => go(startOfIsoWeek(todayCopenhagen()))}>
            {t("ts.thisWeek")}
          </Button>
          <Button variant="secondary" onClick={() => go(addDays(weekStart, 7))} aria-label={t("ts.next")}>
            →
          </Button>
        </nav>
      </header>

      {data.status === "submitted" && (
        <div
          className="flex items-center justify-between rounded-lg border border-line bg-surface p-4 text-sm"
          role="status"
        >
          <span>{t("ts.submitted")}</span>
          {isOwn && (
            <Button variant="secondary" onClick={() => reopen.mutate()} disabled={reopen.isPending}>
              {t("ts.reopen")}
            </Button>
          )}
        </div>
      )}
      {data.status === "approved" && (
        <div
          className="rounded-lg border border-success/30 bg-success/5 p-4 text-sm text-success"
          role="status"
        >
          ✓ {t("ts.approved")}
        </div>
      )}
      {data.status === "rejected" && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger" role="alert">
          ⚠ {t("ts.rejected", { comment: lastReject?.comment ?? "" })}
        </div>
      )}

      {actionError && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger" role="alert">
          ⚠ {actionError}
        </div>
      )}

      {timer && (
        <div
          className="flex items-center justify-between rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm"
          role="status"
        >
          <span>
            ⏱ {t("ts.timerRunning", { task: timer.label })} · {Math.floor(elapsed / 60)}:
            {String(elapsed % 60).padStart(2, "0")}
          </span>
          <Button onClick={() => void stopTimer()}>{t("ts.timerStop")}</Button>
        </div>
      )}

      {data.editable && (
        <div className="flex flex-wrap items-center gap-3">
          <TaskPicker onPick={addTaskRow} exclude={rowKeys} />
          <label className="sr-only" htmlFor="absence-select">
            {t("ts.addAbsence")}
          </label>
          <select
            id="absence-select"
            className="h-10 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm"
            value=""
            onChange={(e) => {
              const c = data.absenceCodes.find((x) => x.id === e.target.value);
              if (c && !rows.some((r) => r.key === absenceRowKey(c.id)))
                setExtraRows((r) => [
                  ...r,
                  {
                    key: absenceRowKey(c.id),
                    kind: "absence",
                    ref: { absenceCodeId: c.id, code: c.code, nameDa: c.nameDa, nameEn: c.nameEn },
                    cells: {},
                  },
                ]);
            }}
          >
            <option value="">+ {t("ts.addAbsence")}</option>
            {data.absenceCodes
              .filter((c) => !rows.some((r) => r.key === absenceRowKey(c.id)))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {locale === "da" ? c.nameDa : c.nameEn}
                </option>
              ))}
          </select>
          <Button variant="ghost" onClick={() => copyRows.mutate()} disabled={copyRows.isPending}>
            ⧉ {t("ts.copyLastWeek")}
          </Button>
          <Button variant="ghost" onClick={() => setShowCalendar((v) => !v)} aria-expanded={showCalendar}>
            ▦ {t("ts.fromCalendar")}
          </Button>
        </div>
      )}
      {data.editable && isOwn && showCalendar && (
        <CalendarPanel weekStart={weekStart} onClose={() => setShowCalendar(false)} />
      )}

      <div className="flex flex-col gap-5">
        <div className="flex min-w-0 flex-col gap-2">
          <div
            role="tablist"
            aria-label={t("ts.title")}
            className="flex gap-1 self-start rounded-[var(--radius-control)] border border-line bg-surface p-1 text-sm"
          >
            {(["week", "day"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => go(weekStart, v, v === "day" ? selectedDay : undefined)}
                className={`rounded px-3 py-1 font-semibold ${view === v ? "bg-ink-900 text-white" : "text-ink-700 hover:bg-surface-alt"}`}
              >
                {t(v === "week" ? "ts.view.week" : "ts.view.day")}
              </button>
            ))}
          </div>
          {view === "day" ? (
            <DayView week={data} rows={rows} day={selectedDay} onDay={(d) => go(weekStart, "day", d)} />
          ) : (
            <WeekGrid
              week={data}
              rows={rows}
              selected={selected}
              onSelect={setSelected}
              onCommentNeeded={(sel, hours) => {
                setSelected(sel);
                openPanel(sel, hours);
              }}
              onRowAction={isOwn ? rowAction : undefined}
            />
          )}
          {view === "week" && <p className="text-xs text-ink-500">{t("ts.keyboardHelp")}</p>}
        </div>

        <aside className="contents">
          <section
            aria-label={t("ts.registered")}
            className="order-first grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface p-4 text-sm sm:grid-cols-5"
          >
            <Stat label={t("ts.norm")} value={fmtHours(data.summary.norm, locale)} />
            <Stat
              label={t("ts.registered")}
              value={fmtHours(data.summary.work + data.summary.absence, locale)}
            />
            <Stat label={t("ts.billablePct")} value={fmtPct(data.summary.billableBp, locale)} />
            <Stat
              label={t("ts.flexWeek")}
              value={fmtFlex(data.summary.flex, locale)}
              tone={data.summary.flex < 0 ? "warning" : "success"}
            />
            <div className="col-span-2 border-t border-line pt-3 sm:col-span-1 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4">
              <Stat label={t("ts.flexBalance")} value={fmtFlex(data.flexBalance, locale)} />
            </div>
          </section>

          {selected && selRow && (
            <section className="flex max-w-xl flex-col gap-3 rounded-lg border border-line bg-surface p-4 text-sm">
              <div>
                <p className="font-semibold text-ink-900">{rowLabel(selRow, locale)}</p>
                <p className="first-letter:uppercase text-ink-500">
                  {fmtDay(selected.date, locale, { weekday: "long", day: "numeric", month: "long" })}
                </p>
              </div>
              {selRow.cells[selected.date]?.comment && !panel && (
                <p className="rounded bg-surface-alt p-2 text-ink-700">
                  “{selRow.cells[selected.date]?.comment}”
                </p>
              )}
              {data.editable && !panel && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => openPanel(selected)}>
                    ✎ {t("ts.comment")}
                  </Button>
                  {selRow.kind === "task" && !timer && (
                    <Button variant="secondary" onClick={startTimer}>
                      ⏱ {t("ts.timerStart")}
                    </Button>
                  )}
                </div>
              )}
              {panel && (
                <form
                  className="flex flex-col gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void savePanel();
                  }}
                >
                  {selRow.kind === "task" && selRow.ref.commentRequired && (
                    <p className="text-xs text-ink-500">{t("ts.commentRequired")}</p>
                  )}
                  <label className="flex flex-col gap-1">
                    <span className="font-semibold text-ink-900">{t("ts.comment")}</span>
                    <textarea
                      // biome-ignore lint/a11y/noAutofocus: the panel opens because the user asked to write a comment
                      autoFocus
                      rows={3}
                      value={panel.comment}
                      onChange={(e) => setPanel({ ...panel, comment: e.target.value })}
                      className="rounded-[var(--radius-control)] border border-line p-2 text-ink-900"
                    />
                  </label>
                  {selRow.kind === "task" && (
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={panel.billable}
                        onChange={(e) => setPanel({ ...panel, billable: e.target.checked })}
                      />
                      {t("ts.billable")}
                    </label>
                  )}
                  {panel.error && (
                    <p role="alert" className="text-danger">
                      ⚠ {panel.error}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button type="submit">{t("common.save")}</Button>
                    <Button variant="ghost" onClick={() => setPanel(null)}>
                      {t("common.cancel")}
                    </Button>
                  </div>
                </form>
              )}
            </section>
          )}
          {!selected && data.editable && !timer && (
            <p className="text-xs text-ink-500">{t("ts.timerPick")}</p>
          )}

          {isOwn && data.editable && (
            <div className="flex flex-col items-end gap-2">
              {confirmSubmit ? (
                <div
                  className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm"
                  role="alertdialog"
                  aria-label={t("ts.submit")}
                >
                  <p className="mb-2 text-ink-900">
                    {t("ts.submitConfirm", { diff: fmtHours(-data.summary.flex, locale) })}
                  </p>
                  <div className="flex gap-2">
                    <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
                      {t("ts.submit")}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmSubmit(false)}>
                      {t("common.cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  onClick={() => (data.summary.flex < 0 ? setConfirmSubmit(true) : submit.mutate())}
                  disabled={submit.isPending}
                  className="min-w-48"
                >
                  {t("ts.submit")}
                </Button>
              )}
            </div>
          )}
          {!isOwn && (
            <Link
              href={`/approval?week=${weekStart}`}
              className="text-sm font-semibold text-brand-700 hover:underline"
            >
              ← {t("ap.title")}
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  large,
}: {
  label: string;
  value: string;
  tone?: "warning" | "success";
  large?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-ink-500">{label}</p>
      <p
        className={`font-[family-name:var(--font-display)] tabular-nums ${large ? "text-2xl" : "text-lg"} ${
          tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-ink-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
