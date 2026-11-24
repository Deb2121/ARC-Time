"use client";

/**
 * Weekly timesheet grid (docs/spec/time-tracking.md). Keyboard model:
 *   Tab / Shift+Tab — next / previous cell (row by row)
 *   ↑ / ↓          — same day, previous / next row
 *   ← / →          — previous / next day when the caret is at the start / end of the value
 *   Enter          — save and move down;  Esc — revert the cell
 * Values are saved on blur. Validation uses the same domain rules as the API.
 */
import { isOnStep, parseHours } from "@arc-tid/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, type ReactNode, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { fmtDay, fmtFlex, fmtHours } from "@/lib/format";
import type { Row, WeekData } from "./types";

export interface Selected {
  rowKey: string;
  date: string;
}

/** What the employee can do with a row: remove it (task or absence) or move absence hours (the page saves). */
export type RowAction = { type: "remove"; row: Row } | { type: "change"; row: Row; toCodeId: string };

interface Props {
  week: WeekData;
  rows: Row[];
  selected: Selected | null;
  onSelect: (s: Selected) => void;
  /** remove a row / move absence hours to another absence type; omitted = no row actions */
  onRowAction?: (a: RowAction) => Promise<void>;
  /** optional footer row under the totals, one cell per day (e.g. "Udlæg/kørsel") */
  dayRow?: { label: string; cells: Record<string, ReactNode> } | null;
}

/** Human-readable label for a timesheet row (used for accessible cell names and panels). */
export const rowLabel = (r: Row, locale: "da" | "en") =>
  r.kind === "task"
    ? `${r.ref.projectNumber} ${r.ref.projectName} – ${r.ref.taskName}`
    : locale === "da"
      ? r.ref.nameDa
      : r.ref.nameEn;

/**
 * Keyboard-first weekly timesheet grid. Tab/Shift+Tab moves, ↑↓ change row, ←→ change day at the caret edge,
 * Enter saves and moves down, Esc reverts. Saves on blur with the same validation rules as the API.
 */
