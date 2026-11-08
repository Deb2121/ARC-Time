/**
 * Timesheet service (docs/spec/time-tracking.md) — GRASP Pure Fabrication: the database workflows behind the
 * weekly timesheet. The rules themselves (validation, week summary, flex) live in @arc-tid/domain (Information
 * Expert); this module gathers their inputs, applies them and persists the result. Routes in
 * `routes/timesheet.ts` only validate input, check access and call these functions (Controller).
 */
import { closedMonths, schema, type Tx, writeAudit } from "@arc-tid/db";
import {
  addDays,
  dailyNorm,
  type EntryError,
  fromDecimal,
  isLocked,
  type LocalDate,
  startOfIsoWeek,
  summariseWeek,
  todayCopenhagen,
  validateEntry,
} from "@arc-tid/domain";
import { and, asc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import type { AuthContext } from "../auth/plugin.ts";
import { flexBalance, loadEmployee, normContext, summaryEntries } from "./calendar.ts";
import { AppError } from "./errors.ts";

/** Timesheet period statuses in which the employee can no longer edit entries. */
export const LOCKED_PERIOD = new Set(["submitted", "partially_approved", "approved"]);

/** HTTP status per validation error; everything else is 422 Unprocessable Entity. */
const ERROR_STATUS: Partial<Record<EntryError, number>> = { not_editable: 409, period_locked: 409 };

/** The tenant's go-live date: balances are opening balance at this date + registrations after it. */
export async function tenantGoLive(tx: Tx, tenantId: string): Promise<LocalDate> {
  const [t] = await tx
    .select({ goLive: schema.tenants.goLiveDate })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId));
  return t?.goLive ?? "2000-01-01";
}

/** The employee's timesheet period for the ISO week starting `weekStart` (Monday), or undefined. */
export async function getPeriod(tx: Tx, userId: string, weekStart: LocalDate) {
  const [p] = await tx
    .select()
    .from(schema.timesheetPeriods)
    .where(and(eq(schema.timesheetPeriods.userId, userId), eq(schema.timesheetPeriods.weekStart, weekStart)));
  return p;
}

/** Returns the period for the week, creating an "open" one if none exists (GRASP Creator: the week owns its period). */
export async function ensurePeriod(tx: Tx, auth: AuthContext, userId: string, weekStart: LocalDate) {
  const existing = await getPeriod(tx, userId, weekStart);
  if (existing) return existing;
  const [created] = await tx
    .insert(schema.timesheetPeriods)
    .values({ tenantId: auth.tenantId, userId, weekStart })
    .returning();
  if (!created) throw new AppError(500, "period_create_failed");
  return created;
}

/** Task + project information for the given task ids (used for row labels and entry validation). */
export async function taskRows(tx: Tx, taskIds: string[]) {
  return tx
    .select({
      taskId: schema.tasks.id,
      taskName: schema.tasks.name,
      wbs: schema.tasks.wbs,
      taskBillable: schema.tasks.billable,
      taskStatus: schema.tasks.status,
      projectId: schema.projects.id,
      projectNumber: schema.projects.number,
      projectName: schema.projects.name,
      projectStatus: schema.projects.status,
      commentRequired: schema.projects.commentRequired,
      customerName: schema.customers.name,
    })
    .from(schema.tasks)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.tasks.projectId))
    .leftJoin(schema.customers, eq(schema.customers.id, schema.projects.customerId))
    .where(inArray(schema.tasks.id, taskIds));
}

/**
 * Builds everything the week screen shows for one employee and week: rows (task/absence) with cells per day, norm
 * per day, holidays, closed days, week summary (hours, billable %, flex this week), flex balance and the event log.
 * Hours in the response are decimal (7.5), not centi-hours, because they go straight to the UI.
 */
