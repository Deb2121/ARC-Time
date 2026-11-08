/**
 * Budget vs actual and contribution margin. docs/spec/projects.md, reporting.md.
 * Values are minor units (øre), hours are centi-hours.
 */
import type { CentiHours } from "./hours.ts";
import { divRound, type Minor } from "./money.ts";

export interface BudgetActualInput {
  budgetHours: CentiHours;
  budgetAmount: Minor;
  usedHours: CentiHours;
  /** sales value of used hours (hours × rate) */
  usedValue: Minor;
  /** cost of used hours (hours × cost rate) */
  usedCost: Minor;
}

export type Health = "ok" | "warning" | "over" | "no_budget";

export interface BudgetActual extends BudgetActualInput {
  remainingHours: CentiHours;
  remainingAmount: Minor;
  /** basis points; null without a budget */
  hoursConsumptionBp: number | null;
  amountConsumptionBp: number | null;
  contributionMargin: Minor;
  /** basis points; null without value */
  marginBp: number | null;
  health: Health;
}

/** Health thresholds (D-013 / projects spec): warning from 90 %, over above 100 %. */
export const WARNING_BP = 9_000;

/**
 * Budget vs actual for a project or task: remaining, consumption % (basis points), contribution margin and health.
 * Health is "warning" from 90 % and "over" above 100 % of budget (hours or amount, whichever is worse).
 * @example budgetActual({ budgetHours: 40000, budgetAmount: 0, usedHours: 31000, usedValue: 0, usedCost: 0 }).hoursConsumptionBp // 7750 (77,5 %)
 */
export function budgetActual(i: BudgetActualInput): BudgetActual {
  const hoursBp = i.budgetHours > 0 ? divRound(i.usedHours * 10_000, i.budgetHours) : null;
  const amountBp = i.budgetAmount > 0 ? divRound(i.usedValue * 10_000, i.budgetAmount) : null;
  const worst = Math.max(hoursBp ?? -1, amountBp ?? -1);
  const health: Health =
    hoursBp === null && amountBp === null
      ? "no_budget"
      : worst > 10_000
        ? "over"
        : worst >= WARNING_BP
          ? "warning"
          : "ok";
  const margin = i.usedValue - i.usedCost;
  return {
    ...i,
    remainingHours: i.budgetHours - i.usedHours,
    remainingAmount: i.budgetAmount - i.usedValue,
    hoursConsumptionBp: hoursBp,
    amountConsumptionBp: amountBp,
    contributionMargin: margin,
    marginBp: i.usedValue > 0 ? divRound(margin * 10_000, i.usedValue) : null,
    health,
  };
}