export function WeekGrid({ week, rows, selected, onSelect, onRowAction, dayRow }: Props) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const gridRef = useRef<HTMLTableElement>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [announce, setAnnounce] = useState("");
  const readOnly = !week.editable;
  // Absence row actions: which row asks "really remove?" or shows the "change to" list.
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [changing, setChanging] = useState<string | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  async function act(a: RowAction) {
    if (!onRowAction) return;
    setBusyRow(a.row.key);
    try {
      await onRowAction(a);
    } finally {
      setBusyRow(null);
      setConfirmRemove(null);
      setChanging(null);
    }
  }

  /**
   * "Fjern" on a row: an empty row goes at once; a row with hours asks first. Task rows get it too, so a project
   * picked by mistake (also in a future week, where no hours can be typed) can be taken off again.
   */
  function removeControl(r: Row, label: string, rowTotal: number) {
    if (confirmRemove === r.key)
      return (
        <>
          <span className="font-semibold text-ink-900">
            {t(r.kind === "task" ? "ts.removeTaskConfirm" : "ts.removeConfirm", {
              hours: fmtHours(rowTotal, locale),
            })}
          </span>
          <button
            type="button"
            disabled={busyRow === r.key}
            className="rounded-md bg-danger px-2.5 py-1 font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
            onClick={() => void act({ type: "remove", row: r })}
          >
            {t("ts.removeYes")}
          </button>
          <button
            type="button"
            className="rounded-md border border-line bg-surface px-2.5 py-1 font-semibold text-ink-700 hover:bg-surface-alt"
            onClick={() => setConfirmRemove(null)}
          >
            {t("common.cancel")}
          </button>
        </>
      );
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md border border-danger/40 bg-danger/5 px-2 py-0.5 font-semibold text-danger transition-colors hover:border-danger hover:bg-danger hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
        onClick={() => {
          if (rowTotal > 0) setConfirmRemove(r.key);
          else void act({ type: "remove", row: r });
        }}
        aria-label={t(r.kind === "task" ? "ts.removeTaskRowFor" : "ts.removeRowFor", { row: label })}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
        </svg>
        {t("ts.removeRow")}
      </button>
    );
  }

  const save = useMutation({
    mutationFn: (body: { date: string; taskId?: string; absenceCodeId?: string; hours: number }) =>
      api("/timesheet/entries", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["week"] }),
  });

  const cellKey = (rowKey: string, date: string) => `${rowKey}|${date}`;
  const serverHours = (r: Row, date: string) => r.cells[date]?.hours ?? 0;
  const display = (r: Row, date: string) =>
    drafts[cellKey(r.key, date)] ?? fmtHours(serverHours(r, date), locale, true);

  const dayTotals = useMemo(
    () => week.days.map((d) => rows.reduce((acc, r) => acc + (r.cells[d.date]?.hours ?? 0), 0)),
    [week.days, rows],
  );

  function focusCell(ri: number, ci: number) {
    const el = gridRef.current?.querySelector<HTMLInputElement>(`[data-cell="${ri}-${ci}"]`);
    if (el) {
      el.focus();
      el.select();
    }
  }

  /** Saves one cell. Returns false when the value must be fixed first (the error is shown in the cell). */
  async function commit(r: Row, date: string): Promise<boolean> {
    const key = cellKey(r.key, date);
    const raw = drafts[key];
    if (raw === undefined) return true;
    const current = serverHours(r, date);
    let centi = 0;
    if (raw.trim() !== "") {
      try {
        centi = parseHours(raw);
      } catch {
        setErrors((e) => ({ ...e, [key]: t("err.invalid") }));
        return false;
      }
      if (!isOnStep(centi)) {
        setErrors((e) => ({ ...e, [key]: t("err.hours_step") }));
        return false;
      }
    }
    if (centi === Math.round(current * 100)) {
      setDrafts(({ [key]: _, ...rest }) => rest);
      setErrors(({ [key]: _, ...rest }) => rest);
      return true;
    }
    try {
      await save.mutateAsync({
        date,
        ...(r.kind === "task" ? { taskId: r.ref.taskId } : { absenceCodeId: r.ref.absenceCodeId }),
        hours: centi / 100,
      });
      setDrafts(({ [key]: _, ...rest }) => rest);
      setErrors(({ [key]: _, ...rest }) => rest);
      setAnnounce(`${t("ts.saved")}: ${fmtHours(centi / 100, locale)}`);
      return true;
    } catch (err) {
      setErrors((e) => ({ ...e, [key]: errorText(err, t, "invalid") }));
      return false;
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>, ri: number, ci: number, r: Row, date: string) {
    const input = e.currentTarget;
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const atEnd = input.selectionStart === input.value.length;
    const allSelected = input.selectionStart === 0 && input.selectionEnd === input.value.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusCell(Math.min(ri + 1, rows.length - 1), ci);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusCell(Math.max(ri - 1, 0), ci);
    } else if (e.key === "ArrowLeft" && (atStart || allSelected) && ci > 0) {
      e.preventDefault();
      focusCell(ri, ci - 1);
    } else if (e.key === "ArrowRight" && (atEnd || allSelected) && ci < 6) {
      e.preventDefault();
      focusCell(ri, ci + 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Move on only when the cell is saved; otherwise stay so the error can be fixed.
      void commit(r, date).then((ok) => {
        if (ok) focusCell(Math.min(ri + 1, rows.length - 1), ci);
      });
    } else if (e.key === "Escape") {
      const key = cellKey(r.key, date);
      setDrafts(({ [key]: _, ...rest }) => rest);
      setErrors(({ [key]: _, ...rest }) => rest);
    }
  }

  const dayName = (date: string) =>
    fmtDay(date, locale, { weekday: "short", day: "numeric", month: "short" });
  const total = (n: number) => fmtHours(n, locale);

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      <table ref={gridRef} className="w-full min-w-[860px] border-collapse text-sm">
        <caption className="sr-only">{t("ts.title")}</caption>
        <thead>
          <tr className="border-b border-line bg-surface-alt text-xs text-ink-500">
            <th scope="col" className="w-[34%] px-4 py-2 text-left font-semibold uppercase tracking-wide">
              {t("ts.task")}
            </th>
            {week.days.map((d) => {
              const isToday = d.date === week.today;
              const weekend = d.norm === 0 && !d.holiday;
              return (
                <th
                  key={d.date}
                  scope="col"
                  className={`px-1 py-2 text-center font-semibold ${weekend ? "text-ink-500/70" : ""} ${isToday ? "text-brand-700" : ""}`}
                >
                  <span className="block whitespace-nowrap first-letter:uppercase">{dayName(d.date)}</span>
                  <span className="block font-normal">
                    {d.holiday ? (
                      <span title={t(d.holiday === "half" ? "ts.halfHoliday" : "ts.holiday")}>
                        {d.holiday === "half" ? "½ " : ""}
                        {t("ts.holiday")}
                      </span>
                    ) : (
                      fmtHours(d.norm, locale, true) || "–"
                    )}
                  </span>
                </th>
              );
            })}
            <th scope="col" className="px-3 py-2 text-right font-semibold uppercase tracking-wide">
              {t("common.total")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className="px-4 py-8 text-center text-ink-500">
                {t("ts.noRows")}
              </td>
            </tr>
          )}
          {rows.map((r, ri) => {
            const label = rowLabel(r, locale);
            const rowTotal = week.days.reduce((a, d) => a + (r.cells[d.date]?.hours ?? 0), 0);
            return (
              <tr key={r.key} className="border-b border-line last:border-0">
                <th scope="row" className="px-4 py-1.5 text-left font-normal">
                  {r.kind === "task" ? (
                    <>
                      <span className="block truncate font-semibold text-ink-900">
                        {r.ref.projectNumber} {r.ref.projectName}
                      </span>
                      <span className="block truncate text-xs text-ink-500">
                        {r.ref.wbs} {r.ref.taskName}
                      </span>
                      {!readOnly && onRowAction && (
                        <span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                          {removeControl(r, label, rowTotal)}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="block font-semibold text-ink-900">
                        {label} <span className="text-xs font-normal text-ink-500">({r.ref.code})</span>
                      </span>
                      {!readOnly && onRowAction && r.ref.absenceCodeId && (
                        <span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                          {confirmRemove === r.key ? (
                            removeControl(r, label, rowTotal)
                          ) : changing === r.key ? (
                            <>
                              <label className="sr-only" htmlFor={`change-${r.key}`}>
                                {t("ts.changeTo")}
                              </label>
                              <select
                                id={`change-${r.key}`}
                                // biome-ignore lint/a11y/noAutofocus: opened by the user's "change reason" action
                                autoFocus
                                disabled={busyRow === r.key}
                                className="h-7 rounded border border-line bg-surface px-1 text-xs"
                                value=""
                                onChange={(e) => {
                                  if (e.target.value)
                                    void act({ type: "change", row: r, toCodeId: e.target.value });
                                }}
                              >
                                <option value="">{t("ts.changeTo")}</option>
                                {week.absenceCodes
                                  .filter((c) => c.id !== r.ref.absenceCodeId)
                                  .map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {locale === "da" ? c.nameDa : c.nameEn}
                                    </option>
                                  ))}
                              </select>
                              <button
                                type="button"
                                className="text-ink-500 hover:underline"
                                onClick={() => setChanging(null)}
                              >
                                {t("common.cancel")}
                              </button>
                            </>
                          ) : (
                            <>
                              {rowTotal > 0 && (
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 font-semibold text-ink-700 transition-colors hover:border-brand-600 hover:text-brand-700"
                                  onClick={() => setChanging(r.key)}
                                  aria-label={t("ts.changeTypeFor", { row: label })}
                                >
                                  ⇄ {t("ts.changeType")}
                                </button>
                              )}
                              {removeControl(r, label, rowTotal)}
                            </>
                          )}
                        </span>
                      )}
                    </>
                  )}
                </th>
                {week.days.map((d, ci) => {
                  const key = cellKey(r.key, d.date);
                  const err = errors[key];
                  const cell = r.cells[d.date];
                  const isSel = selected?.rowKey === r.key && selected.date === d.date;
                  return (
                    <td
                      key={d.date}
                      className={`px-1 py-1 text-center ${d.date === week.today ? "bg-brand-50/40" : ""}`}
                    >
                      <input
                        data-cell={`${ri}-${ci}`}
                        inputMode="decimal"
                        autoComplete="off"
                        aria-label={t("ts.cellLabel", { row: label, day: dayName(d.date) })}
                        aria-invalid={err ? true : undefined}
                        aria-describedby={err ? `${key}-err` : undefined}
                        readOnly={readOnly}
                        value={display(r, d.date)}
                        onChange={(e) => setDrafts((x) => ({ ...x, [key]: e.target.value }))}
                        onFocus={(e) => {
                          e.currentTarget.select();
                          onSelect({ rowKey: r.key, date: d.date });
                        }}
                        onBlur={() => void commit(r, d.date)}
                        onKeyDown={(e) => onKeyDown(e, ri, ci, r, d.date)}
                        className={`h-9 w-full max-w-[72px] rounded-[var(--radius-control)] border text-center tabular-nums text-ink-900 ${
                          err
                            ? "border-danger bg-danger/5"
                            : isSel
                              ? "border-brand-600"
                              : cell?.comment
                                ? "border-line bg-surface-alt/60"
                                : "border-transparent hover:border-line"
                        } ${readOnly ? "cursor-default bg-transparent" : ""}`}
                      />
                      {err && (
                        <span
                          id={`${key}-err`}
                          role="alert"
                          className="mt-0.5 block text-[11px] leading-tight text-danger"
                        >
                          ⚠ {err}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-ink-900">
                  {total(rowTotal)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t-2 border-ink-900/10 text-sm tabular-nums">
          <tr>
            <th scope="row" className="px-4 py-2 text-left font-semibold text-ink-900">
              {t("ts.registered")}
            </th>
            {dayTotals.map((v, i) => (
              <td key={week.days[i]?.date} className="px-1 py-2 text-center font-semibold text-ink-900">
                {fmtHours(v, locale, true)}
              </td>
            ))}
            <td className="px-3 py-2 text-right font-semibold text-ink-900">
              {total(week.summary.work + week.summary.absence)}
            </td>
          </tr>
          <tr className="text-ink-500">
            <th scope="row" className="px-4 py-1 text-left font-normal">
              {t("ts.norm")}
            </th>
            {week.days.map((d) => (
              <td key={d.date} className="px-1 py-1 text-center">
                {fmtHours(d.norm, locale, true)}
              </td>
            ))}
            <td className="px-3 py-1 text-right">{total(week.summary.norm)}</td>
          </tr>
          <tr>
            <th scope="row" className="px-4 py-1 pb-3 text-left font-normal text-ink-500">
              {t("ts.diff")}
            </th>
            {week.days.map((d, i) => {
              const diff = (dayTotals[i] ?? 0) - d.norm;
              const show = d.date <= week.today && (d.norm > 0 || (dayTotals[i] ?? 0) > 0);
              return (
                <td
                  key={d.date}
                  className={`px-1 py-1 pb-3 text-center ${diff < 0 ? "text-warning" : diff > 0 ? "text-success" : "text-ink-500"}`}
                >
                  {show ? fmtFlex(diff, locale) : ""}
                </td>
              );
            })}
            <td
              className={`px-3 py-1 pb-3 text-right font-semibold ${week.summary.flex < 0 ? "text-warning" : "text-success"}`}
            >
              {fmtFlex(week.summary.flex, locale)}
            </td>
          </tr>
          {dayRow && (
            <tr className="border-t border-line">
              <th scope="row" className="px-4 py-2 text-left font-normal text-ink-700">
                {dayRow.label}
              </th>
              {week.days.map((d) => (
                <td key={d.date} className="px-1 py-2 text-center align-top">
                  {dayRow.cells[d.date]}
                </td>
              ))}
              <td />
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}
