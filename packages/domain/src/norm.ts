/**
 * Norm (expected) hours. docs/spec/organisation.md and absence-flex.md.
 * A norm pattern holds 7 (or 14) day values Mon..Sun in centi-hours; public holidays reduce the day's norm.
 */
import { addDays, daysBetween, isoWeekday, type LocalDate } from "./dates.ts";
import type { CentiHours } from "./hours.ts";

export interface NormPattern {
  cycleWeeks: 1 | 2;
  /** length 7 × cycleWeeks; index 0 = Monday of cycle week 1 */
  days: CentiHours[];
}

export interface NormAssignment {
  validFrom: LocalDate;
  pattern: NormPattern;
  /** Monday that starts cycle week 1 (only used for 2-week cycles); defaults to validFrom */
  cycleAnchor?: LocalDate;
}

export type HolidayKind = { kind: "full" } | { kind: "half" } | { kind: "hours"; hours: CentiHours };

/** Default Danish full time: Mon–Thu 7,5 h, Fri 7,0 h = 37 h. [Brief] */
export const FULL_TIME_37: NormPattern = { cycleWeeks: 1, days: [750, 750, 750, 750, 700, 0, 0] };

export interface Employment {
  start: LocalDate;
  end?: LocalDate | undefined;
}

export interface NormContext {
  assignments: NormAssignment[];
  holidays: ReadonlyMap<LocalDate, HolidayKind>;
  employment: Employment;
}

function assignmentFor(date: LocalDate, assignments: NormAssignment[]): NormAssignment | undefined {
  let best: NormAssignment | undefined;
  for (const a of assignments) {
    if (a.validFrom <= date && (!best || a.validFrom > best.validFrom)) best = a;
  }
  return best;
}

export function patternHours(date: LocalDate, a: NormAssignment): CentiHours {
  const weekdayIndex = isoWeekday(date) - 1;
  if (a.pattern.cycleWeeks === 1) return a.pattern.days[weekdayIndex] ?? 0;
  const weeks = Math.floor(daysBetween(a.cycleAnchor ?? a.validFrom, date) / 7);
  const cycleWeek = ((weeks % 2) + 2) % 2;
  return a.pattern.days[cycleWeek * 7 + weekdayIndex] ?? 0;
}

/** Norm hours for one day after the employment period and public holidays. */
export function dailyNorm(date: LocalDate, ctx: NormContext): CentiHours {
  if (date < ctx.employment.start) return 0;
  if (ctx.employment.end && date > ctx.employment.end) return 0;
  const a = assignmentFor(date, ctx.assignments);
  if (!a) return 0;
  const base = patternHours(date, a);
  const holiday = ctx.holidays.get(date);
  if (!holiday) return base;
  if (holiday.kind === "full") return 0;
  if (holiday.kind === "half") return Math.round(base / 2);
  return Math.min(base, holiday.hours);
}

export function normForRange(from: LocalDate, days: number, ctx: NormContext): CentiHours {
  let sum = 0;
  for (let i = 0; i < days; i++) sum += dailyNorm(addDays(from, i), ctx);
  return sum;
}

export const weeklyNorm = (monday: LocalDate, ctx: NormContext): CentiHours => normForRange(monday, 7, ctx);
