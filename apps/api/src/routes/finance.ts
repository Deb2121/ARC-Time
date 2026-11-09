/**
 * Accounting periods, month-end report, price lists and payment plans (brief §4.9, §4.11).
 */
import {
  closeChecklist,
  closeMonth,
  ensurePeriods,
  monthEndReport,
  reopenMonth,
  schema,
  writeAudit,
} from "@arc-tid/db";
import { hasRole, kr, todayCopenhagen } from "@arc-tid/domain";
import { asc, eq, inArray } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { type AuthContext, requireCapability } from "../auth/plugin.ts";
import { AppError } from "../services/errors.ts";
import { canEditProject } from "../services/projects.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const monthParam = z.string().regex(/^\d{4}-\d{2}-01$/);

/** Registers accounting-period, month-end report, price-list and payment-plan endpoints. */
export const financeRoutes: FastifyPluginAsyncZod = async (app) => {
  /* ───────── accounting periods ───────── */

  app.get("/periods", async (req) => {
    const auth = requireCapability(req, "period.view");
    return req.withTenant(async (tx) => {
      const [entity] = await tx.select().from(schema.legalEntities).limit(1);
      const [tenant] = await tx.select().from(schema.tenants).where(eq(schema.tenants.id, auth.tenantId));
      if (entity && tenant)
        await ensurePeriods(tx, auth.tenantId, entity.id, tenant.goLiveDate, todayCopenhagen());
      const periods = await tx
        .select()
        .from(schema.accountingPeriods)
        .orderBy(asc(schema.accountingPeriods.month));
      const out = [];
      for (const p of periods)
        out.push({ ...p, checklist: p.status === "open" ? await closeChecklist(tx, p.month) : [] });
      return out;
    });
  });

  app.get("/periods/:month/report", { schema: { params: z.object({ month: monthParam }) } }, async (req) => {
    requireCapability(req, "period.view");
    return req.withTenant((tx) => monthEndReport(tx, req.params.month));
  });

  app.post(
    "/periods/:id/close",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ acknowledge: z.boolean().default(false) }),
      },
    },
    async (req) => {
      const auth = requireCapability(req, "period.close");
      return req.withTenant((tx) =>
        closeMonth(tx, auth.tenantId, auth.userId, req.params.id, req.body.acknowledge),
      );
    },
  );

  app.post(
    "/periods/:id/reopen",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ reason: z.string().trim().min(1).max(500) }),
      },
    },
    async (req) => {
      const auth = requireCapability(req, "period.close");
      return req.withTenant(async (tx) => {
        await reopenMonth(tx, auth.tenantId, auth.userId, req.params.id, req.body.reason);
        return { status: "open" };
      });
    },
  );

  /* ───────── price lists ───────── */

  app.get("/price-lists", async (req) => {
    const auth = req.auth as AuthContext;
    if (!hasRole(auth.roles, "finance", "admin", "management", "project_manager"))
      throw new AppError(403, "forbidden");
    return req.withTenant(async (tx) => {
      const lists = await tx
        .select({
          id: schema.priceLists.id,
          name: schema.priceLists.name,
          isStandard: schema.priceLists.isStandard,
          customerId: schema.priceLists.customerId,
          customerName: schema.customers.name,
        })
        .from(schema.priceLists)
        .leftJoin(schema.customers, eq(schema.customers.id, schema.priceLists.customerId))
        .orderBy(asc(schema.priceLists.name));
      const rates = lists.length
        ? await tx
            .select()
            .from(schema.priceListRates)
            .where(
              inArray(
                schema.priceListRates.priceListId,
                lists.map((l) => l.id),
              ),
            )
        : [];
      const groups = await tx.select().from(schema.priceGroups).orderBy(asc(schema.priceGroups.sort));
      const taskTypes = await tx.select().from(schema.taskTypes).orderBy(asc(schema.taskTypes.name));
      return {
        lists: lists
          .sort((a, b) => Number(b.isStandard) - Number(a.isStandard))
          .map((l) => ({
            ...l,
            rates: rates
              .filter((r) => r.priceListId === l.id)
              .sort((a, b) => a.validFrom.localeCompare(b.validFrom)),
          })),
        groups,
        taskTypes,
        canEdit: hasRole(auth.roles, "finance", "admin"),
      };
    });
  });

  app.post(
    "/price-lists/:id/rates",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          priceGroupId: z.string().uuid().nullable(),
          taskTypeId: z.string().uuid().nullable(),
          /** kr per hour */
          rate: z.number().positive().max(100_000),
          validFrom: isoDate,
        }),
      },
    },
    async (req) => {
      const auth = requireCapability(req, "pricelist.manage");
      return req.withTenant(async (tx) => {
        const [row] = await tx
          .insert(schema.priceListRates)
          .values({
            tenantId: auth.tenantId,
            priceListId: req.params.id,
            ...req.body,
            rate: kr(req.body.rate),
          })
          .returning();
        await writeAudit(tx, {
          tenantId: auth.tenantId,
          entity: "price_list_rate",
          entityId: row?.id ?? "",
          action: "create",
          userId: auth.userId,
          after: row,
        });
        return row;
      });
    },
  );

  app.delete(
    "/price-list-rates/:id",
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const auth = requireCapability(req, "pricelist.manage");
      return req.withTenant(async (tx) => {
        const [before] = await tx
          .delete(schema.priceListRates)
          .where(eq(schema.priceListRates.id, req.params.id))
          .returning();
        await writeAudit(tx, {
          tenantId: auth.tenantId,
          entity: "price_list_rate",
          entityId: req.params.id,
          action: "delete",
          userId: auth.userId,
          before,
        });
        return { ok: true };
      });
    },
  );

  /* ───────── payment plans ───────── */

  app.get(
    "/projects/:id/payment-plan",
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) =>
      req.withTenant(async (tx) => {
        const contracts = await tx
          .select()
          .from(schema.contracts)
          .where(eq(schema.contracts.projectId, req.params.id));
        if (!contracts.length) return [];
        return tx
          .select()
          .from(schema.paymentPlanItems)
          .where(
            inArray(
              schema.paymentPlanItems.contractId,
              contracts.map((c) => c.id),
            ),
          )
          .orderBy(asc(schema.paymentPlanItems.dueDate));
      }),
  );

  app.post(
    "/contracts/:id/plan-items",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          description: z.string().trim().min(1).max(300),
          dueDate: isoDate,
          amount: z.number().positive(),
        }),
      },
    },
    async (req) => {
      const auth = req.auth as AuthContext;
      return req.withTenant(async (tx) => {
        const [c] = await tx.select().from(schema.contracts).where(eq(schema.contracts.id, req.params.id));
        if (!c) throw new AppError(404, "not_found");
        if (!(await canEditProject(tx, auth, c.projectId))) throw new AppError(403, "forbidden");
        if (c.type === "time_material") throw new AppError(422, "plan_only_for_fixed_price_or_retainer");
        const [row] = await tx
          .insert(schema.paymentPlanItems)
          .values({
            tenantId: auth.tenantId,
            contractId: c.id,
            description: req.body.description,
            dueDate: req.body.dueDate,
            amount: kr(req.body.amount),
          })
          .returning();
        await writeAudit(tx, {
          tenantId: auth.tenantId,
          entity: "payment_plan_item",
          entityId: row?.id ?? "",
          action: "create",
          userId: auth.userId,
          after: row,
        });
        return row;
      });
    },
  );

  app.patch(
    "/plan-items/:id",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          description: z.string().trim().min(1).max(300).optional(),
          dueDate: isoDate.optional(),
          amount: z.number().positive().optional(),
          status: z.enum(["planned", "ready"]).optional(),
        }),
      },
    },
    async (req) => {
      const auth = req.auth as AuthContext;
      return req.withTenant(async (tx) => {
        const [item] = await tx
          .select()
          .from(schema.paymentPlanItems)
          .where(eq(schema.paymentPlanItems.id, req.params.id));
        if (!item) throw new AppError(404, "not_found");
        const [c] = await tx.select().from(schema.contracts).where(eq(schema.contracts.id, item.contractId));
        if (!c || !(await canEditProject(tx, auth, c.projectId))) throw new AppError(403, "forbidden");
        if (item.status === "invoiced" || item.invoiceLineId) throw new AppError(409, "plan_item_invoiced");
        const { amount, ...rest } = req.body;
        const [after] = await tx
          .update(schema.paymentPlanItems)
          .set({ ...rest, ...(amount !== undefined ? { amount: kr(amount) } : {}) })
          .where(eq(schema.paymentPlanItems.id, item.id))
          .returning();
        await writeAudit(tx, {
          tenantId: auth.tenantId,
          entity: "payment_plan_item",
          entityId: item.id,
          action: "update",
          userId: auth.userId,
          before: item,
          after,
        });
        return after;
      });
    },
  );
};
