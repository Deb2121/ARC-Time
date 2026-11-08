/**
 * Timesheet (docs/spec/time-tracking.md). Week view, cell upsert, submit/reopen, task search, favourites.
 * Validation rules come from @arc-tid/domain.validateEntry so the browser and the API agree.
 */
import { closedMonths, schema, type Tx, writeAudit } from "@arc-tid/db";
import {
  addDays,
  dailyNorm,
  type EntryError,
  fromDecimal,
  isEditableStatus,
  isLocked,
  isoWeekday,
  type LocalDate,
  startOfIsoWeek,
  summariseWeek,
  todayCopenhagen,
  validateEntry,
} from "@arc-tid/domain";
import { and, asc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { type AuthContext, HttpError } from "../auth/plugin.ts";
import { flexBalance, loadEmployee, normContext, summaryEntries } from "../services/calendar.ts";
import { canViewUser } from "../services/people.ts";

const LOCKED_PERIOD = new Set(["submitted", "partially_approved", "approved"]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const monday = isoDate.refine((d) => isoWeekday(d) === 1, "must be a Monday");

async function tenantGoLive(tx: Tx, tenantId: string): Promise<string> {
  const [t] = await tx
    .select({ goLive: schema.tenants.goLiveDate })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId));
  return t?.goLive ?? "2000-01-01";
}

async function getPeriod(tx: Tx, userId: string, weekStart: string) {
  const [p] = await tx
    .select()
    .from(schema.timesheetPeriods)
    .where(and(eq(schema.timesheetPeriods.userId, userId), eq(schema.timesheetPeriods.weekStart, weekStart)));
  return p;
}

async function ensurePeriod(tx: Tx, auth: AuthContext, userId: string, weekStart: string) {
  const existing = await getPeriod(tx, userId, weekStart);
  if (existing) return existing;
  const [created] = await tx
    .insert(schema.timesheetPeriods)
    .values({ tenantId: auth.tenantId, userId, weekStart })
    .returning();
  if (!created) throw new HttpError(500, "period_create_failed");
  return created;
}

