/**
 * Resource planner routes (brief §4.8) — GRASP Controller: validate input, delegate to `services/planning.ts`.
 *
 *   GET /planning?from=YYYY-MM-DD&weeks=8[&competence]   capacity heatmap with allocations
 *   PUT /planning/allocations                            set planned hours (0 removes)
 *   GET /planning/competencies                           competency names for filtering
 *   PUT /users/:id/competencies                          replace an employee's competencies
 */
import { isoWeekday } from "@arc-tid/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthContext } from "../auth/plugin.ts";
import { allCompetencies, plannerView, setAllocation, setCompetencies } from "../services/planning.ts";

const monday = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => isoWeekday(d) === 1, "must be a Monday");

/** Registers the resource planner endpoints under /api/v1. */
export const planningRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/planning",
    {
      schema: {
        querystring: z.object({
          from: monday,
          weeks: z.coerce.number().int().min(1).max(26).default(8),
          competence: z.string().max(100).optional(),
        }),
      },
    },
    async (req) =>
      req.withTenant((tx) =>
        plannerView(tx, req.auth as AuthContext, req.query.from, req.query.weeks, req.query.competence),
      ),
  );

  app.put(
    "/planning/allocations",
    {
      schema: {
        body: z.object({
          userId: z.string().uuid(),
          projectId: z.string().uuid(),
          weekStart: monday,
          hours: z.number().min(0).max(80).multipleOf(0.25),
        }),
      },
    },
    async (req) => req.withTenant((tx) => setAllocation(tx, req.auth as AuthContext, req.body)),
  );

  app.get("/planning/competencies", async (req) => req.withTenant((tx) => allCompetencies(tx)));

  app.put(
    "/users/:id/competencies",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ names: z.array(z.string().max(60)).max(30) }),
      },
    },
    async (req) =>
      req.withTenant((tx) => setCompetencies(tx, req.auth as AuthContext, req.params.id, req.body.names)),
  );
};