export async function weekView(tx: Tx, auth: AuthContext, userId: string, weekStart: LocalDate) {
  const emp = await loadEmployee(tx, userId);
  if (!emp) throw new AppError(404, "not_found");
  const ctx = await normContext(tx, emp);
  const sunday = addDays(weekStart, 6);
  const period = await getPeriod(tx, userId, weekStart);

  const entries = await tx
    .select({
      id: schema.timeEntries.id,
      date: schema.timeEntries.date,
      hours: schema.timeEntries.hours,
      billable: schema.timeEntries.billable,
      comment: schema.timeEntries.comment,
      status: schema.timeEntries.status,
      taskId: schema.timeEntries.taskId,
      absenceCodeId: schema.timeEntries.absenceCodeId,
    })
    .from(schema.timeEntries)
    .where(
      and(
        eq(schema.timeEntries.userId, userId),
        gte(schema.timeEntries.date, weekStart),
        lte(schema.timeEntries.date, sunday),
      ),
    );

  const taskIds = [...new Set(entries.flatMap((e) => (e.taskId ? [e.taskId] : [])))];
  const taskInfo = taskIds.length ? await taskRows(tx, taskIds) : [];
  const codes = await tx
    .select()
    .from(schema.absenceCodes)
    .where(eq(schema.absenceCodes.active, true))
    .orderBy(asc(schema.absenceCodes.code));

  type Cell = { id: string; hours: number; comment: string | null; status: string; billable: boolean };
  const rows = new Map<
    string,
    { key: string; kind: "task" | "absence"; ref: Record<string, unknown>; cells: Record<string, Cell> }
  >();
  for (const e of entries) {
    const key = e.taskId ? `t:${e.taskId}` : `a:${e.absenceCodeId}`;
    if (!rows.has(key)) {
      const code = codes.find((x) => x.id === e.absenceCodeId);
      const ref = e.taskId
        ? (taskInfo.find((t) => t.taskId === e.taskId) ?? { taskId: e.taskId })
        : {
            absenceCodeId: e.absenceCodeId,
            code: code?.code,
            nameDa: code?.nameDa,
            nameEn: code?.nameEn,
            countsTowardNorm: code?.countsTowardNorm,
          };
      rows.set(key, { key, kind: e.taskId ? "task" : "absence", ref, cells: {} });
    }
    const row = rows.get(key);
    if (row)
      row.cells[e.date] = {
        id: e.id,
        hours: e.hours,
        comment: e.comment,
        status: e.status,
        billable: e.billable,
      };
  }

  const summary = summariseWeek(weekStart, await summaryEntries(tx, userId, weekStart, sunday), (d) =>
    dailyNorm(d, ctx),
  );
  const events = period
    ? await tx
        .select({
          action: schema.timesheetEvents.action,
          comment: schema.timesheetEvents.comment,
          at: schema.timesheetEvents.at,
          by: schema.users.fullName,
        })
        .from(schema.timesheetEvents)
        .leftJoin(schema.users, eq(schema.users.id, schema.timesheetEvents.userId))
        .where(eq(schema.timesheetEvents.periodId, period.id))
        .orderBy(asc(schema.timesheetEvents.at))
    : [];
  const today = todayCopenhagen();
  const status = period?.status ?? "open";
  const closed = await closedMonths(tx);
  const closedDays = summary.days.filter((d) => isLocked(d.date, closed)).map((d) => d.date);
  return {
    userId,
    weekStart,
    status,
    editable: userId === auth.userId && !LOCKED_PERIOD.has(status) && closedDays.length < 7,
    closedDays,
    today,
    days: summary.days.map((d) => ({
      date: d.date,
      norm: d.norm / 100,
      holiday: ctx.holidays.has(d.date) ? (ctx.holidays.get(d.date)?.kind ?? null) : null,
    })),
    rows: [...rows.values()].sort((a, b) => a.key.localeCompare(b.key)),
    absenceCodes: codes.map((c) => ({
      id: c.id,
      code: c.code,
      nameDa: c.nameDa,
      nameEn: c.nameEn,
      countsTowardNorm: c.countsTowardNorm,
    })),
    summary: {
      norm: summary.normHours / 100,
      work: summary.workHours / 100,
      absence: summary.countingAbsenceHours / 100,
      billable: summary.billableHours / 100,
      billableBp: summary.billableBp,
      flex: summary.flex / 100,
    },
    flexBalance: (await flexBalance(tx, emp, today, await tenantGoLive(tx, auth.tenantId))) / 100,
    events,
  };
}

