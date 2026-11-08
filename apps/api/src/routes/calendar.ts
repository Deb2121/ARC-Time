/**
 * Outlook calendar import routes (docs/spec/integrations.md R6) — GRASP Controller: validate input and delegate to
 * `services/outlook.ts`. The calendar provider is injected (Graph in production, a fake in tests).
 *
 *   GET  /timesheet/calendar/:weekStart    the week's meetings, status disabled | not_connected | connected
 *   POST /timesheet/calendar/import        add picked meetings as draft hours on chosen tasks
 *   POST /timesheet/calendar/ignore        mark a meeting-day as not to be registered
 */
import { isoWeekday } from "@arc-tid/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthContext } from "../auth/plugin.ts";
import {
  type CalendarProvider,
  ignoreCalendarItem,
  importCalendarItems,
  weekCalendar,
} from "../services/outlook.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Registers the calendar import endpoints under /api/v1. */
export const calendarRoutes: FastifyPluginAsyncZod<{ provider: CalendarProvider }> = async (
  app,
  { provider },
) => {
  app.get(
    "/timesheet/calendar/:weekStart",
    {
      schema: {
        params: z.object({ weekStart: isoDate.refine((d) => isoWeekday(d) === 1, "must be a Monday") }),
      },
    },
    async (req) =>
      req.withTenant((tx) => weekCalendar(tx, req.auth as AuthContext, provider, req.params.weekStart)),
  );

  app.post(
    "/timesheet/calendar/import",
    {
      schema: {
        body: z.object({
          items: z
            .array(
              z.object({
                eventId: z.string().min(1).max(500),
                date: isoDate,
                subject: z.string().max(300),
                taskId: z.string().uuid(),
                hours: z.number().positive().max(24),
              }),
            )
            .min(1)
            .max(100),
        }),
      },
    },
    async (req) => req.withTenant((tx) => importCalendarItems(tx, req.auth as AuthContext, req.body.items)),
  );

  app.post(
    "/timesheet/calendar/ignore",
    { schema: { body: z.object({ eventId: z.string().min(1).max(500), date: isoDate }) } },
    async (req) =>
      req.withTenant((tx) =>
        ignoreCalendarItem(tx, req.auth as AuthContext, req.body.eventId, req.body.date),
      ),
  );
};
