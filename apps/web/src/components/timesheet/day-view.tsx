"use client";

/**
 * Day view (docs/spec/time-tracking.md): one day at a time, hours and comment side by side — handy when writing
 * comments or registering on a phone-sized screen. Same data and validation as the week grid.
 */
import { isOnStep, parseHours } from "@arc-tid/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { ApiError, api } from "@/lib/api";
import { fmtDay, fmtFlex, fmtHours } from "@/lib/format";
import type { Row, WeekData } from "./types";
import { rowLabel } from "./week-grid";

/**
 * Day view of the timesheet: day picker for the week plus one row per task with hours and comment side by side.
 */
export function DayView({
  week,
  rows,
  day,
  onDay,
}: {
  week: WeekData;
  rows: Row[];
  day: string;
  onDay: (d: string) => void;
}) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const readOnly = !week.editable || (week as WeekData & { closedDays?: string[] }).closedDays?.includes(day);
  const info = week.days.find((d) => d.date === day);
  const total = rows.reduce((a, r) => a + (r.cells[day]?.hours ?? 0), 0);

  async function save(r: Row, hoursText: string, comment: string) {
    let centi = 0;
    try {
      centi = hoursText.trim() ? parseHours(hoursText) : 0;
    } catch {
      setErrors((e) => ({ ...e, [r.key]: t("err.invalid") }));
      return;
    }
    if (!isOnStep(centi)) {
      setErrors((e) => ({ ...e, [r.key]: t("err.hours_step") }));
      return;
    }
    const cell = r.cells[day];
    if (centi === Math.round((cell?.hours ?? 0) * 100) && comment === (cell?.comment ?? "")) return;
    try {
      await api("/timesheet/entries", {
        method: "PUT",
        body: JSON.stringify({
          date: day,
          ...(r.kind === "task" ? { taskId: r.ref.taskId } : { absenceCodeId: r.ref.absenceCodeId }),
          hours: centi / 100,
          comment,
        }),
      });
      setErrors(({ [r.key]: _, ...rest }) => rest);
      await qc.invalidateQueries({ queryKey: ["week"] });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "invalid";
      setErrors((e) => ({ ...e, [r.key]: t(`err.${code}` as MessageKey) }));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label={t("ts.view.day")} className="grid grid-cols-7 gap-2">
        {week.days.map((d) => {
          const reg = rows.reduce((a, r) => a + (r.cells[d.date]?.hours ?? 0), 0);
          const active = d.date === day;
          return (
            <button
              key={d.date}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onDay(d.date)}
              className={`flex flex-col items-center rounded-lg border px-1 py-2 text-xs ${active ? "border-brand-600 bg-brand-50" : "border-line bg-surface hover:bg-surface-alt"}`}
            >
              <span className="font-semibold text-ink-900 first-letter:uppercase">
                {fmtDay(d.date, locale, { weekday: "short" })}
              </span>
              <span className="text-ink-500">
                {fmtDay(d.date, locale, { day: "numeric", month: "short" })}
              </span>
              <span className="mt-1 tabular-nums text-ink-900">{fmtHours(reg, locale, true) || "–"}</span>
            </button>
          );
        })}
      </div>

      <section className="rounded-lg border border-line bg-surface">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-base font-medium first-letter:uppercase">
            {fmtDay(day, locale, { weekday: "long", day: "numeric", month: "long" })}
          </h2>
          <p className="text-sm tabular-nums text-ink-700">
            {t("ts.dayTotal")}: <strong className="text-ink-900">{fmtHours(total, locale)}</strong> /{" "}
            {fmtHours(info?.norm ?? 0, locale)}
            {(info?.norm ?? 0) > 0 && (
              <span className={`ml-2 ${total - (info?.norm ?? 0) < 0 ? "text-warning" : "text-success"}`}>
                {fmtFlex(total - (info?.norm ?? 0), locale)}
              </span>
            )}
          </p>
        </header>
        {rows.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-ink-500">{t("ts.dayEmpty")}</p>
        )}
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <DayRow
              key={`${r.key}|${day}`}
              row={r}
              day={day}
              readOnly={Boolean(readOnly)}
              error={errors[r.key]}
              onSave={save}
              label={rowLabel(r, locale)}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function DayRow({
  row,
  day,
  readOnly,
  error,
  onSave,
  label,
}: {
  row: Row;
  day: string;
  readOnly: boolean;
  error?: string | undefined;
  onSave: (r: Row, hours: string, comment: string) => void;
  label: string;
}) {
  const { t, locale } = useI18n();
  const cell = row.cells[day];
  const [hours, setHours] = useState(fmtHours(cell?.hours ?? 0, locale, true));
  const [comment, setComment] = useState(cell?.comment ?? "");
  const commit = () => onSave(row, hours, comment);
  return (
    <li className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_96px_1.2fr] sm:items-start">
      <div className="min-w-0">
        {row.kind === "task" ? (
          <>
            <p className="truncate font-semibold text-ink-900">
              {row.ref.projectNumber} {row.ref.projectName}
            </p>
            <p className="truncate text-xs text-ink-500">
              {row.ref.wbs} {row.ref.taskName}
              {row.ref.commentRequired ? ` · ${t("ts.commentRequired")}` : ""}
            </p>
          </>
        ) : (
          <p className="font-semibold text-ink-900">{label}</p>
        )}
      </div>
      <input
        aria-label={`${label}: ${t("common.hours")}`}
        inputMode="decimal"
        readOnly={readOnly}
        value={hours}
        onChange={(e) => setHours(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className={`h-10 rounded-[var(--radius-control)] border px-2 text-center tabular-nums text-ink-900 ${error ? "border-danger" : "border-line"}`}
      />
      <div className="flex flex-col gap-1">
        <input
          aria-label={`${label}: ${t("ts.comment")}`}
          placeholder={t("ts.comment")}
          readOnly={readOnly}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onBlur={commit}
          className="h-10 rounded-[var(--radius-control)] border border-line px-3 text-sm text-ink-900"
        />
        {error && (
          <p role="alert" className="text-xs text-danger">
            ⚠ {error}
          </p>
        )}
      </div>
    </li>
  );
}
