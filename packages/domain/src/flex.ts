/**
 * Flex. docs/spec/absence-flex.md.
 * weekly flex = work hours + absence hours that count toward norm − norm hours (holidays already reduce the norm).
 * balance = opening balance + Σ weekly flex.
 */
import type { CentiHours } from "./hours.ts";

export interface FlexWeekInput {
  normHours: CentiHours;
  workHours: CentiHours;
  countingAbsenceHours: CentiHours;
}

/**
 * Flex for one week in centi-hours: work + absence that counts toward norm − norm hours.
 * @example weeklyFlex({ normHours: 3700, workHours: 3750, countingAbsenceHours: 0 }) // 50 = +0,5 h
 */
export function weeklyFlex(w: FlexWeekInput): CentiHours {
  return w.workHours + w.countingAbsenceHours - w.normHours;
}

/** Flex balance in centi-hours: opening balance + the flex of every given week. */
export function flexBalance(opening: CentiHours, weeks: FlexWeekInput[]): CentiHours {
  return weeks.reduce((acc, w) => acc + weeklyFlex(w), opening);
}
