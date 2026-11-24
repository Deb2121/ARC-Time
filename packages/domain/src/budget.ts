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

/** Default health thresholds: warning from 90 %, over above 100 %. */
export const WARNING_BP = 9_000;

/** When a budget turns "warning" (from `warningBp`) and "over" (above `alertBp`), in basis points. */
export interface BudgetThresholds {
  warningBp: number;
  alertBp: number;
}

/** Defaults when a tenant has no thresholds (the API passes Finance's fee thresholds, D-032). */
export const DEFAULT_BUDGET_THRESHOLDS: BudgetThresholds = { warningBp: WARNING_BP, alertBp: 10_000 };

/**
 * Budget vs actual for a project or task: remaining, consumption % (basis points), contribution margin and health.
 * Health is "warning" from `warningBp` and "over" above `alertBp` of budget (hours or amount, whichever is worse);
 * the API uses the same thresholds as Sagsøkonomi so both screens agree (D-032).
 * @example budgetActual({ budgetHours: 40000, budgetAmount: 0, usedHours: 31000, usedValue: 0, usedCost: 0 }).hoursConsumptionBp // 7750 (77,5 %)
 */
export function budgetActual(
  i: BudgetActualInput,
  t: BudgetThresholds = DEFAULT_BUDGET_THRESHOLDS,
): BudgetActual {
  const hoursBp = i.budgetHours > 0 ? divRound(i.usedHours * 10_000, i.budgetHours) : null;
  const amountBp = i.budgetAmount > 0 ? divRound(i.usedValue * 10_000, i.budgetAmount) : null;
  const worst = Math.max(hoursBp ?? -1, amountBp ?? -1);
  const health: Health =
    hoursBp === null && amountBp === null
      ? "no_budget"
      : worst > t.alertBp
        ? "over"
        : worst >= t.warningBp
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
