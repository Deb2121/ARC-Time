/**
 * Absence row actions for the employee's own week: remove a wrongly chosen absence type, or move its hours to the
 * right one. Both go through the normal cell endpoint (PUT /timesheet/entries), so every timesheet rule still
 * applies (locked weeks, closed months, 24 h per day). Used by the timesheet page; the buttons live in WeekGrid.
 */
import { api } from "@/lib/api";
import type { Row } from "./types";

/** The days of a row that hold hours, as [date, hours]. */
export const filledDays = (r: Row): [string, number][] =>
  Object.entries(r.cells)
    .filter(([, c]) => (c?.hours ?? 0) > 0)
    .map(([d, c]) => [d, c?.hours ?? 0]);

/** Clears every saved cell of an absence row (the row disappears once it has no hours). */
export async function removeAbsenceRow(r: Row): Promise<void> {
  if (r.kind !== "absence" || !r.ref.absenceCodeId) return;
  for (const [date] of filledDays(r))
    await api("/timesheet/entries", {
      method: "PUT",
      body: JSON.stringify({ date, absenceCodeId: r.ref.absenceCodeId, hours: 0 }),
    });
}

/**
 * Moves all hours of an absence row to another absence type: adds them to the target first (so nothing is lost if
 * that fails), then clears the original. `target` is the target row if it already exists in the week.
 */
export async function changeAbsenceType(r: Row, toCodeId: string, target: Row | undefined): Promise<void> {
  if (r.kind !== "absence" || !r.ref.absenceCodeId || r.ref.absenceCodeId === toCodeId) return;
  for (const [date, hours] of filledDays(r)) {
    const already = target?.cells[date]?.hours ?? 0;
    await api("/timesheet/entries", {
      method: "PUT",
      body: JSON.stringify({ date, absenceCodeId: toCodeId, hours: already + hours }),
    });
    await api("/timesheet/entries", {
      method: "PUT",
      body: JSON.stringify({ date, absenceCodeId: r.ref.absenceCodeId, hours: 0 }),
    });
  }
}
