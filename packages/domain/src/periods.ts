/**
 * Accounting periods (brief §4.11, docs/spec/accounting-periods.md): monthly per legal entity, open → closed.
 * A closed month locks time entries, expenses and invoices dated in it — for everyone.
 */
import type { LocalDate } from "./dates.ts";
import { divRound, type Minor } from "./money.ts";

/** "2026-11-08" → "2026-11-01" */
export const monthOf = (d: LocalDate): LocalDate => `${d.slice(0, 7)}-01`;

/** True when the date falls in a closed accounting month (`closedMonths` holds first-of-month dates). */
export function isLocked(date: LocalDate, closedMonths: ReadonlySet<LocalDate>): boolean {
  return closedMonths.has(monthOf(date));
}

/** Last day of the month as a LocalDate. @example lastDayOfMonth("2028-02-01") // "2028-02-29" */
export function lastDayOfMonth(month: LocalDate): LocalDate {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month.slice(0, 7)}-${String(d).padStart(2, "0")}`;
}

/**
 * Month-end figures for one fixed-price contract: revenue recognised to date = price × completion;
 * revenue to recognise this month = recognised to date − previously recognised (may be negative after a budget change).
 */
export function recognitionDelta(recognisedToDate: Minor, previouslyRecognised: Minor): Minor {
  return recognisedToDate - previouslyRecognised;
}

/**
 * Deferred revenue on a prepaid retainer: invoiced − earned (never negative; an overrun is WIP, not negative deferral).
 * Earned = min(used hours / pool hours, 1) × invoiced fee.
 */
export function deferredRevenue(invoiced: Minor, usedHours: number, poolHours: number): Minor {
  if (poolHours <= 0) return 0;
  const earned = Math.min(invoiced, divRound(invoiced * usedHours, poolHours));
  return Math.max(0, invoiced - earned);
}
