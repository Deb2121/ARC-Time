/**
 * Approval (docs/spec/approval.md, decision D-013: line manager approves the week).
 * Approving takes the rate snapshot on each entry so later rate changes never alter history (brief §4.9).
 */
import { closedMonths, schema, snapshotRates, type Tx, writeAudit } from "@arc-tid/db";
import { addDays, dailyNorm, dayAnomalies, isLocked, isoWeekday, summariseWeek } from "@arc-tid/domain";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { type AuthContext, HttpError } from "../auth/plugin.ts";
import { loadEmployee, normContext, summaryEntries } from "../services/calendar.ts";
import { approveeIds, canApproveUser } from "../services/people.ts";

const monday = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => isoWeekday(d) === 1, "must be a Monday");

async function loadPeriod(tx: Tx, periodId: string) {
  const [p] = await tx.select().from(schema.timesheetPeriods).where(eq(schema.timesheetPeriods.id, periodId));
  if (!p) throw new HttpError(404, "not_found");
  return p;
}

/** Entries in a closed accounting month are locked for everyone (brief §4.4, §9). */
async function assertWeekOpen(tx: Tx, weekStart: string) {
  const closed = await closedMonths(tx);
  if (isLocked(weekStart, closed) || isLocked(addDays(weekStart, 6), closed))
    throw new HttpError(409, "period_closed");
}

async function approvePeriod(tx: Tx, auth: AuthContext, periodId: string) {
  const p = await loadPeriod(tx, periodId);
  if (!(await canApproveUser(tx, auth, p.userId))) throw new HttpError(403, "forbidden");
  if (p.status !== "submitted" && p.status !== "partially_approved")
    throw new HttpError(409, "not_submitted");
  await assertWeekOpen(tx, p.weekStart);
  const sunday = addDays(p.weekStart, 6);
  const updated = await tx
    .update(schema.timeEntries)
    .set({ status: "approved", approvedBy: auth.userId, approvedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.timeEntries.userId, p.userId),
        gte(schema.timeEntries.date, p.weekStart),
        lte(schema.timeEntries.date, sunday),
        eq(schema.timeEntries.status, "submitted"),
      ),
    )
    .returning({ id: schema.timeEntries.id });
  // Full 5-step rate resolution, snapshotted on each entry (brief §4.9, D-014).
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
    after: { status: "approved", entries: updated.length },
  });
  return { status: "approved", entries: updated.length };
}