/** One cell of the timesheet: a task OR an absence code on a date, with decimal hours (0 clears the cell). */
export interface CellInput {
  date: LocalDate;
  taskId?: string | undefined;
  absenceCodeId?: string | undefined;
  hours: number;
  comment?: string | null | undefined;
  billable?: boolean | undefined;
}

/**
 * Saves one timesheet cell for the signed-in employee: checks membership and leaf task, runs the shared domain
 * validation (24 h/day, 0,25 step, future work, closed project/task, required comment, locked period), then
 * creates, updates or clears the entry. Entries held by an invoice cannot be edited; entries with invoice
 * history are cleared to 0 h instead of deleted (bookkeeping trail). Throws AppError with the failed rule codes.
 */
export async function saveCell(tx: Tx, auth: AuthContext, b: CellInput) {
  const hours = fromDecimal(b.hours);
  const weekStart = startOfIsoWeek(b.date);
  const period = await getPeriod(tx, auth.userId, weekStart);
  const cellFilter = and(
    eq(schema.timeEntries.userId, auth.userId),
    eq(schema.timeEntries.date, b.date),
    b.taskId
      ? eq(schema.timeEntries.taskId, b.taskId)
      : eq(schema.timeEntries.absenceCodeId, b.absenceCodeId ?? ""),
  );
  const [current] = await tx.select().from(schema.timeEntries).where(cellFilter);
  const [other] = await tx
    .select({ sum: sql<string>`coalesce(sum(${schema.timeEntries.hours}), 0)` })
    .from(schema.timeEntries)
    .where(
      and(
        eq(schema.timeEntries.userId, auth.userId),
        eq(schema.timeEntries.date, b.date),
        current ? ne(schema.timeEntries.id, current.id) : undefined,
      ),
    );

  let projectId: string | null = null;
  let projectActive = true;
  let taskOpen = true;
  let commentRequired = false;
  let defaultBillable = false;
  if (b.taskId) {
    const [t] = await taskRows(tx, [b.taskId]);
    if (!t) throw new AppError(404, "task_not_found");
    const [member] = await tx
      .select()
      .from(schema.projectMembers)
      .where(
        and(eq(schema.projectMembers.projectId, t.projectId), eq(schema.projectMembers.userId, auth.userId)),
      );
    if (!member) throw new AppError(403, "not_project_member");
    const [child] = await tx
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(eq(schema.tasks.parentId, b.taskId))
      .limit(1);
    if (child) throw new AppError(400, "task_not_leaf");
    projectId = t.projectId;
    projectActive = t.projectStatus === "active";
    taskOpen = t.taskStatus === "open";
    commentRequired = t.commentRequired;
    defaultBillable = t.taskBillable;
  }

  // Held by an invoice (draft or booked): only Finance can change it via the invoice.
  if (current?.invoiceLineId) throw new AppError(409, "not_editable", ["not_editable"]);
  const comment = b.comment === undefined ? (current?.comment ?? null) : b.comment;
  const errors = validateEntry({
    hours,
    date: b.date,
    today: todayCopenhagen(),
    otherHoursSameDay: fromDecimal(Number(other?.sum ?? 0)),
    isAbsence: Boolean(b.absenceCodeId),
    projectActive,
    taskOpen,
    commentRequired,
    comment,
    periodLocked: LOCKED_PERIOD.has(period?.status ?? "open") || isLocked(b.date, await closedMonths(tx)),
    currentStatus: current?.status,
  });
  // Clearing a cell (0 h) never needs a comment.
  const blocking = hours === 0 ? errors.filter((e) => e !== "comment_required") : errors;
  if (blocking.length) {
    const first = blocking[0] as EntryError;
    throw new AppError(ERROR_STATUS[first] ?? 422, first, blocking);
  }

  if (hours === 0) {
    if (!current) return { deleted: true };
    // An entry that has been on a booked invoice (e.g. invoiced, then credited back) is part of the bookkeeping
    // trail and is never deleted; clearing it keeps the row with 0 hours.
    const [history] = await tx
      .select({ id: schema.invoiceLineSources.id })
      .from(schema.invoiceLineSources)
      .where(eq(schema.invoiceLineSources.timeEntryId, current.id))
      .limit(1);
    if (history) {
      await tx
        .update(schema.timeEntries)
        .set({ hours: 0, status: "draft", updatedAt: new Date() })
        .where(eq(schema.timeEntries.id, current.id));
      return { cleared: true };
    }
    await tx.delete(schema.timeEntries).where(eq(schema.timeEntries.id, current.id));
    return { deleted: true };
  }
  const values = {
    hours: hours / 100,
    comment,
    billable: b.absenceCodeId ? false : (b.billable ?? current?.billable ?? defaultBillable),
    status: "draft" as const,
    updatedAt: new Date(),
  };
  // An edited rejected week goes back to "open" so it can be submitted again.
  if (period?.status === "rejected") {
    await tx
      .update(schema.timesheetPeriods)
      .set({ status: "open", updatedAt: new Date() })
      .where(eq(schema.timesheetPeriods.id, period.id));
  }
  if (current) {
    const [row] = await tx
      .update(schema.timeEntries)
      .set(values)
      .where(eq(schema.timeEntries.id, current.id))
      .returning();
    return { entry: row };
  }
  await ensurePeriod(tx, auth, auth.userId, weekStart);
  const [row] = await tx
    .insert(schema.timeEntries)
    .values({
      tenantId: auth.tenantId,
      userId: auth.userId,
      date: b.date,
      projectId,
      taskId: b.taskId ?? null,
      absenceCodeId: b.absenceCodeId ?? null,
      ...values,
    })
    .returning();
  return { entry: row };
}

