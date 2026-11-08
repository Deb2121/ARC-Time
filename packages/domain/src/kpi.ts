/**
 * Key figures (brief §4.13, docs/spec/reporting.md) — GRASP Information Expert: one definition of each KPI so the
 * dashboards, reports, exports and the Python analytics service (which mirrors these formulas and is tested
 * against the same examples) all agree. Inputs in centi-hours / øre; results in basis points or øre.
 */
import type { CentiHours } from "./hours.ts";
import { divRound, type Minor } from "./money.ts";

/** Basis points of a ÷ b, or null when b is zero. */
const ratio = (a: number, b: number): number | null => (b > 0 ? divRound(a * 10_000, b) : null);

/**
 * Utilisation ("udnyttelsesgrad"): billable hours ÷ norm hours.
 * @example utilisation(12_000, 14_800) // 8108 = 81,1 % (120 billable of 4 × 37 h)
 */
export const utilisation = (billable: CentiHours, norm: CentiHours): number | null => ratio(billable, norm);

/**
 * Billable share ("faktureringsgrad"): billable ÷ all registered work hours (absence excluded).
 * @example billablePct(12_000, 15_000) // 8000 = 80,0 %
 */
export const billablePct = (billable: CentiHours, work: CentiHours): number | null => ratio(billable, work);

/**
 * Effective hourly rate: invoiced amount ÷ invoiced hours, in øre per hour (null without hours).
 * @example effectiveRate(11_400_000, 12_000) // 95_000 øre = 950,00 kr/h
 */
export function effectiveRate(invoiced: Minor, hours: CentiHours): Minor | null {
  return hours > 0 ? divRound(invoiced * 100, hours) : null;
}

/**
 * Contribution margin ("dækningsbidrag") and margin % ("DB-grad").
 * @example margin(11_760_000, 4_410_000) // { margin: 7_350_000, marginBp: 6250 } = 73.500 kr, 62,5 %
 */
export function margin(revenue: Minor, cost: Minor): { margin: Minor; marginBp: number | null } {
  return { margin: revenue - cost, marginBp: ratio(revenue - cost, revenue) };
}
