/**
 * Resource planning (brief §4.8, docs/spec/resource-planning.md) — GRASP Information Expert for capacity and
 * utilisation bands. Capacity = norm hours (holidays already deducted) − planned/registered absence. Booked hours
 * come from allocations (employee × project × ISO week). Hours in centi-hours; utilisation in basis points.
 */
import type { CentiHours } from "./hours.ts";
import { divRound } from "./money.ts";

/** Heatmap band (brief §4.8): under < 70 %, ok 70–100 % (both inclusive), over > 100 %; none = no capacity. */
export type UtilisationBand = "none" | "under" | "ok" | "over";

/** Capacity for a week: norm − absence, never below zero. @example capacity(3700, 750) // 2950 = 29,5 h */
export function capacity(normHours: CentiHours, absenceHours: CentiHours): CentiHours {
  return Math.max(0, normHours - absenceHours);
}

/** Booked ÷ capacity in basis points (null when there is no capacity). @example utilisationBp(3330, 3700) // 9000 */
export function utilisationBp(booked: CentiHours, cap: CentiHours): number | null {
  return cap > 0 ? divRound(booked * 10_000, cap) : null;
}

/**
 * Heatmap colour band for a week. With no capacity (e.g. a vacation week) any booking is "over", otherwise "none".
 * @example utilisationBand(2589, 3700) // "under" (69,97 %); utilisationBand(2590, 3700) // "ok" (70 %)
 */
export function utilisationBand(booked: CentiHours, cap: CentiHours): UtilisationBand {
  if (cap <= 0) return booked > 0 ? "over" : "none";
  const bp = divRound(booked * 10_000, cap);
  if (bp > 10_000) return "over";
  if (bp >= 7_000) return "ok";
  return "under";
}

/** Free hours in a week (capacity − booked, never negative). */
export const freeHours = (booked: CentiHours, cap: CentiHours): CentiHours => Math.max(0, cap - booked);