/** Builds the week view for one employee. */
export async function weekView(tx: Tx, auth: AuthContext, userId: string, weekStart: string) {
  const emp = await loadEmployee(tx, userId);
  if (!emp) throw new HttpError(404, "not_found");
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
      const ref = e.taskId
        ? (taskInfo.find((t) => t.taskId === e.taskId) ?? { taskId: e.taskId })
        : (() => {
            const c = codes.find((x) => x.id === e.absenceCodeId);
            return {
              absenceCodeId: e.absenceCodeId,
              code: c?.code,
              nameDa: c?.nameDa,
              nameEn: c?.nameEn,
              countsTowardNorm: c?.countsTowardNorm,
            };
          })();
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

const ERROR_STATUS: Partial<Record<EntryError, number>> = { not_editable: 409, period_locked: 409 };

export const timesheetRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/timesheet/week/:weekStart",
    {
      schema: {
        params: z.object({ weekStart: monday }),
        querystring: z.object({ userId: z.string().uuid().optional() }),
      },
    },
    async (req) => {
      const auth = req.auth as AuthContext;
      const userId = req.query.userId ?? auth.userId;
      return req.withTenant(async (tx) => {
        if (!(await canViewUser(tx, auth, userId))) throw new HttpError(403, "forbidden");
        return weekView(tx, auth, userId, req.params.weekStart);
      });
    },
  );

  app.put(
    "/timesheet/entries",
    {
      schema: {
        body: z
          .object({
            date: isoDate,
            taskId: z.string().uuid().optional(),
            absenceCodeId: z.string().uuid().optional(),
            hours: z.number().min(0).max(24),
            comment: z.string().max(1000).nullish(),
            billable: z.boolean().optional(),
          })
          .refine(
            (b) => Boolean(b.taskId) !== Boolean(b.absenceCodeId),
            "exactly one of taskId or absenceCodeId",
          ),
      },
    },
    async (req) => {
      const auth = req.auth as AuthContext;
      const b = req.body;
      const hours = fromDecimal(b.hours);
      return req.withTenant(async (tx) => {
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
          if (!t) throw new HttpError(404, "task_not_found");
          const [member] = await tx
            .select()
            .from(schema.projectMembers)
            .where(
              and(
                eq(schema.projectMembers.projectId, t.projectId),
                eq(schema.projectMembers.userId, auth.userId),
              ),
            );
          if (!member) throw new HttpError(403, "not_project_member");
          const [child] = await tx
            .select({ id: schema.tasks.id })
            .from(schema.tasks)
            .where(eq(schema.tasks.parentId, b.taskId))
            .limit(1);
          if (child) throw new HttpError(400, "task_not_leaf");
          projectId = t.projectId;
          projectActive = t.projectStatus === "active";
          taskOpen = t.taskStatus === "open";
          commentRequired = t.commentRequired;
          defaultBillable = t.taskBillable;
        }

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
          periodLocked:
            LOCKED_PERIOD.has(period?.status ?? "open") || isLocked(b.date, await closedMonths(tx)),
          currentStatus: current?.status,
        });
        // Clearing a cell (0 h) never needs a comment.
        const blocking = hours === 0 ? errors.filter((e) => e !== "comment_required") : errors;
        if (blocking.length) {
          const first = blocking[0] as EntryError;
          throw Object.assign(new HttpError(ERROR_STATUS[first] ?? 422, first), { details: blocking });
        }

        if (hours === 0) {
          if (current) await tx.delete(schema.timeEntries).where(eq(schema.timeEntries.id, current.id));
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
      });
    },
  );

  app.post(
    "/timesheet/week/:weekStart/submit",
    {
      schema: {
        params: z.object({ weekStart: monday }),
        body: z.object({ comment: z.string().max(1000).optional() }).optional(),
      },
    },
    async (req) => {
      const auth = req.auth as AuthContext;
      const { weekStart } = req.params;
      return req.withTenant(async (tx) => {
        const period = await ensurePeriod(tx, auth, auth.userId, weekStart);
        if (LOCKED_PERIOD.has(period.status)) throw new HttpError(409, "already_submitted");
        const sunday = addDays(weekStart, 6);
        const view = await weekView(tx, auth, auth.userId, weekStart);
        // Closing rule (D-013): warn, do not block, when below norm.
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
              lte(schema.timeEntries.date, sunday),
              inArray(schema.timeEntries.status, ["draft", "rejected"]),
            ),
          );
        await tx
          .update(schema.timesheetPeriods)
          .set({
            status: "submitted",
            submittedAt: new Date(),
            comment: req.body?.comment ?? null,
            updatedAt: new Date(),
          })
          .where(eq(schema.timesheetPeriods.id, period.id));
        await tx.insert(schema.timesheetEvents).values({
          tenantId: auth.tenantId,
          periodId: period.id,
          action: "submit",
          userId: auth.userId,
          comment: req.body?.comment ?? null,
        });
        return { status: "submitted", warnings };
      });
    },
  );

  app.post(
    "/timesheet/week/:weekStart/reopen",
    { schema: { params: z.object({ weekStart: monday }) } },
    async (req) => {
      const auth = req.auth as AuthContext;
      const { weekStart } = req.params;
      return req.withTenant(async (tx) => {
        const period = await getPeriod(tx, auth.userId, weekStart);
        // The employee may take back a submitted week until someone has approved any of it.
        if (period?.status !== "submitted") throw new HttpError(409, "cannot_reopen");
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
      });
    },
  );

  /** Tasks the caller can register on: leaf tasks, open, on active projects they are a member of. */
  app.get(
    "/timesheet/tasks",
    { schema: { querystring: z.object({ q: z.string().max(100).optional() }) } },
    async (req) => {
      const auth = req.auth as AuthContext;
      const q = req.query.q?.trim().toLowerCase();
      return req.withTenant(async (tx) => {
        const children = tx
          .select({ parentId: schema.tasks.parentId })
          .from(schema.tasks)
          .where(sql`${schema.tasks.parentId} is not null`);
        const rows = await tx
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
        return rows;
      });
    },
  );

  app.post(
    "/timesheet/favourites",
    { schema: { body: z.object({ taskId: z.string().uuid() }) } },
    async (req) => {
      const auth = req.auth as AuthContext;
      return req.withTenant(async (tx) => {
        await tx
          .insert(schema.favourites)
          .values({ tenantId: auth.tenantId, userId: auth.userId, taskId: req.body.taskId })
          .onConflictDoNothing();
        return { ok: true };
      });
    },
  );

  app.delete(
    "/timesheet/favourites/:taskId",
    { schema: { params: z.object({ taskId: z.string().uuid() }) } },
    async (req) => {
      const auth = req.auth as AuthContext;
      return req.withTenant(async (tx) => {
        await tx
          .delete(schema.favourites)
          .where(
            and(eq(schema.favourites.userId, auth.userId), eq(schema.favourites.taskId, req.params.taskId)),
          );
        return { ok: true };
      });
    },
  );

  /** Row keys from the previous week, for "copy last week's rows" (rows only, no hours). */
  app.get(
    "/timesheet/week/:weekStart/previous-rows",
    { schema: { params: z.object({ weekStart: monday }) } },
    async (req) => {
      const auth = req.auth as AuthContext;
      const prev = addDays(req.params.weekStart, -7);
      return req.withTenant(async (tx) => {
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
      });
    },
  );
};

export { isEditableStatus, LOCKED_PERIOD, type LocalDate };
