/**
 * Faktureringsplan (billing plan) for fixed-fee cases — docs/spec/case-finance.md, decision D-029.
 * GRASP Information Expert: the one place that knows how instalments add up to the fee, when an instalment is
 * ready (klar) to invoice, and what an a conto invoice by % complete should be. Pure functions, money in øre.
 *
 * Status flow: afventer → planlagt → klar → faktureret.
 *   afventer   the previous instalment is not invoiced yet
 *   planlagt   next in line, but the planned date has not passed
 *   klar       next in line and the date has passed — or the linked phase is done (closed), or the PM marked it
 *   faktureret the invoice holding the instalment is booked
 */
import type { LocalDate } from "./dates.ts";
import { type Minor, percentOf } from "./money.ts";

/** Computed instalment status (Danish UI words: afventer, planlagt, klar, faktureret). */
export type InstalmentStatus = "afventer" | "planlagt" | "klar" | "faktureret";

/** Phase names offered as templates when a plan is built (Danish building-consultancy phases). */
export const PHASE_TEMPLATES = [
  "Dispositionsforslag",
  "Projektforslag",
  "Myndighedsprojekt",
  "Udbudsprojekt",
  "Udførelsesprojekt",
  "Tilsyn",
] as const;

/** One instalment (rate) as the plan rules need it. Give either `percentageBp` or `amount`. */
export interface PlanInstalment {
  id: string;
  sequence: number;
  /** share of the fee in basis points (2000 = 20 %) */
  percentageBp: number | null;
  /** fixed amount in øre (used when no percentage is given) */
  amount: number | null;
  plannedDate: LocalDate;
  /** the instalment is on a booked invoice */
  invoiced: boolean;
  /** the linked phase has been marked done (closed) by the project manager */
  phaseDone?: boolean;
  /** the project manager marked the instalment ready by hand */
  markedReady?: boolean;
}

/** 100 % in basis points. */
export const FULL_BP = 10_000;

/** Instalments in plan order (sequence, then planned date). */
const ordered = <T extends Pick<PlanInstalment, "sequence" | "plannedDate">>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => a.sequence - b.sequence || a.plannedDate.localeCompare(b.plannedDate));

/**
 * Amount of each instalment in øre, in plan order. Percentages are taken of the fee; when every instalment is a
 * percentage and they add up to 100 %, the last one absorbs the rounding so the plan totals the fee to the øre.
 * @example instalmentAmounts(60_000_000, plan2030_25_25) // [12_000_000, 18_000_000, 15_000_000, 15_000_000]
 */
export function instalmentAmounts(fee: Minor, items: readonly PlanInstalment[]): Map<string, Minor> {
  const list = ordered(items);
  const out = new Map<string, Minor>();
  const allPct = list.length > 0 && list.every((i) => i.percentageBp !== null);
  const pctSum = list.reduce((a, i) => a + (i.percentageBp ?? 0), 0);
  let running = 0;
  list.forEach((i, idx) => {
    let value = i.percentageBp !== null ? percentOf(fee, i.percentageBp) : (i.amount ?? 0);
    if (allPct && pctSum === FULL_BP && idx === list.length - 1) value = fee - running;
    running += value;
    out.set(i.id, value);
  });
  return out;
}

/** Result of checking a plan before it may be activated. */
export type PlanValidation =
  | { ok: true; totalBp: number; total: Minor }
  | {
      ok: false;
      code: "plan_empty" | "plan_not_100_percent" | "plan_invalid_share";
      totalBp: number;
      total: Minor;
    };

/**
 * A plan may be saved as active only when its instalments add up to exactly 100 % of the fee. Percentages and
 * fixed amounts may be mixed; the check is done on the amounts in øre, so 20/30/25/25 % of 600.000 kr passes
 * and 20/30/25 % is rejected.
 */
export function validatePlan(fee: Minor, items: readonly PlanInstalment[]): PlanValidation {
  const amounts = instalmentAmounts(fee, items);
  const total = [...amounts.values()].reduce((a, v) => a + v, 0);
  const totalBp = fee > 0 ? Math.round((total * FULL_BP) / fee) : 0;
  if (!items.length) return { ok: false, code: "plan_empty", totalBp, total };
  const badShare = items.some(
    (i) =>
      (i.percentageBp === null && (i.amount === null || i.amount <= 0)) ||
      (i.percentageBp !== null && (i.percentageBp <= 0 || i.percentageBp > FULL_BP)),
  );
  if (badShare) return { ok: false, code: "plan_invalid_share", totalBp, total };
  if (fee <= 0 || total !== fee) return { ok: false, code: "plan_not_100_percent", totalBp, total };
  return { ok: true, totalBp, total };
}

/**
 * Status of every instalment on `today`, by the rules at the top of this file. Only the first not-yet-invoiced
 * instalment can become klar by date; a done phase or a manual mark makes an instalment klar regardless.
 * @example instalment 2 is klar on its planned date once instalment 1 is invoiced; instalment 3 stays afventer.
 */
export function instalmentStatuses(
  items: readonly PlanInstalment[],
  today: LocalDate,
): Map<string, InstalmentStatus> {
  const out = new Map<string, InstalmentStatus>();
  let previousInvoiced = true;
  for (const i of ordered(items)) {
    let status: InstalmentStatus;
    if (i.invoiced) status = "faktureret";
    else if (i.phaseDone || i.markedReady) status = "klar";
    else if (!previousInvoiced) status = "afventer";
    else status = i.plannedDate <= today ? "klar" : "planlagt";
    out.set(i.id, status);
    previousInvoiced = i.invoiced;
  }
  return out;
}

/** The next instalment that is not invoiced yet (for "næste rate" in the case overview), or null. */
export function nextInstalment<T extends PlanInstalment>(items: readonly T[]): T | null {
  return ordered(items).find((i) => !i.invoiced) ?? null;
}

/**
 * A conto by % complete (optional, behind a tenant setting): phase fee × % complete − already invoiced on the
 * phase, never below zero. @example acontoSuggestion(10_000_000, 4000, 2_500_000) // 1_500_000 øre
 */
export function acontoSuggestion(phaseFee: Minor, completionBp: number, alreadyInvoiced: Minor): Minor {
  if (completionBp < 0 || completionBp > FULL_BP) throw new RangeError("completion must be 0–100 %");
  return Math.max(0, percentOf(phaseFee, completionBp) - alreadyInvoiced);
}
