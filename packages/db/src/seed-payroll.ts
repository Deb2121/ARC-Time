/**
 * M4 part of the fictional seed: salary codes ("lønarter") with illustrative provider codes, the mapping from absence
 * codes, and payroll numbers for every employee except Frederik (FH) — so the export shows the "missing payroll
 * number" warning. Idempotent: does nothing when the tenant already has salary codes, so it can also top up a
 * database seeded before payroll existed.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "./client.ts";
import * as s from "./schema.ts";

/** code, name, unit, kind, provider code, absence code it is fed by (absence kind only) */
const CODES: [string, string, string, string, string, string | null][] = [
  ["FERIE", "Ferie", "days", "absence", "31", "FERIE"],
  ["FERIEFRI", "Feriefridage", "days", "absence", "32", "FERIEFRI"],
  ["SYG", "Sygdom", "days", "absence", "40", "SYG"],
  ["BARNSYG", "Barns 1. sygedag", "days", "absence", "41", "BARNSYG"],
  ["ORLOV", "Orlov", "days", "absence", "50", "ORLOV"],
  ["ULON", "Fravær uden løn", "days", "absence", "51", "ULON"],
  ["KØRSEL", "Skattefri kørselsgodtgørelse", "km", "mileage", "60", null],
  ["UDLÆG", "Udlæg til refusion", "amount", "expense", "70", null],
];

/** Seeds payroll setup for one tenant (no-op when already present). Returns true when something was added. */
export async function seedPayroll(tx: Tx, tenantId: string): Promise<boolean> {
  const [existing] = await tx
    .select({ id: s.salaryCodes.id })
    .from(s.salaryCodes)
    .where(eq(s.salaryCodes.tenantId, tenantId))
    .limit(1);
  if (existing) return false;
  for (const [code, name, unit, kind, providerCode, absence] of CODES) {
    const [row] = await tx
      .insert(s.salaryCodes)
      .values({ tenantId, code, name, unit, kind, providerCode })
      .returning();
    if (absence && row)
      await tx
        .update(s.absenceCodes)
        .set({ salaryCodeId: row.id })
        .where(and(eq(s.absenceCodes.tenantId, tenantId), eq(s.absenceCodes.code, absence)));
  }
  const people = await tx
    .select({ id: s.users.id, initials: s.users.initials })
    .from(s.users)
    .where(and(eq(s.users.tenantId, tenantId), isNull(s.users.payrollNumber)))
    .orderBy(s.users.initials);
  let n = 1001;
  for (const p of people) {
    if (p.initials === "FH") continue; // deliberately missing: shows the warning in the export
    await tx
      .update(s.users)
      .set({ payrollNumber: String(n++) })
      .where(eq(s.users.id, p.id));
  }
  return true;
}
