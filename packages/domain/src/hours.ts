/**
 * Hours are handled as integer hundredths of an hour ("centi-hours") to avoid floating-point drift.
 * 7,5 h = 750. Storage is numeric(6,2), which maps 1:1. See docs/spec/overview.md §5 and decision D-005.
 */
export type CentiHours = number;

export const HOURS_STEP: CentiHours = 25; // 0,25 h
export const MAX_HOURS_PER_DAY: CentiHours = 2400;

/** Thrown by `parseHours` when the text is not a valid number of hours. */
export class HoursParseError extends Error {}

/** Parses "1,5", "1.5", "1:30", "2" into centi-hours. Throws HoursParseError on invalid input. */
export function parseHours(input: string): CentiHours {
  const s = input.trim();
  if (s === "") throw new HoursParseError("empty");
  const hm = /^(\d{1,2}):([0-5]\d)$/.exec(s);
  if (hm) {
    return Number(hm[1]) * 100 + Math.round((Number(hm[2]) * 100) / 60);
  }
  const dec = /^(\d{1,2})(?:[.,](\d{1,2}))?$/.exec(s);
  if (!dec) throw new HoursParseError(`invalid hours: ${input}`);
  const frac = (dec[2] ?? "").padEnd(2, "0");
  return Number(dec[1]) * 100 + Number(frac);
}

/** True when the centi-hours are a whole multiple of the step (default 25 = 0,25 h). */
export function isOnStep(h: CentiHours, step: CentiHours = HOURS_STEP): boolean {
  return Number.isInteger(h) && h % step === 0;
}

/** Rounds to the nearest step; ties round up. Used by the timer (docs/spec/time-tracking.md). */
export function roundToStep(h: CentiHours, step: CentiHours = HOURS_STEP): CentiHours {
  return Math.floor((h + step / 2) / step) * step;
}

/**
 * Formats centi-hours with two decimals. @example formatHours(750) // "7,50"; formatHours(750, "en") // "7.50"
 */
export function formatHours(h: CentiHours, locale: "da" | "en" = "da"): string {
  const sign = h < 0 ? "-" : "";
  const abs = Math.abs(h);
  const sep = locale === "da" ? "," : ".";
  return `${sign}${Math.floor(abs / 100)}${sep}${String(abs % 100).padStart(2, "0")}`;
}

/** Centi-hours → decimal hours. @example toDecimal(750) // 7.5 */
export const toDecimal = (h: CentiHours): number => h / 100;
/** Decimal hours → centi-hours (rounded). @example fromDecimal(7.5) // 750 */
export const fromDecimal = (d: number): CentiHours => Math.round(d * 100);
