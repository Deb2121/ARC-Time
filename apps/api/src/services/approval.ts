/**
 * Approval service (docs/spec/approval.md, decision D-013: the line manager approves the week) — GRASP Pure
 * Fabrication for the approval workflows. Who may approve whom is decided by `services/people.ts` (Information
 * Expert on the organisation); week totals come from @arc-tid/domain. Approving snapshots the resolved hourly
 * rate on every entry so later rate changes never alter history (brief §4.9, decision D-014).
 */
import { closedMonths, schema, snapshotRates, type Tx, writeAudit } from "@arc-tid/db";
import { addDays, dailyNorm, dayAnomalies, isLocked, type LocalDate, summariseWeek } from "@arc-tid/domain";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { AuthContext } from "../auth/plugin.ts";
import { loadEmployee, normContext, summaryEntries } from "./calendar.ts";
import { AppError } from "./errors.ts";
import { approveeIds, canApproveUser } from "./people.ts";
import { approvalMode, pendingPmSteps } from "./project-approval.ts";

/** Loads a timesheet period by id or throws 404. */
async function loadPeriod(tx: Tx, periodId: string) {
  const [p] = await tx.select().from(schema.timesheetPeriods).where(eq(schema.timesheetPeriods.id, periodId));
  if (!p) throw new AppError(404, "not_found");
  return p;
}

/** Throws 409 period_closed if any day of the week lies in a closed accounting month (locked for everyone, brief §9). */
async function assertWeekOpen(tx: Tx, weekStart: LocalDate) {
  const closed = await closedMonths(tx);
  if (isLocked(weekStart, closed) || isLocked(addDays(weekStart, 6), closed))
    throw new AppError(409, "period_closed");
}

/** Loads the period and checks that the caller is its approver and that the week is in an open accounting month. */
async function loadForDecision(tx: Tx, auth: AuthContext, periodId: string) {
  const p = await loadPeriod(tx, periodId);
  if (!(await canApproveUser(tx, auth, p.userId))) throw new AppError(403, "forbidden");
  await assertWeekOpen(tx, p.weekStart);
  return p;
}

/** Entries of the period's employee within its week (filter for queries). */
const weekEntries = (userId: string, weekStart: LocalDate) =>
  and(
    eq(schema.timeEntries.userId, userId),
    gte(schema.timeEntries.date, weekStart),
    lte(schema.timeEntries.date, addDays(weekStart, 6)),
  );

/**
 * The approver's inbox for one ISO week: every person the caller approves with status, norm, registered hours,
 * billable %, flex this week, anomaly flags (days far over/under norm) and hours per project. Hours are decimal.
 */
export async function approvalInbox(tx: Tx, auth: AuthContext, weekStart: LocalDate) {
  const sunday = addDays(weekStart, 6);
  const ids = await approveeIds(tx, auth);
  if (!ids.length) return { weekStart, items: [] };
  const people = await tx
    .select({ id: schema.users.id, fullName: schema.users.fullName, initials: schema.users.initials })
    .from(schema.users)
    .where(and(inArray(schema.users.id, ids), eq(schema.users.active, true)));
  const periods = await tx
    .select()
    .from(schema.timesheetPeriods)
    .where(
      and(inArray(schema.timesheetPeriods.userId, ids), eq(schema.timesheetPeriods.weekStart, weekStart)),
    );
  const perProject = await tx
    .select({
      userId: schema.timeEntries.userId,
      number: schema.projects.number,
      name: schema.projects.name,
      hours: sql<number>`sum(${schema.timeEntries.hours})::float`,
    })
    .from(schema.timeEntries)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.timeEntries.projectId))
    .where(
      and(
        inArray(schema.timeEntries.userId, ids),
        gte(schema.timeEntries.date, weekStart),
        lte(schema.timeEntries.date, sunday),
      ),
    )
    .groupBy(schema.timeEntries.userId, schema.projects.number, schema.projects.name);

  const pmMode = (await approvalMode(tx, auth.tenantId)) === "pm_then_line_manager";
  const items = [];
  for (const person of people.sort((a, b) => a.fullName.localeCompare(b.fullName))) {
    const emp = await loadEmployee(tx, person.id);
    if (!emp) continue;
    const ctx = await normContext(tx, emp);
    const s = summariseWeek(weekStart, await summaryEntries(tx, person.id, weekStart, sunday), (d) =>
      dailyNorm(d, ctx),
    );
    const period = periods.find((p) => p.userId === person.id);
    items.push({
      periodId: period?.id ?? null,
      user: person,
      status: !period || period.status === "open" ? "not_submitted" : period.status,
      norm: s.normHours / 100,
      work: s.workHours / 100,
      absence: s.countingAbsenceHours / 100,
      billable: s.billableHours / 100,
      billableBp: s.billableBp,
      flex: s.flex / 100,
      anomalies: dayAnomalies(s.days),
      /** open project manager steps; the line manager may still approve ("on behalf", audited) */
      pmPending:
        pmMode && period && period.status !== "open" ? await pendingPmSteps(tx, person.id, weekStart) : 0,
      projects: perProject.filter((x) => x.userId === person.id).map(({ userId: _u, ...rest }) => rest),
    });
  }
  return { weekStart, items };
}

