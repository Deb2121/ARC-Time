/**
 * Leave accounts ("løntidskonti") for ferie and feriefridage — decision D-037. GRASP Pure Fabrication: gathers the
 * inputs (employment, go-live date, opening balances, approved leave, manual postings) and lets
 * @arc-tid/domain (leave.ts) build the postings and the running balance.
 *
 *   ferie         2,08 days a month for everyone; leave = absence code FERIE (shown with the payroll code, e.g. "31 - Ferie")
 *   feriefridag   the employee's own rate (users.extra_holiday_per_month, e.g. 0,50); leave = absence code FERIEFRI
 *
 * Accrual is derived (posted at each ended month's end), so it can never be posted twice. Leave counts when the week
 * is approved; registered but not yet approved leave is shown as "afventer". Manual postings (corrections,
 * carry-over, payout, lapse) are stored in leave_adjustments and audited.
 */
import { closedMonths, schema, type Tx, writeAudit } from "@arc-tid/db";
import {
  ACCRUAL_PER_MONTH,
  accrualPostings,
  dailyNorm,
  fromDecimal,
  hasRole,
  isLocked,
  type LeaveAccount,
  type LeavePosting,
  leaveDays,
  runningBalance,
  todayCopenhagen,
} from "@arc-tid/domain";
import { and, asc, eq, gte } from "drizzle-orm";
import type { AuthContext } from "../auth/plugin.ts";
import { loadEmployee, normContext } from "./calendar.ts";
import { AppError } from "./errors.ts";
import { canViewUser } from "./people.ts";

const ABSENCE_CODE: Record<LeaveAccount, string> = { ferie: "FERIE", feriefridag: "FERIEFRI" };
const TAKEN = new Set(["approved", "invoiced"]);
const centi = (days: number) => Math.round(days * 100);

/** Finance and Admin may make manual postings and set the feriefridage rate. */
export const canManageLeave = (auth: AuthContext) =>
  hasRole(auth.roles, "finance") || hasRole(auth.roles, "admin");

/** Both leave accounts of one employee with postings, running balance and pending (not yet approved) leave. */
export async function leaveAccounts(tx: Tx, auth: AuthContext, userId: string, today = todayCopenhagen()) {
  if (!(await canViewUser(tx, auth, userId))) throw new AppError(404, "not_found");
  const emp = await loadEmployee(tx, userId);
  if (!emp) throw new AppError(404, "not_found");
  const [u] = await tx.select().from(schema.users).where(eq(schema.users.id, userId));
  const [tenant] = await tx.select({ goLive: schema.tenants.goLiveDate }).from(schema.tenants).limit(1);
  const goLive = tenant?.goLive ?? today;
  const ctx = await normContext(tx, emp);

  const leave = await tx
    .select({
      date: schema.timeEntries.date,
      hours: schema.timeEntries.hours,
      status: schema.timeEntries.status,
      code: schema.absenceCodes.code,
      name: schema.absenceCodes.nameDa,
      salaryCode: schema.salaryCodes.providerCode,
    })
    .from(schema.timeEntries)
    .innerJoin(schema.absenceCodes, eq(schema.absenceCodes.id, schema.timeEntries.absenceCodeId))
    .leftJoin(schema.salaryCodes, eq(schema.salaryCodes.id, schema.absenceCodes.salaryCodeId))
    .where(and(eq(schema.timeEntries.userId, userId), gte(schema.timeEntries.date, goLive)));
  const adjustments = await tx
    .select()
    .from(schema.leaveAdjustments)
    .where(eq(schema.leaveAdjustments.userId, userId))
    .orderBy(asc(schema.leaveAdjustments.date));

  const account = (kind: LeaveAccount, perMonth: number, opening: number) => {
    const postings: LeavePosting[] = accrualPostings(
      goLive,
      today,
      emp.employmentStart,
      emp.employmentEnd ?? undefined,
      perMonth,
    );
    let pending = 0;
    for (const l of leave.filter((x) => x.code === ABSENCE_CODE[kind])) {
      const days = leaveDays(fromDecimal(l.hours), dailyNorm(l.date, ctx));
      if (!days) continue;
      if (TAKEN.has(l.status) && l.date <= today)
        postings.push({
          date: l.date,
          kind: "taken",
          text: `${l.salaryCode ?? l.code} - ${l.name}`,
          days: -days,
        });
      else pending += days;
    }
    for (const a of adjustments.filter((x) => x.account === kind))
      postings.push({ date: a.date, kind: "adjustment", text: a.text, days: centi(a.days) });
    const lines = runningBalance(opening, postings);
    const balance = lines.at(-1)?.balance ?? opening;
    return {
      account: kind,
      perMonth,
      openingDate: goLive,
      opening,
      lines,
      earned: lines.filter((l) => l.days > 0).reduce((a, l) => a + l.days, 0),
      used: -lines.filter((l) => l.kind === "taken").reduce((a, l) => a + l.days, 0),
      balance,
      pending,
      available: balance - pending,
    };
  };

  return {
    userId,
    fullName: u?.fullName ?? "",
    today,
    canManage: canManageLeave(auth),
    accounts: [
      account("ferie", ACCRUAL_PER_MONTH, centi(emp.vacationOpening)),
      account("feriefridag", centi(u?.extraHolidayPerMonth ?? 0), centi(u?.extraHolidayOpening ?? 0)),
    ],
  };
}

/** Input for a manual posting; days signed (positive = credit). */
export interface LeaveAdjustmentInput {
  userId: string;
  account: LeaveAccount;
  date: string;
  days: number;
  text: string;
}

/** Adds a manual posting (Finance/Admin): correction, carry-over, payout or lapse. Not in a closed month; audited. */
export async function addLeaveAdjustment(tx: Tx, auth: AuthContext, b: LeaveAdjustmentInput) {
  if (!canManageLeave(auth)) throw new AppError(403, "forbidden");
  if (isLocked(b.date, await closedMonths(tx))) throw new AppError(409, "period_closed");
  const emp = await loadEmployee(tx, b.userId);
  if (!emp) throw new AppError(404, "not_found");
  const [row] = await tx
    .insert(schema.leaveAdjustments)
    .values({ tenantId: auth.tenantId, ...b, createdBy: auth.userId })
    .returning();
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "leave",
    entityId: row?.id ?? "",
    action: "create",
    userId: auth.userId,
    after: row,
  });
  return row;
}

/** Sets an employee's feriefridage rate (days per month) and opening balance (Finance/Admin); audited. */
export async function setExtraHoliday(
  tx: Tx,
  auth: AuthContext,
  userId: string,
  b: { perMonth?: number | undefined; opening?: number | undefined },
) {
  if (!canManageLeave(auth)) throw new AppError(403, "forbidden");
  const [before] = await tx.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!before) throw new AppError(404, "not_found");
  const [after] = await tx
    .update(schema.users)
    .set({
      ...(b.perMonth !== undefined ? { extraHolidayPerMonth: b.perMonth } : {}),
      ...(b.opening !== undefined ? { extraHolidayOpening: b.opening } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, userId))
    .returning();
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "employee",
    entityId: userId,
    action: "update",
    userId: auth.userId,
    before: {
      feriefridagePrMaaned: before.extraHolidayPerMonth,
      feriefridageStart: before.extraHolidayOpening,
    },
    after: {
      feriefridagePrMaaned: after?.extraHolidayPerMonth,
      feriefridageStart: after?.extraHolidayOpening,
    },
  });
  return { ok: true };
}
