/**
 * Danish vacation (samtidighedsferie). docs/spec/absence-flex.md, decision D-013.
 * Holiday year runs 1 Sep – 31 Aug; 2,08 days are earned per started employment month (configurable).
 * Days are expressed in hundredths of a day (208 = 2,08 days) to stay in integers.
 */
import type { LocalDate } from "./dates.ts";

export type CentiDays = number;
export const ACCRUAL_PER_MONTH: CentiDays = 208;

/** The holiday year (start year) that a date belongs to: 2026-11-08 → 2026 (1 Sep 2026 – 31 Aug 2027). */
export function holidayYearOf(d: LocalDate): number {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  return m >= 9 ? y : y - 1;
}

/**
 * Days earned in holiday year `hy` up to and including `asOf`, for an employee employed from `start`
 * (to optional `end`). A month counts when the employee is employed on its first day or starts during it.
 */
export function accruedDays(
  hy: number,
  asOf: LocalDate,
  start: LocalDate,
  end?: LocalDate,
  perMonth: CentiDays = ACCRUAL_PER_MONTH,
): CentiDays {
  let total = 0;
  for (let i = 0; i < 12; i++) {
    const year = hy + Math.floor((8 + i) / 12);
    const month = ((8 + i) % 12) + 1;
    const first = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const last = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    if (first > asOf) break;
    const employed = start <= last && (!end || end >= first);
    if (employed) total += perMonth;
  }
  return total;
}

/** Vacation balance = opening + accrued − used (all in centi-days). */
export function vacationBalance(opening: CentiDays, accrued: CentiDays, used: CentiDays): CentiDays {
  return opening + accrued - used;
}
