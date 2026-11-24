/**
 * Leave accounts (ferie / feriefridage), decision D-037.
 *   GET   /leave/accounts?userId=      the employee's accounts (self, their line manager, Finance/Admin/Management)
 *   POST  /leave/adjustments           manual posting (Finance/Admin)
 *   PATCH /leave/employees/:id         feriefridage per month and opening balance (Finance/Admin)
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthContext } from "../auth/plugin.ts";
import { addLeaveAdjustment, leaveAccounts, setExtraHoliday } from "../services/leave.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Registers the leave endpoints under /api/v1. */
export const leaveRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/leave/accounts",
    { schema: { querystring: z.object({ userId: z.string().uuid().optional() }) } },
    async (req) => {
      const auth = req.auth as AuthContext;
      return req.withTenant((tx) => leaveAccounts(tx, auth, req.query.userId ?? auth.userId));
    },
  );

  app.post(
    "/leave/adjustments",
    {
      schema: {
        body: z.object({
          userId: z.string().uuid(),
          account: z.enum(["ferie", "feriefridag"]),
          date: isoDate,
          days: z
            .number()
            .min(-99)
            .max(99)
            .refine((d) => d !== 0, "days_not_zero"),
          text: z.string().trim().min(1).max(200),
        }),
      },
    },
    async (req) => req.withTenant((tx) => addLeaveAdjustment(tx, req.auth as AuthContext, req.body)),
  );

  app.patch(
    "/leave/employees/:id",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          perMonth: z.number().min(0).max(5).optional(),
          opening: z.number().min(-99).max(99).optional(),
        }),
      },
    },
    async (req) =>
      req.withTenant((tx) => setExtraHoliday(tx, req.auth as AuthContext, req.params.id, req.body)),
  );
};
