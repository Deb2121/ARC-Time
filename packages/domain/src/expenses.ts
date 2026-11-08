/**
 * Expenses and mileage (brief §4.7, docs/spec/expenses.md) — GRASP Information Expert for VAT splitting, mileage
 * allowance and the amount re-invoiced to the customer. Pure functions; amounts in øre, distances in metres.
 *
 * Danish practice: receipts show amounts incl. VAT; VAT = gross × rate ÷ (1 + rate). Some expense types allow only
 * part of the VAT to be deducted (e.g. restaurant/representation 25 %). Mileage uses a yearly rate table with a high
 * rate up to a threshold (20.000 km) and a low rate above it; the rates themselves are configuration, not code.
 */
import { divRound, type Minor, percentOf } from "./money.ts";

/** Result of splitting a gross (VAT-inclusive) amount. All values in øre; net + vat = gross. */
export interface VatSplit {
  gross: Minor;
  net: Minor;
  vat: Minor;
  /** VAT the company may deduct */
  deductibleVat: Minor;
  /** VAT that becomes part of the cost (not deductible) */
  nonDeductibleVat: Minor;
}

/**
 * Splits a VAT-inclusive amount into net and VAT, and the VAT into deductible and non-deductible parts.
 * @param vatBp VAT rate in basis points (2500 = 25 %)
 * @param deductibleBp share of the VAT that is deductible (10 000 = all, 2500 = 25 %)
 * @example vatSplit(125_000, 2500, 10_000) // { net: 100_000, vat: 25_000, deductibleVat: 25_000, … }
 */
export function vatSplit(gross: Minor, vatBp: number, deductibleBp = 10_000): VatSplit {
  const vat = vatBp > 0 ? divRound(gross * vatBp, 10_000 + vatBp) : 0;
  const deductibleVat = percentOf(vat, deductibleBp);
  return { gross, net: gross - vat, vat, deductibleVat, nonDeductibleVat: vat - deductibleVat };
}

/** The company's cost of an expense: net amount + VAT it cannot deduct (øre). */
export const expenseCost = (s: VatSplit): Minor => s.net + s.nonDeductibleVat;

/**
 * Amount re-invoiced to the customer for a billable expense: net amount plus markup (VAT is added on the invoice).
 * @example billableAmount(100_000, 1000) // 110_000 = 1.000 kr + 10 %
 */
export function billableAmount(net: Minor, markupBp: number): Minor {
  return net + percentOf(net, markupBp);
}

/** Mileage rates for one year, øre per km; the high rate applies up to `thresholdKm` per person per year. */
export interface MileageRate {
  year: number;
  highRate: Minor;
  lowRate: Minor;
  thresholdKm: number;
}

/**
 * Mileage allowance for one trip, taking the yearly threshold into account: kilometres before the person reaches
 * the threshold use the high rate, the rest the low rate. Distances in metres (1 km = 1000) to keep integers.
 * @param metresBefore distance already driven by the person earlier in the same year (metres)
 * @example mileageAmount(50_000, 19_980_000, { year: 2026, highRate: 394, lowRate: 228, thresholdKm: 20_000 })
 *          // 20 km × 3,94 + 30 km × 2,28 = 147,20 kr → 14_720 øre
 */
export function mileageAmount(metres: number, metresBefore: number, rate: MileageRate): Minor {
  const threshold = rate.thresholdKm * 1000;
  const high = Math.max(0, Math.min(metres, threshold - metresBefore));
  const low = metres - high;
  return divRound(high * rate.highRate + low * rate.lowRate, 1000);
}

/** Expense lifecycle — the same as time entries (brief §4.7). */
export const EXPENSE_STATUSES = ["draft", "submitted", "approved", "rejected", "invoiced"] as const;
/** One of EXPENSE_STATUSES. */
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];
