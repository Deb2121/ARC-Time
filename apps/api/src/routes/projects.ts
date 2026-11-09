/**
 * Project, task and customer routes (docs/spec/projects.md, crm.md) — GRASP Controller: validate input, check the
 * role, delegate to services (`projects.ts` read models, `project-setup.ts` changes, `customers.ts`).
 *
 *   GET   /projects               projects the caller may see, with budget vs actual
 *   GET   /projects/:id           detail: WBS with rolled-up actuals, contracts, members
 *   POST  /projects               create project (+ first contract)
 *   POST  /projects/:id/tasks     add a task (WBS ≤ 5 levels)
 *   PATCH /tasks/:id              edit a task
 *   GET   /customers              list customers
 *   POST  /customers              create customer
 */
import { hasRole } from "@arc-tid/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { type AuthContext, requireCapability } from "../auth/plugin.ts";
import { createCustomer, listCustomers } from "../services/customers.ts";
import { AppError } from "../services/errors.ts";
import { addTask, createProject, updateTask } from "../services/project-setup.ts";
import { canEditProject, projectDetail, projectSummaries, visibleProjectIds } from "../services/projects.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idParams = z.object({ id: z.string().uuid() });

/** Registers the project, task and customer endpoints under /api/v1. */
export const projectRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/projects", async (req) =>
    req.withTenant(async (tx) => projectSummaries(tx, await visibleProjectIds(tx, req.auth as AuthContext))),
  );

  app.get("/projects/:id", { schema: { params: idParams } }, async (req) => {
    const auth = req.auth as AuthContext;
    return req.withTenant(async (tx) => {
      const visible = await visibleProjectIds(tx, auth);
      if (visible !== "all" && !visible.includes(req.params.id)) throw new AppError(404, "not_found");
      const detail = await projectDetail(tx, req.params.id);
      if (!detail) throw new AppError(404, "not_found");
      return { ...detail, canEdit: await canEditProject(tx, auth, req.params.id) };
    });
  });

  app.post(
    "/projects",
    {
      schema: {
        body: z.object({
          name: z.string().trim().min(2).max(200),
          customerId: z.string().uuid().nullable(),
          managerId: z.string().uuid(),
          contractType: z.enum(["time_material", "fixed_price", "retainer"]),
          /** kr */
          price: z.number().nonnegative().optional(),
          /** kr per hour */
          hourlyRate: z.number().nonnegative().optional(),
          startDate: isoDate.optional(),
          endDate: isoDate.optional(),
          billable: z.boolean().default(true),
          commentRequired: z.boolean().default(false),
          category: z.string().max(100).optional(),
        }),
      },
    },
    async (req) => {
      // "create if right" (D-025): Finance/Admin, or a project manager with the create_projects right.
      const auth = requireCapability(req, "project.create");
      return req.withTenant((tx) => createProject(tx, auth, req.body));
    },
  );

  app.post(
    "/projects/:id/tasks",
    {
      schema: {
        params: idParams,
        body: z.object({
          parentId: z.string().uuid().nullable().default(null),
          name: z.string().trim().min(1).max(200),
          budgetHours: z.number().min(0).max(9999).default(0),
          /** kr */
          budgetAmount: z.number().min(0).default(0),
          billable: z.boolean().optional(),
        }),
      },
    },
    async (req) => req.withTenant((tx) => addTask(tx, req.auth as AuthContext, req.params.id, req.body)),
  );

  app.patch(
    "/tasks/:id",
    {
      schema: {
        params: idParams,
        body: z.object({
          name: z.string().trim().min(1).max(200).optional(),
          budgetHours: z.number().min(0).max(9999).optional(),
          budgetAmount: z.number().min(0).optional(),
          status: z.enum(["open", "closed"]).optional(),
          billable: z.boolean().optional(),
        }),
      },
    },
    async (req) => req.withTenant((tx) => updateTask(tx, req.auth as AuthContext, req.params.id, req.body)),
  );

  app.get("/customers", async (req) => req.withTenant((tx) => listCustomers(tx)));

  app.post(
    "/customers",
    {
      schema: {
        body: z.object({
          name: z.string().trim().min(2).max(200),
          cvr: z
            .string()
            .regex(/^\d{8}$/)
            .optional(),
          ean: z
            .string()
            .regex(/^\d{13}$/)
            .optional(),
          address: z.string().max(200).optional(),
          postalCode: z.string().max(10).optional(),
          city: z.string().max(100).optional(),
          paymentTermsDays: z.number().int().min(0).max(120).default(30),
        }),
      },
    },
    async (req) => {
      const auth = req.auth as AuthContext;
      if (!hasRole(auth.roles, "admin", "finance", "project_manager")) throw new AppError(403, "forbidden");
      return req.withTenant((tx) => createCustomer(tx, auth, req.body));
    },
  );
};