/**
 * Approves a submitted week: submitted entries → approved, rate snapshot taken (5-step resolution), period →
 * approved, event logged and audited. Refused if the caller is not the approver or the month is closed.
 */
export async function approvePeriod(tx: Tx, auth: AuthContext, periodId: string) {
  const p = await loadForDecision(tx, auth, periodId);
  if (p.status !== "submitted" && p.status !== "partially_approved") throw new AppError(409, "not_submitted");
  const onBehalfOfPm = await pendingPmSteps(tx, p.userId, p.weekStart);
  const updated = await tx
    .update(schema.timeEntries)
    .set({ status: "approved", approvedBy: auth.userId, approvedAt: new Date(), updatedAt: new Date() })
    .where(and(weekEntries(p.userId, p.weekStart), eq(schema.timeEntries.status, "submitted")))
    .returning({ id: schema.timeEntries.id });
  await snapshotRates(
    tx,
    updated.map((u) => u.id),
  );
  await tx
    .update(schema.timesheetPeriods)
    .set({ status: "approved", decidedBy: auth.userId, decidedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.timesheetPeriods.id, p.id));
  await tx
    .insert(schema.timesheetEvents)
    .values({ tenantId: auth.tenantId, periodId: p.id, action: "approve", userId: auth.userId });
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "timesheet_period",
    entityId: p.id,
    action: "approve",
    userId: auth.userId,
    before: { status: p.status },
    after: { status: "approved", entries: updated.length, ...(onBehalfOfPm ? { onBehalfOfPm } : {}) },
  });
  return { status: "approved", entries: updated.length };
}

/** Rejects a submitted week with a required comment shown to the employee; entries → rejected (editable again). */
export async function rejectPeriod(tx: Tx, auth: AuthContext, periodId: string, comment: string) {
  const p = await loadForDecision(tx, auth, periodId);
  if (p.status !== "submitted" && p.status !== "partially_approved") throw new AppError(409, "not_submitted");
  await tx
    .update(schema.timeEntries)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(and(weekEntries(p.userId, p.weekStart), eq(schema.timeEntries.status, "submitted")));
  await tx
    .update(schema.timesheetPeriods)
    .set({
      status: "rejected",
      decidedBy: auth.userId,
      decidedAt: new Date(),
      comment,
      updatedAt: new Date(),
    })
    .where(eq(schema.timesheetPeriods.id, p.id));
  await tx
    .insert(schema.timesheetEvents)
    .values({ tenantId: auth.tenantId, periodId: p.id, action: "reject", userId: auth.userId, comment });
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "timesheet_period",
    entityId: p.id,
    action: "reject",
    userId: auth.userId,
    before: { status: p.status },
    after: { status: "rejected" },
    reason: comment,
  });
  return { status: "rejected" };
}

/**
 * The approver reopens an approved week (e.g. the employee found a mistake): entries → draft and their rate
 * snapshots are removed. Refused while any hour is on an invoice (draft or booked) — Finance must credit first.
 */
export async function reopenApprovedPeriod(tx: Tx, auth: AuthContext, periodId: string, reason: string) {
  const p = await loadForDecision(tx, auth, periodId);
  if (p.status !== "approved") throw new AppError(409, "not_approved");
  const range = weekEntries(p.userId, p.weekStart);
  const [held] = await tx
    .select({ id: schema.timeEntries.id })
    .from(schema.timeEntries)
    .where(
      and(
        range,
        sql`(${schema.timeEntries.status} = 'invoiced' or ${schema.timeEntries.invoiceLineId} is not null)`,
      ),
    )
    .limit(1);
  if (held) throw new AppError(409, "contains_invoiced_entries");
  await tx
    .update(schema.timeEntries)
    .set({
      status: "draft",
      salesRate: null,
      costRate: null,
      approvedBy: null,
      approvedAt: null,
      pmApprovedBy: null,
      pmApprovedAt: null,
      updatedAt: new Date(),
    })
    .where(and(range, eq(schema.timeEntries.status, "approved")));
  await tx
    .update(schema.timesheetPeriods)
    .set({ status: "open", decidedBy: null, decidedAt: null, updatedAt: new Date() })
    .where(eq(schema.timesheetPeriods.id, p.id));
  await tx.insert(schema.timesheetEvents).values({
    tenantId: auth.tenantId,
    periodId: p.id,
    action: "reopen",
    userId: auth.userId,
    comment: reason,
  });
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "timesheet_period",
    entityId: p.id,
    action: "reopen",
    userId: auth.userId,
    before: { status: "approved" },
    after: { status: "open" },
    reason,
  });
  return { status: "open" };
}
