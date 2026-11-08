/**
 * Display formatting for the web app (Danish first): hours, money, percentages, dates and week labels.
 * GRASP: Pure Fabrication — keeps locale rules in one place so every screen formats numbers the same way.
 * Inputs use the domain units: hours as decimals (7.5), money in øre, percentages in basis points.
 */
import { addDays, isoWeek } from "@arc-tid/domain";
import type { Locale } from "@/i18n";

const tag = (l: Locale) => (l === "da" ? "da-DK" : "en-GB");

/** 7.5 → "7,50" (da) / "7.50" (en); 0 → "" when blankZero. */
export function fmtHours(h: number | null | undefined, l: Locale, blankZero = false): string {
  if (h === null || h === undefined || (blankZero && h === 0)) return "";
  return new Intl.NumberFormat(tag(l), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(h);
}

/** Signed hours for flex: +0,50 / −1,25 */
export function fmtFlex(h: number, l: Locale): string {
  const s = fmtHours(Math.abs(h), l);
  return h > 0 ? `+${s}` : h < 0 ? `−${s}` : s;
}

/** øre → "117.600 kr" (whole kroner for dashboards) */
export function fmtKr(minor: number | null | undefined, l: Locale, decimals = 0): string {
  if (minor === null || minor === undefined) return "–";
  return `${new Intl.NumberFormat(tag(l), { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(minor / 100)} kr`;
}

/** basis points → "49,0 %" */
export function fmtPct(bp: number | null | undefined, l: Locale): string {
  if (bp === null || bp === undefined) return "–";
  return `${new Intl.NumberFormat(tag(l), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(bp / 100)} %`;
}

/** Formats a LocalDate with Intl options in the UI locale (UTC-based, so the day never shifts). */
export function fmtDay(date: string, l: Locale, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(tag(l), { timeZone: "UTC", ...opts }).format(new Date(`${date}T00:00:00Z`));
}

/** Label for a week, e.g. "Uge 45 · 2. nov. – 8. nov. 2026". */
export function weekLabel(monday: string, l: Locale): string {
  const { week } = isoWeek(monday);
  const sunday = addDays(monday, 6);
  const range = `${fmtDay(monday, l, { day: "numeric", month: "short" })} – ${fmtDay(sunday, l, { day: "numeric", month: "short", year: "numeric" })}`;
  return `${l === "da" ? "Uge" : "Week"} ${week} · ${range}`;
}