/**
 * Submits the employee's week for approval: draft/rejected entries → submitted, period → submitted, event logged.
 * Returns warnings instead of blocking when the week is empty or below norm (closing rule "warn", decision D-013).
 */
export async function submitWeek(tx: Tx, auth: AuthContext, weekStart: LocalDate, comment: string | null) {
  const period = await ensurePeriod(tx, auth, auth.userId, weekStart);
  if (LOCKED_PERIOD.has(period.status)) throw new AppError(409, "already_submitted");
  const view = await weekView(tx, auth, auth.userId, weekStart);
  const warnings: string[] = [];
  if (view.summary.work + view.summary.absence === 0) warnings.push("empty_week");
  else if (view.summary.flex < 0) warnings.push("below_norm");
  await tx
    .update(schema.timeEntries)
    .set({ status: "submitted", updatedAt: new Date() })
    .where(
      and(
        eq(schema.timeEntries.userId, auth.userId),
        gte(schema.timeEntries.date, weekStart),
        lte(schema.timeEntries.date, addDays(weekStart, 6)),
        inArray(schema.timeEntries.status, ["draft", "rejected"]),
      ),
    );
  await tx
    .update(schema.timesheetPeriods)
    .set({ status: "submitted", submittedAt: new Date(), comment, updatedAt: new Date() })
    .where(eq(schema.timesheetPeriods.id, period.id));
  await tx
    .insert(schema.timesheetEvents)
    .values({ tenantId: auth.tenantId, periodId: period.id, action: "submit", userId: auth.userId, comment });
  return { status: "submitted", warnings };
}

/** Lets the employee take back a submitted week before anyone has approved it (audited). */
export async function withdrawWeek(tx: Tx, auth: AuthContext, weekStart: LocalDate) {
  const period = await getPeriod(tx, auth.userId, weekStart);
  if (period?.status !== "submitted") throw new AppError(409, "cannot_reopen");
  await tx
    .update(schema.timeEntries)
    .set({ status: "draft", updatedAt: new Date() })
    .where(
      and(
        eq(schema.timeEntries.userId, auth.userId),
        gte(schema.timeEntries.date, weekStart),
        lte(schema.timeEntries.date, addDays(weekStart, 6)),
        eq(schema.timeEntries.status, "submitted"),
      ),
    );
  await tx
    .update(schema.timesheetPeriods)
    .set({ status: "open", updatedAt: new Date() })
    .where(eq(schema.timesheetPeriods.id, period.id));
  await tx
    .insert(schema.timesheetEvents)
    .values({ tenantId: auth.tenantId, periodId: period.id, action: "reopen", userId: auth.userId });
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "timesheet_period",
    entityId: period.id,
    action: "reopen",
    userId: auth.userId,
    before: { status: "submitted" },
    after: { status: "open" },
  });
  return { status: "open" };
}

