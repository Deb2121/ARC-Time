/**
 * Leave accounts ("løntidskonti") for ferie and feriefridage — Finance feedback 2026-11-17, decision D-037.
 * GRASP Information Expert: the one place that knows how a month's accrual is computed and how the postings of an
 * account add up to a running balance. Pure functions; days in hundredths (208 = 2,08 days).
 *
 * Accrual is posted on the last day of each month that has ended:
 *   - ferie: 2,08 days a month for everyone (25 days a year),
 *   - feriefridage: an individual rate per employee (e.g. 0,50 a month), 0 = none.
 * A month the employee only partly worked accrues pro rata: rate × employed calendar days ÷ 30, capped at the full
 * rate (TimeLog's rule: employed from 16 March → 2,08 × 16 ÷ 30 = 1,11). Because postings are derived from the rules,
 * re-running never posts a month twice.
 */
import type { CentiDays } from "./vacation.ts";

/** Days in an accrual month for the pro-rata rule. */
export const ACCRUAL_MONTH_DAYS = 30;

/** Which leave account a posting belongs to. */
export type LeaveAccount = "ferie" | "feriefridag";

/** One line on a leave account. `days` is signed: positive = credit (accrual), negative = leave taken. */
export interface LeavePosting {
  date: string;
  kind: "accrual" | "taken" | "adjustment";
  text: string;
  days: CentiDays;
}

/** A posting with the account's balance after it. */
export interface LeaveLine extends LeavePosting {
  balance: CentiDays;
}

const pad = (n: number) => String(n).padStart(2, "0");
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const dayNumber = (d: string) =>
  Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));

/**
 * Accrual for one calendar month (`year`, `month` 1–12) for someone employed from `start` (to optional `end`).
 * @example monthAccrual(2026, 3, "2026-03-16", undefined, 208) // 16 days → 208 × 16 ÷ 30 = 110,9 → 111 (1,11 days)
 */
export function monthAccrual(
  year: number,
  month: number,
  start: string,
  end: string | undefined,
  perMonth: CentiDays,
): CentiDays {
  if (perMonth <= 0) return 0;
  const first = `${year}-${pad(month)}-01`;
  const last = `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;
  const from = start > first ? start : first;
  const to = end && end < last ? end : last;
  if (from > to) return 0;
  if (from === first && to === last) return perMonth;
  const days = (dayNumber(to) - dayNumber(from)) / 86_400_000 + 1;
  return Math.min(perMonth, Math.round((perMonth * days) / ACCRUAL_MONTH_DAYS));
}

/**
 * Accrual postings for every month that has ended by `asOf` and lies on or after `from` (the go-live date: the
 * opening balance covers what came before). One posting per month, dated the month's last day.
 */
export function accrualPostings(
  from: string,
  asOf: string,
  start: string,
  end: string | undefined,
  perMonth: CentiDays,
  text = "Automatisk optjening",
): LeavePosting[] {
  const out: LeavePosting[] = [];
  if (perMonth <= 0) return out;
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  for (;;) {
    const last = `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`;
    if (last > asOf) break;
    const days = monthAccrual(y, m, start, end, perMonth);
    if (days > 0) out.push({ date: last, kind: "accrual", text, days });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Leave taken on a day, in hundredths of a day: hours ÷ the day's norm (both in hundredths of an hour). */
export function leaveDays(hours: number, norm: number): CentiDays {
  return norm > 0 ? Math.round((hours * 100) / norm) : 0;
}

const ORDER = { accrual: 0, adjustment: 1, taken: 2 } as const;

/** Sorts the postings by date (accrual before leave on the same day) and adds the running balance. */
export function runningBalance(opening: CentiDays, postings: LeavePosting[]): LeaveLine[] {
  let balance = opening;
  return [...postings]
    .sort((a, b) => a.date.localeCompare(b.date) || ORDER[a.kind] - ORDER[b.kind])
    .map((p) => {
      balance += p.days;
      return { ...p, balance };
    });
}
