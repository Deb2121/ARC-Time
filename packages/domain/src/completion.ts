/**
 * Fixed-price completion and recognised revenue. docs/spec/projects.md, decision D-004.
 * completion = used ÷ budget hours, capped at 100 %, PM override allowed.
 * Completion is expressed in basis points (4900 = 49,00 %).
 */
import type { CentiHours } from "./hours.ts";
import { divRound, type Minor } from "./money.ts";

export function completionBasisPoints(used: CentiHours, budget: CentiHours, overrideBp?: number): number {
  if (overrideBp !== undefined) {
    if (overrideBp < 0 || overrideBp > 10_000) throw new RangeError("override must be 0–100 %");
    return overrideBp;
  }
  if (budget <= 0) return used > 0 ? 10_000 : 0;
  return Math.min(10_000, divRound(used * 10_000, budget));
}

export function recognisedRevenue(price: Minor, completionBp: number): Minor {
  return divRound(price * completionBp, 10_000);
}
