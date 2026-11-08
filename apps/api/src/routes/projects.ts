/**
 * Projects, tasks (WBS ≤ 5 levels), customers. docs/spec/projects.md, crm.md.
 */
import { schema, writeAudit } from "@arc-tid/db";
import { hasRole, kr } from "@arc-tid/domain";
import { and, asc, eq, like, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { type AuthContext, HttpError, requireRole } from "../auth/plugin.ts";
import { canEditProject, projectDetail, projectSummaries, visibleProjectIds } from "../services/projects.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const projectRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/projects", async (req) => {
    const auth = req.auth as AuthContext;
    return req.withTenant(async (tx) => projectSummaries(tx, await visibleProjectIds(tx, auth)));
  });

  app.get("/projects/:id", { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const auth = req.auth as AuthContext;
    return req.withTenant(async (tx) => {
      const visible = await visibleProjectIds(tx, auth);
      if (visible !== "all" && !visible.includes(req.params.id)) throw new HttpError(404, "not_found");
      const detail = await projectDetail(tx, req.params.id);
      if (!detail) throw new HttpError(404, "not_found");
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
      const auth = requireRole(req, "admin", "finance", "project_manager");
      const b = req.body;
      return req.withTenant(async (tx) => {
        const [entity] = await tx.select().from(schema.legalEntities).limit(1);
        if (!entity) throw new HttpError(400, "no_legal_entity");
        // Project number: two-digit year + three-digit sequence (projects spec), e.g. 26011.
        const yy = new Date().getFullYear().toString().slice(2);
        const [last] = await tx
          .select({ number: schema.projects.number })
          .from(schema.projects)
          .where(
            and(like(schema.projects.number, `${yy}___`), sql`${schema.projects.number} < ${`${yy}900`}`),
          )
          .orderBy(sql`${schema.projects.number} desc`)
          .limit(1);
        const number = last ? String(Number(last.number) + 1) : `${yy}001`;
        const [project] = await tx
          .insert(schema.projects)
          .values({
            tenantId: auth.tenantId,
            number,
            name: b.name,
            customerId: b.customerId,
            legalEntityId: entity.id,
            managerId: b.managerId,
            status: "active",
            startDate: b.startDate,
            endDate: b.endDate,
            billable: b.billable,
            commentRequired: b.commentRequired,
            category: b.category,
          })
          .returning();
        if (!project) throw new HttpError(500, "create_failed");
        await tx.insert(schema.contracts).values({
          tenantId: auth.tenantId,
          projectId: project.id,
          name: { time_material: "Regning", fixed_price: "Fastpris", retainer: "Rammeaftale" }[
            b.contractType
          ],
          type: b.contractType,
          price: b.price !== undefined ? kr(b.price) : null,
          hourlyRate: b.hourlyRate !== undefined ? kr(b.hourlyRate) : null,
        });
        await tx
          .insert(schema.projectMembers)
          .values({ tenantId: auth.tenantId, projectId: project.id, userId: b.managerId })
          .onConflictDoNothing();
        await writeAudit(tx, {
          tenantId: auth.tenantId,
          entity: "project",
          entityId: project.id,
          action: "create",
          userId: auth.userId,
          after: project,
        });
        return project;
      });
    },
  );

  app.post(
    "/projects/:id/tasks",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
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
    async (req) => {
      const auth = req.auth as AuthContext;
      const b = req.body;
      return req.withTenant(async (tx) => {
        if (!(await canEditProject(tx, auth, req.params.id))) throw new HttpError(403, "forbidden");
        const [project] = await tx
          .select()
          .from(schema.projects)
          .where(eq(schema.projects.id, req.params.id));
        if (!project) throw new HttpError(404, "not_found");
        let level = 1;
        let prefix = "";
        let contractId: string | null = null;
        if (b.parentId) {
          const [parent] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, b.parentId));
          if (!parent || parent.projectId !== project.id) throw new HttpError(400, "invalid_parent");
          if (parent.level >= 5) throw new HttpError(422, "wbs_max_depth"); // WBS up to 5 levels [Brief]
          const [hasEntries] = await tx
            .select({ id: schema.timeEntries.id })
            .from(schema.timeEntries)
            .where(eq(schema.timeEntries.taskId, parent.id))
            .limit(1);
          if (hasEntries) throw new HttpError(422, "parent_has_time"); // time lives on leaf tasks only
          level = parent.level + 1;
          prefix = `${parent.wbs}.`;
          contractId = parent.contractId;
        } else {
          const [c] = await tx
            .select()
            .from(schema.contracts)
            .where(eq(schema.contracts.projectId, project.id))
            .limit(1);
          contractId = c?.id ?? null;
        }
        const siblings = await tx
          .select({ id: schema.tasks.id })
          .from(schema.tasks)
          .where(
            and(
              eq(schema.tasks.projectId, project.id),
              b.parentId ? eq(schema.tasks.parentId, b.parentId) : sql`${schema.tasks.parentId} is null`,
            ),
          );
        const [task] = await tx
          .insert(schema.tasks)
          .values({
            tenantId: auth.tenantId,
            projectId: project.id,
            contractId,
            parentId: b.parentId,
            level,
            wbs: `${prefix}${siblings.length + 1}`,
            name: b.name,
            billable: b.billable ?? project.billable,
            budgetHours: b.budgetHours,
            budgetAmount: kr(b.budgetAmount),
            sort: siblings.length,
          })
          .returning();
        await writeAudit(tx, {
          tenantId: auth.tenantId,
          entity: "task",
          entityId: task?.id ?? "",
          action: "create",
          userId: auth.userId,
          after: task,
        });
        return task;
      });
    },
  );

  app.patch(
    "/tasks/:id",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          name: z.string().trim().min(1).max(200).optional(),
          budgetHours: z.number().min(0).max(9999).optional(),
          budgetAmount: z.number().min(0).optional(),
          status: z.enum(["open", "closed"]).optional(),
          billable: z.boolean().optional(),
        }),
      },
    },
    async (req) => {
      const auth = req.auth as AuthContext;
      return req.withTenant(async (tx) => {
        const [task] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, req.params.id));
        if (!task) throw new HttpError(404, "not_found");
        if (!(await canEditProject(tx, auth, task.projectId))) throw new HttpError(403, "forbidden");
        const { budgetAmount, ...rest } = req.body;
        const [after] = await tx
          .update(schema.tasks)
          .set({ ...rest, ...(budgetAmount !== undefined ? { budgetAmount: kr(budgetAmount) } : {}) })
          .where(eq(schema.tasks.id, task.id))
          .returning();
        await writeAudit(tx, {
          tenantId: auth.tenantId,
          entity: "task",
          entityId: task.id,
          action: "update",
          userId: auth.userId,
          before: task,
          after,
        });
        return after;
      });
    },
  );

  app.get("/customers", async (req) =>
    req.withTenant((tx) =>
      tx
        .select({
          id: schema.customers.id,
          number: schema.customers.number,
          name: schema.customers.name,
          cvr: schema.customers.cvr,
          ean: schema.customers.ean,
          city: schema.customers.city,
          paymentTermsDays: schema.customers.paymentTermsDays,
          active: schema.customers.active,
          projectCount: sql<number>`(select count(*)::int from projects p where p.customer_id = ${schema.customers.id})`,
        })
        .from(schema.customers)
        .orderBy(asc(schema.customers.name)),
    ),
  );

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
      if (!hasRole(auth.roles, "admin", "finance", "project_manager")) throw new HttpError(403, "forbidden");
      return req.withTenant(async (tx) => {
        const [last] = await tx
          .select({ number: schema.customers.number })
          .from(schema.customers)
          .orderBy(sql`${schema.customers.number}::int desc`)
          .limit(1);
        const [row] = await tx
          .insert(schema.customers)
          .values({
            tenantId: auth.tenantId,
            number: String(Number(last?.number ?? "1000") + 1),
            ...req.body,
          })
          .returning();
        await writeAudit(tx, {
          tenantId: auth.tenantId,
          entity: "customer",
          entityId: row?.id ?? "",
          action: "create",
          userId: auth.userId,
          after: row,
        });
        return row;
      });
    },
  );
};
