/**
 * Money is integer minor units (øre) plus an ISO currency. Never floats. Rounding is "half away from zero".
 */
import type { CentiHours } from "./hours.ts";

export type Minor = number; // øre / cents, always an integer

export interface Money {
  minor: Minor;
  currency: string;
}

export function assertMinor(n: number): asserts n is Minor {
  if (!Number.isSafeInteger(n)) throw new RangeError(`not an integer minor amount: ${n}`);
}

/** Integer division with rounding half away from zero. */
export function divRound(numerator: number, denominator: number): number {
  if (denominator === 0) throw new RangeError("division by zero");
  const q = numerator / denominator;
  return q >= 0 ? Math.floor(q + 0.5) : -Math.floor(-q + 0.5);
}

/** hours × hourly rate → amount in minor units. 7,50 h × 925,00 kr = 6.937,50 kr. */
export function hoursTimesRate(hours: CentiHours, ratePerHour: Minor): Minor {
  assertMinor(ratePerHour);
  return divRound(hours * ratePerHour, 100);
}

/** amount × percentage in basis points (2500 = 25,00 %). */
export function percentOf(amount: Minor, basisPoints: number): Minor {
  return divRound(amount * basisPoints, 10_000);
}

/** Formats øre as "1.234,56" (da) or "1,234.56" (en), without currency symbol. */
export function formatMinor(amount: Minor, locale: "da" | "en" = "da"): string {
  return new Intl.NumberFormat(locale === "da" ? "da-DK" : "en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}

/** kr → øre for literals in tests and seed data: kr(925) = 92500. */
export const kr = (value: number): Minor => Math.round(value * 100);
