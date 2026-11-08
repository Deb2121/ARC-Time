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

export function weeklyFlex(w: FlexWeekInput): CentiHours {
  return w.workHours + w.countingAbsenceHours - w.normHours;
}

export function flexBalance(opening: CentiHours, weeks: FlexWeekInput[]): CentiHours {
  return weeks.reduce((acc, w) => acc + weeklyFlex(w), opening);
}
