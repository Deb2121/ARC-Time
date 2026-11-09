/**
 * GDPR rules (docs/spec/administration.md R5, decision D-026) — GRASP Information Expert for retention and
 * pseudonymisation. Bookkeeping data is kept 5 years from the end of the fiscal year it belongs to (Bogføringsloven;
 * ARCnordic's fiscal year is assumed to be the calendar year, OQ-39); personal identifiers on it are replaced by a
 * stable pseudonym when an employee is erased. Pure functions: no I/O.
 */
import type { LocalDate } from "./dates.ts";

/** Years bookkeeping data is retained after the end of its fiscal year. */
export const RETENTION_YEARS = 5;

/**
 * First date that is still inside retention: anything dated before it has passed retention.
 * @example retentionCutoff("2032-03-15") // "2027-01-01" — data from 2026 was kept through 2031
 */
export function retentionCutoff(today: LocalDate, years = RETENTION_YEARS): LocalDate {
  return `${Number(today.slice(0, 4)) - years}-01-01`;
}

/**
 * The pseudonym an erased employee gets: stable for the same person (so reports still group correctly) but not
 * reversible. @example pseudonymFor("3f2a9c1e-…") // { fullName: "Tidligere medarbejder #3F2A9C", initials: "X3F2A", … }
 */
export function pseudonymFor(userId: string) {
  const tag = userId.replaceAll("-", "").slice(0, 6).toUpperCase();
  return {
    fullName: `Tidligere medarbejder #${tag}`,
    initials: `X${tag.slice(0, 4)}`,
    email: `fjernet-${tag.toLowerCase()}@anonymiseret.invalid`,
  };
}

/** Why an erasure cannot run yet (shown to the Admin, translated as `gdpr.block.<code>`). */
export type ErasureBlocker = "still_active" | "manages_active_projects" | "manages_people";

/** Blockers for erasing a person (spec: must be inactive; not PM on active projects; no one reports to them). */
export function erasureBlockers(p: {
  active: boolean;
  activeProjectsManaged: number;
  directReports: number;
}): ErasureBlocker[] {
  const out: ErasureBlocker[] = [];
  if (p.active) out.push("still_active");
  if (p.activeProjectsManaged > 0) out.push("manages_active_projects");
  if (p.directReports > 0) out.push("manages_people");
  return out;
}
