/**
 * Timesheet routes (docs/spec/time-tracking.md) — GRASP Controller: validate input, check access, delegate to
 * `services/timesheet.ts`. No business rules here.
 *
 *   GET    /timesheet/week/:weekStart[?userId]        week view (own, or a person the caller may see)
 *   PUT    /timesheet/entries                         save one cell (0 h clears it)
 *   POST   /timesheet/week/:weekStart/submit          submit the week for approval
 *   POST   /timesheet/week/:weekStart/reopen          withdraw a submitted, not yet approved week
 *   GET    /timesheet/tasks[?q]                       tasks the caller can register on
 *   POST   /timesheet/favourites                      add favourite task
 *   DELETE /timesheet/favourites/:taskId              remove favourite task
 *   GET    /timesheet/week/:weekStart/previous-rows   rows from the week before (copy last week)
 */
import { isoWeekday } from "@arc-tid/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthContext } from "../auth/plugin.ts";
import { AppError } from "../services/errors.ts";
import { canViewUser } from "../services/people.ts";
import {
  addFavourite,
  assignableTasks,
  previousWeekRows,
  removeFavourite,
  saveCell,
  submitWeek,
  weekView,
  withdrawWeek,
} from "../services/timesheet.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const monday = isoDate.refine((d) => isoWeekday(d) === 1, "must be a Monday");

/** Registers the timesheet endpoints under /api/v1. */
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
        if (!(await canViewUser(tx, auth, userId))) throw new AppError(403, "forbidden");
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
    async (req) => req.withTenant((tx) => saveCell(tx, req.auth as AuthContext, req.body)),
  );

  app.post(
    "/timesheet/week/:weekStart/submit",
    {
      schema: {
        params: z.object({ weekStart: monday }),
        body: z.object({ comment: z.string().max(1000).optional() }).optional(),
      },
    },
    async (req) =>
      req.withTenant((tx) =>
        submitWeek(tx, req.auth as AuthContext, req.params.weekStart, req.body?.comment ?? null),
      ),
  );

  app.post(
    "/timesheet/week/:weekStart/reopen",
    { schema: { params: z.object({ weekStart: monday }) } },
    async (req) => req.withTenant((tx) => withdrawWeek(tx, req.auth as AuthContext, req.params.weekStart)),
  );

  app.get(
    "/timesheet/tasks",
    { schema: { querystring: z.object({ q: z.string().max(100).optional() }) } },
    async (req) => req.withTenant((tx) => assignableTasks(tx, req.auth as AuthContext, req.query.q)),
  );

  app.post(
    "/timesheet/favourites",
    { schema: { body: z.object({ taskId: z.string().uuid() }) } },
    async (req) =>
      req.withTenant(async (tx) => {
        await addFavourite(tx, req.auth as AuthContext, req.body.taskId);
        return { ok: true };
      }),
  );

  app.delete(
    "/timesheet/favourites/:taskId",
    { schema: { params: z.object({ taskId: z.string().uuid() }) } },
    async (req) =>
      req.withTenant(async (tx) => {
        await removeFavourite(tx, req.auth as AuthContext, req.params.taskId);
        return { ok: true };
      }),
  );

  app.get(
    "/timesheet/week/:weekStart/previous-rows",
    { schema: { params: z.object({ weekStart: monday }) } },
    async (req) =>
      req.withTenant((tx) => previousWeekRows(tx, req.auth as AuthContext, req.params.weekStart)),
  );
};
