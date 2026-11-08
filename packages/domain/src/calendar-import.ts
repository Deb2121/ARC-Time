/**
 * Calendar import rules (docs/spec/integrations.md R6) — GRASP Information Expert for turning calendar events into
 * timesheet suggestions: all-day and "free" events are skipped, events spanning midnight are split per day, and
 * hours are rounded to the nearest 0,25 h (never below 0,25 h for a real meeting). Pure: no I/O, no Graph types.
 */
import type { LocalDate } from "./dates.ts";
import { addDays } from "./dates.ts";

/** A calendar event with local wall-clock times in Europe/Copenhagen ("YYYY-MM-DDTHH:mm[:ss…]"). */
export interface CalendarEventInput {
  id: string;
  subject: string;
  start: string;
  end: string;
  isAllDay: boolean;
  /** Outlook availability: free | tentative | busy | oof | workingElsewhere | unknown */
  showAs: string;
  isCancelled?: boolean;
}

/** One day's part of an event, as a timesheet suggestion. `hours` is in centi-hours (multiple of 25). */
export interface EventDay {
  eventId: string;
  subject: string;
  date: LocalDate;
  /** "HH:mm" local */
  from: string;
  /** "HH:mm" local ("24:00" when the event continues past midnight) */
  to: string;
  hours: number;
}

/** Minutes since midnight of a local "…THH:mm" timestamp. */
function minutesOf(ts: string): number {
  return Number(ts.slice(11, 13)) * 60 + Number(ts.slice(14, 16));
}

/** "HH:mm" for minutes since midnight. */
function clock(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Rounds minutes to centi-hours on the 0,25 h grid; any positive duration becomes at least 0,25 h. */
export function roundToQuarter(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.max(25, Math.round(minutes / 15) * 25);
}

/** True when an event should become a suggestion at all (not all-day, not "free", not cancelled). */
export function isImportable(ev: CalendarEventInput): boolean {
  return !ev.isAllDay && !ev.isCancelled && ev.showAs !== "free" && ev.end > ev.start;
}

/** Splits an event into one suggestion per day it covers (empty when not importable). */
export function splitEventByDay(ev: CalendarEventInput): EventDay[] {
  if (!isImportable(ev)) return [];
  const firstDay = ev.start.slice(0, 10);
  const lastDay = ev.end.slice(0, 10);
  const out: EventDay[] = [];
  for (let d = firstDay; d <= lastDay; d = addDays(d, 1)) {
    const from = d === firstDay ? minutesOf(ev.start) : 0;
    const to = d === lastDay ? minutesOf(ev.end) : 24 * 60;
    if (to <= from) continue;
    out.push({
      eventId: ev.id,
      subject: ev.subject,
      date: d,
      from: clock(from),
      to: clock(to),
      hours: roundToQuarter(to - from),
    });
  }
  return out;
}
