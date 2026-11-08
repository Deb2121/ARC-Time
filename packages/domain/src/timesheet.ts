/**
 * Time-entry validation and weekly summary. docs/spec/time-tracking.md, absence-flex.md, decision D-013.
 * Pure functions: the API calls them before writing, the web app calls them for instant feedback.
 */
import { addDays, type LocalDate } from "./dates.ts";
import { type FlexWeekInput, weeklyFlex } from "./flex.ts";
import { type CentiHours, HOURS_STEP, isOnStep, MAX_HOURS_PER_DAY } from "./hours.ts";

export const ENTRY_STATUSES = ["draft", "submitted", "approved", "rejected", "invoiced"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const PERIOD_STATUSES = ["open", "submitted", "partially_approved", "approved", "rejected"] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

export type EntryError =
  | "hours_negative"
  | "hours_step"
  | "day_over_24"
  | "future_date"
  | "project_inactive"
  | "task_closed"
  | "comment_required"
  | "period_locked"
  | "not_editable";

export interface EntryCheck {
  hours: CentiHours;
  date: LocalDate;
  today: LocalDate;
  /** sum of the employee's other entries (work + absence) on the same date */
  otherHoursSameDay: CentiHours;
  isAbsence: boolean;
  projectActive: boolean;
  taskOpen: boolean;
  commentRequired: boolean;
  comment: string | null | undefined;
  /** accounting period closed or timesheet period submitted/approved */
  periodLocked: boolean;
  currentStatus?: EntryStatus | undefined;
}

/** Entries the employee may still edit: draft and rejected (rejected returns to draft on edit). */
export const isEditableStatus = (s: EntryStatus | undefined): boolean =>
  s === undefined || s === "draft" || s === "rejected";

/**
 * Checks one time-entry change against the timesheet rules and returns every error found (empty = valid).
 * Used by the API before writing and by the web app for instant feedback, so both always agree.
 */
export function validateEntry(c: EntryCheck): EntryError[] {
  const errors: EntryError[] = [];
  if (!isEditableStatus(c.currentStatus)) errors.push("not_editable");
  if (c.periodLocked) errors.push("period_locked");
  if (c.hours < 0) errors.push("hours_negative");
  if (!isOnStep(c.hours, HOURS_STEP)) errors.push("hours_step");
  if (c.hours + c.otherHoursSameDay > MAX_HOURS_PER_DAY) errors.push("day_over_24");
  // D-013: no future-dated work; future absence (planned vacation) is allowed.
  if (!c.isAbsence && c.date > c.today && c.hours > 0) errors.push("future_date");
  if (!c.isAbsence) {
    if (!c.projectActive) errors.push("project_inactive");
    if (!c.taskOpen) errors.push("task_closed");
  }
  if (c.commentRequired && c.hours > 0 && !c.comment?.trim()) errors.push("comment_required");
  return errors;
}

export interface DayTotals {
  date: LocalDate;
  norm: CentiHours;
  work: CentiHours;
  billable: CentiHours;
  countingAbsence: CentiHours;
  nonCountingAbsence: CentiHours;
}

export interface WeekSummary extends FlexWeekInput {
  days: DayTotals[];
  billableHours: CentiHours;
  flex: CentiHours;
  /** billable ÷ work hours in basis points; null when no work hours */
  billableBp: number | null;
  belowNorm: boolean;
}

export interface SummaryEntry {
  date: LocalDate;
  hours: CentiHours;
  kind: "work" | "absence";
  billable?: boolean;
  countsTowardNorm?: boolean;
}

/**
 * Week summary for one employee: per-day norm/work/billable/absence and week totals, flex and billable %
 * (basis points). `normOf` gives the norm (centi-hours) for each date.
 */
export function summariseWeek(
  monday: LocalDate,
  entries: SummaryEntry[],
  normOf: (d: LocalDate) => CentiHours,
): WeekSummary {
  const days: DayTotals[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    return { date, norm: normOf(date), work: 0, billable: 0, countingAbsence: 0, nonCountingAbsence: 0 };
  });
  for (const e of entries) {
    const d = days.find((x) => x.date === e.date);
    if (!d) continue;
    if (e.kind === "work") {
      d.work += e.hours;
      if (e.billable) d.billable += e.hours;
    } else if (e.countsTowardNorm) d.countingAbsence += e.hours;
    else d.nonCountingAbsence += e.hours;
  }
  const sum = (f: (d: DayTotals) => number) => days.reduce((a, d) => a + f(d), 0);
  const input: FlexWeekInput = {
    normHours: sum((d) => d.norm),
    workHours: sum((d) => d.work),
    countingAbsenceHours: sum((d) => d.countingAbsence),
  };
  const billableHours = sum((d) => d.billable);
  const flex = weeklyFlex(input);
  return {
    ...input,
    days,
    billableHours,
    flex,
    billableBp: input.workHours > 0 ? Math.round((billableHours * 10_000) / input.workHours) : null,
    belowNorm: flex < 0,
  };
}

/** Anomaly flags for the approver inbox (docs/spec/approval.md). */
export function dayAnomalies(
  days: DayTotals[],
  toleranceCentiHours = 200,
): { date: LocalDate; kind: "over" | "under" }[] {
  const out: { date: LocalDate; kind: "over" | "under" }[] = [];
  for (const d of days) {
    const registered = d.work + d.countingAbsence;
    if (registered > d.norm + toleranceCentiHours) out.push({ date: d.date, kind: "over" });
    else if (d.norm > 0 && registered < d.norm - toleranceCentiHours)
      out.push({ date: d.date, kind: "under" });
  }
  return out;
}
