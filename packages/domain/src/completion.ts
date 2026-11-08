/**
 * Fixed-price completion and recognised revenue. docs/spec/projects.md, decision D-004.
 * completion = used ÷ budget hours, capped at 100 %, PM override allowed.
 * Completion is expressed in basis points (4900 = 49,00 %).
 */
import type { CentiHours } from "./hours.ts";
import { divRound, type Minor } from "./money.ts";

/**
 * Fixed-price percentage of completion in basis points: used ÷ budget hours (centi-hours), capped at 100 %.
 * A PM override (0–10 000) replaces the calculation. No budget → 0 %, or 100 % once any hours exist.
 * @example completionBasisPoints(9800, 20000) // 4900 = 49 %
 */
export function completionBasisPoints(used: CentiHours, budget: CentiHours, overrideBp?: number): number {
  if (overrideBp !== undefined) {
    if (overrideBp < 0 || overrideBp > 10_000) throw new RangeError("override must be 0–100 %");
    return overrideBp;
  }
  if (budget <= 0) return used > 0 ? 10_000 : 0;
  return Math.min(10_000, divRound(used * 10_000, budget));
}

/**
 * Revenue recognised on a fixed-price contract: price (øre) × completion (basis points), rounded half away from zero.
 * @example recognisedRevenue(24_000_000, 4900) // 11_760_000 øre = 117.600 kr
 */
export function recognisedRevenue(price: Minor, completionBp: number): Minor {
  return divRound(price * completionBp, 10_000);
}