export const approvalRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Approver inbox for one week: every person the caller approves, with totals and anomaly flags. */
  app.get("/approvals", { schema: { querystring: z.object({ weekStart: monday }) } }, async (req) => {
    const auth = req.auth as AuthContext;
    const { weekStart } = req.query;
    const sunday = addDays(weekStart, 6);
    return req.withTenant(async (tx) => {
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

      const items = [];
      for (const person of people.sort((a, b) => a.fullName.localeCompare(b.fullName))) {
        const emp = await loadEmployee(tx, person.id);
        if (!emp) continue;
        const ctx = await normContext(tx, emp);
        const s = summariseWeek(weekStart, await summaryEntries(tx, person.id, weekStart, sunday), (d) =>
          dailyNorm(d, ctx),
        );
        const period = periods.find((p) => p.userId === person.id);
        const status = !period || period.status === "open" ? "not_submitted" : period.status;
        items.push({
          periodId: period?.id ?? null,
          user: person,
          status,
          norm: s.normHours / 100,
          work: s.workHours / 100,
          absence: s.countingAbsenceHours / 100,
          billable: s.billableHours / 100,
          billableBp: s.billableBp,
          flex: s.flex / 100,
          anomalies: dayAnomalies(s.days),
          projects: perProject.filter((x) => x.userId === person.id).map(({ userId: _u, ...rest }) => rest),
        });
      }
      return { weekStart, items };
    });
  });

  app.post(
    "/approvals/:periodId/approve",
    { schema: { params: z.object({ periodId: z.string().uuid() }) } },
    async (req) => req.withTenant((tx) => approvePeriod(tx, req.auth as AuthContext, req.params.periodId)),
  );

  app.post(
    "/approvals/bulk-approve",
    { schema: { body: z.object({ periodIds: z.array(z.string().uuid()).min(1).max(200) }) } },
    async (req) =>
      req.withTenant(async (tx) => {
        const results = [];
        for (const id of req.body.periodIds)
          results.push({ periodId: id, ...(await approvePeriod(tx, req.auth as AuthContext, id)) });
        return { results };
      }),
  );

  app.post(
    "/approvals/:periodId/reject",
    {
      schema: {
        params: z.object({ periodId: z.string().uuid() }),
        body: z.object({ comment: z.string().trim().min(1, "comment_required").max(1000) }),
      },
    },
    async (req) => {
      const auth = req.auth as AuthContext;
      return req.withTenant(async (tx) => {
        const p = await loadPeriod(tx, req.params.periodId);
        if (!(await canApproveUser(tx, auth, p.userId))) throw new HttpError(403, "forbidden");
        await assertWeekOpen(tx, p.weekStart);
        if (p.status !== "submitted" && p.status !== "partially_approved")
          throw new HttpError(409, "not_submitted");
        await tx
          .update(schema.timeEntries)
          .set({ status: "rejected", updatedAt: new Date() })
          .where(
            and(
              eq(schema.timeEntries.userId, p.userId),
              gte(schema.timeEntries.date, p.weekStart),
              lte(schema.timeEntries.date, addDays(p.weekStart, 6)),
              eq(schema.timeEntries.status, "submitted"),
            ),
          );
        await tx
          .update(schema.timesheetPeriods)
          .set({
            status: "rejected",
            decidedBy: auth.userId,
            decidedAt: new Date(),
            comment: req.body.comment,
            updatedAt: new Date(),
          })
          .where(eq(schema.timesheetPeriods.id, p.id));
        await tx.insert(schema.timesheetEvents).values({
          tenantId: auth.tenantId,
          periodId: p.id,
          action: "reject",
          userId: auth.userId,
          comment: req.body.comment,
        });
        await writeAudit(tx, {
          tenantId: auth.tenantId,
          entity: "timesheet_period",
          entityId: p.id,
          action: "reject",
          userId: auth.userId,
          before: { status: p.status },
          after: { status: "rejected" },
          reason: req.body.comment,
        });
        return { status: "rejected" };
      });
    },
  );

  /** Approver reopens an approved week (e.g. employee found a mistake). Invoiced entries stay locked. */
  app.post(
    "/approvals/:periodId/reopen",
    {
      schema: {
        params: z.object({ periodId: z.string().uuid() }),
        body: z.object({ reason: z.string().trim().min(1).max(1000) }),
      },
    },
    async (req) => {
      const auth = req.auth as AuthContext;
      return req.withTenant(async (tx) => {
        const p = await loadPeriod(tx, req.params.periodId);
        if (!(await canApproveUser(tx, auth, p.userId))) throw new HttpError(403, "forbidden");
        await assertWeekOpen(tx, p.weekStart);
        if (p.status !== "approved") throw new HttpError(409, "not_approved");
        const range = and(
          eq(schema.timeEntries.userId, p.userId),
          gte(schema.timeEntries.date, p.weekStart),
          lte(schema.timeEntries.date, addDays(p.weekStart, 6)),
        );
        const [invoiced] = await tx
          .select({ id: schema.timeEntries.id })
          .from(schema.timeEntries)
          .where(
            and(
              range,
              sql`(${schema.timeEntries.status} = 'invoiced' or ${schema.timeEntries.invoiceLineId} is not null)`,
            ),
          )
          .limit(1);
        if (invoiced) throw new HttpError(409, "contains_invoiced_entries");
        await tx
          .update(schema.timeEntries)
          .set({
            status: "draft",
            salesRate: null,
            costRate: null,
            approvedBy: null,
            approvedAt: null,
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
          comment: req.body.reason,
        });
        await writeAudit(tx, {
          tenantId: auth.tenantId,
          entity: "timesheet_period",
          entityId: p.id,
          action: "reopen",
          userId: auth.userId,
          before: { status: "approved" },
          after: { status: "open" },
          reason: req.body.reason,
        });
        return { status: "open" };
      });
    },
  );
};