/** Tasks the employee can register on: open leaf tasks on active projects they are a member of; optional text search. */
export async function assignableTasks(tx: Tx, auth: AuthContext, search?: string) {
  const q = search?.trim().toLowerCase();
  const children = tx
    .select({ parentId: schema.tasks.parentId })
    .from(schema.tasks)
    .where(sql`${schema.tasks.parentId} is not null`);
  return tx
    .select({
      taskId: schema.tasks.id,
      taskName: schema.tasks.name,
      wbs: schema.tasks.wbs,
      billable: schema.tasks.billable,
      projectId: schema.projects.id,
      projectNumber: schema.projects.number,
      projectName: schema.projects.name,
      customerName: schema.customers.name,
      commentRequired: schema.projects.commentRequired,
      favourite: sql<boolean>`${schema.favourites.taskId} is not null`,
    })
    .from(schema.tasks)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.tasks.projectId))
    .innerJoin(
      schema.projectMembers,
      and(
        eq(schema.projectMembers.projectId, schema.projects.id),
        eq(schema.projectMembers.userId, auth.userId),
      ),
    )
    .leftJoin(schema.customers, eq(schema.customers.id, schema.projects.customerId))
    .leftJoin(
      schema.favourites,
      and(eq(schema.favourites.taskId, schema.tasks.id), eq(schema.favourites.userId, auth.userId)),
    )
    .where(
      and(
        eq(schema.projects.status, "active"),
        eq(schema.tasks.status, "open"),
        sql`${schema.tasks.id} not in (${children})`,
        q
          ? sql`(lower(${schema.projects.name}) like ${`%${q}%`} or lower(${schema.tasks.name}) like ${`%${q}%`} or ${schema.projects.number} like ${`%${q}%`} or lower(coalesce(${schema.customers.name}, '')) like ${`%${q}%`})`
          : undefined,
      ),
    )
    .orderBy(asc(schema.projects.number), asc(schema.tasks.wbs));
}

/** Marks a task as one of the employee's favourites (idempotent). */
export async function addFavourite(tx: Tx, auth: AuthContext, taskId: string) {
  await tx
    .insert(schema.favourites)
    .values({ tenantId: auth.tenantId, userId: auth.userId, taskId })
    .onConflictDoNothing();
}

/** Removes a task from the employee's favourites. */
export async function removeFavourite(tx: Tx, auth: AuthContext, taskId: string) {
  await tx
    .delete(schema.favourites)
    .where(and(eq(schema.favourites.userId, auth.userId), eq(schema.favourites.taskId, taskId)));
}

/** The still-usable task rows the employee had the week before `weekStart` ("copy last week's rows" — rows only, no hours). */
export async function previousWeekRows(tx: Tx, auth: AuthContext, weekStart: LocalDate) {
  const prev = addDays(weekStart, -7);
  const rows = await tx
    .selectDistinct({ taskId: schema.timeEntries.taskId })
    .from(schema.timeEntries)
    .where(
      and(
        eq(schema.timeEntries.userId, auth.userId),
        gte(schema.timeEntries.date, prev),
        lte(schema.timeEntries.date, addDays(prev, 6)),
        isNull(schema.timeEntries.absenceCodeId),
      ),
    );
  const ids = rows.flatMap((r) => (r.taskId ? [r.taskId] : []));
  const info = ids.length ? await taskRows(tx, ids) : [];
  return info.filter((t) => t.projectStatus === "active" && t.taskStatus === "open");
}
