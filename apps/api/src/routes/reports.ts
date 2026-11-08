/**
 * Report routes (docs/spec/reporting.md) — GRASP Controller: validate filters, delegate to `services/reports.ts`,
 * and choose JSON or CSV download.
 *
 *   GET /me/balances                                   own flex and vacation balance
 *   GET /reports/budget-actual[?format=csv]            budget vs actual per visible project
 *   GET /reports/time-entries?from&to[&userId][&projectId][&format=csv]   time entries
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthContext } from "../auth/plugin.ts";
import {
  budgetActualCsv,
  budgetActualRows,
  myBalances,
  timeEntryCsv,
  timeEntryRows,
} from "../services/reports.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const format = z.enum(["json", "csv"]).default("json");

/** Registers the report endpoints under /api/v1. */
export const reportRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/me/balances", async (req) => req.withTenant((tx) => myBalances(tx, req.auth as AuthContext)));

  app.get("/reports/budget-actual", { schema: { querystring: z.object({ format }) } }, async (req, reply) => {
    const rows = await req.withTenant((tx) => budgetActualRows(tx, req.auth as AuthContext));
    if (req.query.format === "json") return rows;
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="budget-vs-forbrug.csv"')
      .send(budgetActualCsv(rows));
  });

  app.get(
    "/reports/time-entries",
    {
      schema: {
        querystring: z.object({
          from: isoDate,
          to: isoDate,
          userId: z.string().uuid().optional(),
          projectId: z.string().uuid().optional(),
          format,
        }),
      },
    },
    async (req, reply) => {
      const { format: fmt, ...filter } = req.query;
      const rows = await req.withTenant((tx) => timeEntryRows(tx, req.auth as AuthContext, filter));
      if (fmt === "json") return rows;
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="timer-${filter.from}-${filter.to}.csv"`)
        .send(timeEntryCsv(rows));
    },
  );
};
