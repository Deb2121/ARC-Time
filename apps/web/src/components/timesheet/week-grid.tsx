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
import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { ApiError, api } from "@/lib/api";
import { fmtDay, fmtFlex, fmtHours } from "@/lib/format";
import type { Row, WeekData } from "./types";

export interface Selected {
  rowKey: string;
  date: string;
}

interface Props {
  week: WeekData;
  rows: Row[];
  selected: Selected | null;
  onSelect: (s: Selected) => void;
  onCommentNeeded: (s: Selected, hours: number) => void;
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
export function WeekGrid({ week, rows, selected, onSelect, onCommentNeeded }: Props) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const gridRef = useRef<HTMLTableElement>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [announce, setAnnounce] = useState("");
  const readOnly = !week.editable;

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

  async function commit(r: Row, date: string) {
    const key = cellKey(r.key, date);
    const raw = drafts[key];
    if (raw === undefined) return;
    const current = serverHours(r, date);
    let centi = 0;
    if (raw.trim() !== "") {
      try {
        centi = parseHours(raw);
      } catch {
        setErrors((e) => ({ ...e, [key]: t("err.invalid") }));
        return;
      }
      if (!isOnStep(centi)) {
        setErrors((e) => ({ ...e, [key]: t("err.hours_step") }));
        return;
      }
    }
    if (centi === Math.round(current * 100)) {
      setDrafts(({ [key]: _, ...rest }) => rest);
      setErrors(({ [key]: _, ...rest }) => rest);
      return;
    }
    // Comment-required projects: ask for the comment before saving if the cell has none yet.
    if (r.kind === "task" && r.ref.commentRequired && centi > 0 && !r.cells[date]?.comment) {
      onCommentNeeded({ rowKey: r.key, date }, centi / 100);
      setDrafts(({ [key]: _, ...rest }) => rest);
      return;
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
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "invalid";
      const msgKey = `err.${code}` as MessageKey;
      setErrors((e) => ({ ...e, [key]: t(msgKey) === msgKey ? t("common.error") : t(msgKey) }));
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
      void commit(r, date);
      focusCell(Math.min(ri + 1, rows.length - 1), ci);
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
                        {r.ref.commentRequired ? " · ✎" : ""}
                      </span>
                    </>
                  ) : (
                    <span className="block font-semibold text-ink-900">
                      {label} <span className="text-xs font-normal text-ink-500">({r.ref.code})</span>
                    </span>
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
        </tfoot>
      </table>
    </div>
  );
}
