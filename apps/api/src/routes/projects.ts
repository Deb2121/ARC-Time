/**
 * Project, task and customer routes (docs/spec/projects.md, crm.md) — GRASP Controller: validate input, check the
 * role, delegate to services (`projects.ts` read models, `project-setup.ts` changes, `customers.ts`).
 *
 *   GET   /projects               projects the caller may see, with budget vs actual
 *   GET   /projects/:id           detail: WBS with rolled-up actuals, contracts, members
 *   POST  /projects               create project (+ first contract)
 *   POST  /projects/:id/tasks     add a task (WBS ≤ 5 levels)
 *   POST  /projects/:id/members   add a person to the team (may then book time)
 *   DELETE /projects/:id/members/:userId  remove a person from the team
 *   PUT   /projects/:id/members/:userId/rate  set or remove the person's own hourly price on the case (D-038)
 *   PATCH /tasks/:id              edit a task
 *   POST  /tasks/:id/phase-status close (done) or reopen a phase and everything under it (D-041)
 *   GET   /projects/:id/completion  what is still open before the case can be completed (D-041)
 *   POST  /projects/:id/status      complete the case (Admin, nothing left) or set it active again (D-041)
 *   GET   /customers              list customers
 *   POST  /customers              create customer
 */
import { hasRole } from "@arc-tid/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { type AuthContext, requireCapability } from "../auth/plugin.ts";
import { completionCheck, setPhaseStatus, setProjectStatus } from "../services/case-lifecycle.ts";
import { createCustomer, listCustomers } from "../services/customers.ts";
import { AppError } from "../services/errors.ts";
import { memberRates, rateChoices, setMemberRate } from "../services/member-rates.ts";
import {
  addProjectMember,
  addTask,
  createProject,
  removeProjectMember,
  updateTask,
} from "../services/project-setup.ts";
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
      const canEdit = await canEditProject(tx, auth, req.params.id);
      if (!canEdit) return { ...detail, canEdit };
      // prices are shown only to those who may change them (manager, Finance, Admin)
      const rates = await memberRates(tx, req.params.id);
      return {
        ...detail,
        canEdit,
        members: detail.members.map((m) => ({ ...m, price: rates.get(m.id) ?? null })),
        rateChoices: await rateChoices(tx, req.params.id),
      };
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
          /** Medgået tid med loft: invoice hours until this many hours, the rest is free */
          maxHours: z.number().positive().max(100_000).optional(),
          startDate: isoDate.optional(),
          endDate: isoDate.optional(),
          /** "Viderefaktureres til kunden"; default: yes when there is a customer */
          billable: z.boolean().optional(),
          category: z.string().max(100).optional(),
        }),
      },
    },
    async (req) => {
      // D-040: only Admin creates cases (not Finance, not project managers — not even with the old right).
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

  app.post(
    "/projects/:id/members",
    { schema: { params: idParams, body: z.object({ userId: z.string().uuid() }) } },
    async (req) =>
      req.withTenant((tx) => addProjectMember(tx, req.auth as AuthContext, req.params.id, req.body.userId)),
  );

  app.delete(
    "/projects/:id/members/:userId",
    { schema: { params: z.object({ id: z.string().uuid(), userId: z.string().uuid() }) } },
    async (req) =>
      req.withTenant((tx) =>
        removeProjectMember(tx, req.auth as AuthContext, req.params.id, req.params.userId),
      ),
  );

  app.put(
    "/projects/:id/members/:userId/rate",
    {
      schema: {
        params: z.object({ id: z.string().uuid(), userId: z.string().uuid() }),
        body: z.object({
          /** kr per hour; null = use the case's own hourly rate */
          rate: z.number().min(0).max(100_000).nullable(),
          /** the price list line it was chosen from; omitted = typed in by hand */
          label: z.string().max(200).nullable().optional(),
        }),
      },
    },
    async (req) =>
      req.withTenant((tx) =>
        setMemberRate(tx, req.auth as AuthContext, req.params.id, req.params.userId, {
          rate: req.body.rate === null ? null : Math.round(req.body.rate * 100),
          label: req.body.label,
        }),
      ),
  );

  app.post(
    "/tasks/:id/phase-status",
    { schema: { params: idParams, body: z.object({ status: z.enum(["open", "closed"]) }) } },
    async (req) =>
      req.withTenant((tx) => setPhaseStatus(tx, req.auth as AuthContext, req.params.id, req.body.status)),
  );

  app.get("/projects/:id/completion", { schema: { params: idParams } }, async (req) => {
    const auth = req.auth as AuthContext;
    return req.withTenant(async (tx) => {
      const visible = await visibleProjectIds(tx, auth);
      if (visible !== "all" && !visible.includes(req.params.id)) throw new AppError(404, "not_found");
      return completionCheck(tx, auth, req.params.id);
    });
  });

  app.post(
    "/projects/:id/status",
    { schema: { params: idParams, body: z.object({ status: z.enum(["completed", "active"]) }) } },
    async (req) =>
      req.withTenant((tx) => setProjectStatus(tx, req.auth as AuthContext, req.params.id, req.body.status)),
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
