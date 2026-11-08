/**
 * Invoicing routes (brief §4.10, docs/spec/invoicing.md). Finance creates, edits, books and credits.
 * Project managers may prepare drafts for their own projects and mark them "ready for booking"; only Finance books.
 */
import {
  addFreeLine,
  bookInvoice,
  createCreditNote,
  createDraftFromSuggestion,
  deleteDraft,
  deleteLine,
  InvoiceError,
  loadInvoice,
  recalcInvoice,
  schema,
  type Tx,
  updateLine,
  writeAudit,
} from "@arc-tid/db";
import { hasRole, invoiceTotals, todayCopenhagen } from "@arc-tid/domain";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { type AuthContext, HttpError, requireRole } from "../auth/plugin.ts";
import { htmlToPdf, invoiceHtml } from "../services/invoice-document.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const grouping = z.enum(["task", "employee", "task_employee", "summary"]).default("task");

/** Finance sees all invoicing; a project manager only invoices on projects they manage. */
async function assertCanInvoice(tx: Tx, auth: AuthContext, projectIds: string[]) {
  if (hasRole(auth.roles, "finance", "admin")) return;
  if (!hasRole(auth.roles, "project_manager")) throw new HttpError(403, "forbidden");
  const rows = await tx
    .select({ managerId: schema.projects.managerId })
    .from(schema.projects)
    .where(inArray(schema.projects.id, projectIds));
  if (!rows.length || rows.some((r) => r.managerId !== auth.userId)) throw new HttpError(403, "forbidden");
}

async function assertCanSeeInvoice(tx: Tx, auth: AuthContext, invoiceId: string) {
  const inv = await loadInvoice(tx, invoiceId);
  if (hasRole(auth.roles, "finance", "admin", "management")) return inv;
  if (hasRole(auth.roles, "project_manager") && inv.projectId) {
    const [p] = await tx
      .select({ managerId: schema.projects.managerId })
      .from(schema.projects)
      .where(eq(schema.projects.id, inv.projectId));
    if (p?.managerId === auth.userId) return inv;
  }
  throw new HttpError(404, "not_found");
}

export const invoicingRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Invoicing basis: per project, everything invoiceable up to a date (approved T&M hours + due milestones/fees). */
  app.get(
    "/invoicing/basis",
    { schema: { querystring: z.object({ upTo: isoDate.optional() }) } },
    async (req) => {
      const auth = req.auth as AuthContext;
      if (!hasRole(auth.roles, "finance", "admin", "project_manager")) throw new HttpError(403, "forbidden");
      const upTo = req.query.upTo ?? todayCopenhagen();
      return req.withTenant(async (tx) => {
        const onlyOwn = !hasRole(auth.roles, "finance", "admin");
        const rows = await tx.execute<{
          project_id: string;
          number: string;
          name: string;
          customer_id: string;
          customer_name: string;
          manager_initials: string | null;
          hours: string;
          value: string;
          oldest: string | null;
          milestones: string;
          milestone_count: number;
        }>(sql`
        select p.id as project_id, p.number, p.name, c.id as customer_id, c.name as customer_name, u.initials as manager_initials,
          coalesce(t.hours, 0) as hours, coalesce(t.value, 0) as value, t.oldest,
          coalesce(m.amount, 0) as milestones, coalesce(m.n, 0)::int as milestone_count
        from projects p
        join customers c on c.id = p.customer_id
        left join users u on u.id = p.manager_id
        left join lateral (
          select sum(e.hours) as hours, round(sum(e.hours * coalesce(e.sales_rate, 0))) as value, min(e.date) as oldest
          from time_entries e join tasks tk on tk.id = e.task_id join contracts k on k.id = tk.contract_id
          where e.project_id = p.id and e.status = 'approved' and e.billable and e.invoice_line_id is null
            and e.date <= ${upTo} and k.type = 'time_material'
        ) t on true
        left join lateral (
          select sum(pi.amount) as amount, count(*) as n from payment_plan_items pi join contracts k on k.id = pi.contract_id
          where k.project_id = p.id and pi.invoice_line_id is null
            and (pi.status = 'ready' or (pi.status = 'planned' and pi.due_date <= ${upTo}))
        ) m on true
        where (coalesce(t.hours, 0) > 0 or coalesce(m.n, 0) > 0)
          ${onlyOwn ? sql`and p.manager_id = ${auth.userId}` : sql``}
        order by c.name, p.number`);
        return rows.map((r) => ({
          projectId: r.project_id,
          number: r.number,
          name: r.name,
          customerId: r.customer_id,
          customerName: r.customer_name,
          managerInitials: r.manager_initials,
          hours: Number(r.hours),
          value: Number(r.value),
          oldest: r.oldest,
          milestones: Number(r.milestones),
          milestoneCount: r.milestone_count,
          total: Number(r.value) + Number(r.milestones),
        }));
      });
    },
  );

  app.post(
    "/invoices/drafts",
    {
      schema: {
        body: z.object({
          customerId: z.string().uuid(),
          projectIds: z.array(z.string().uuid()).min(1),
          upTo: isoDate,
          invoiceDate: isoDate,
          grouping,
        }),
      },
    },
    async (req) => {
      const auth = req.auth as AuthContext;
      return req.withTenant(async (tx) => {
        await assertCanInvoice(tx, auth, req.body.projectIds);
        const id = await createDraftFromSuggestion(tx, {
          tenantId: auth.tenantId,
          userId: auth.userId,
          ...req.body,
        });
        if (!id) throw new HttpError(422, "nothing_to_invoice");
        return { id };
      });
    },
  );

  /** One-click bulk invoicing: a draft per project with invoiceable content. */
  app.post(
    "/invoices/bulk-drafts",
    { schema: { body: z.object({ upTo: isoDate, invoiceDate: isoDate, grouping }) } },
    async (req) => {
      const auth = requireRole(req, "finance", "admin");
      return req.withTenant(async (tx) => {
        const projects = await tx
          .select({ id: schema.projects.id, customerId: schema.projects.customerId })
          .from(schema.projects)
          .where(and(sql`${schema.projects.customerId} is not null`, eq(schema.projects.status, "active")))
          .orderBy(asc(schema.projects.number));
        const created: string[] = [];
        for (const p of projects) {
          const id = await createDraftFromSuggestion(tx, {
            tenantId: auth.tenantId,
            userId: auth.userId,
            customerId: p.customerId ?? "",
            projectIds: [p.id],
            upTo: req.body.upTo,
            invoiceDate: req.body.invoiceDate,
            grouping: req.body.grouping,
          });
          if (id) created.push(id);
        }
        return { created };
      });
    },
  );

  app.get(
    "/invoices",
    {
      schema: { querystring: z.object({ status: z.enum(["draft", "ready", "booked", "open"]).optional() }) },
    },
    async (req) => {
      const auth = req.auth as AuthContext;
      if (!hasRole(auth.roles, "finance", "admin", "management", "project_manager"))
        throw new HttpError(403, "forbidden");
      return req.withTenant(async (tx) => {
        const st = req.query.status;
        return tx
          .select({
            id: schema.invoices.id,
            number: schema.invoices.number,
            type: schema.invoices.type,
            status: schema.invoices.status,
            invoiceDate: schema.invoices.invoiceDate,
            dueDate: schema.invoices.dueDate,
            heading: schema.invoices.heading,
            total: schema.invoices.total,
            subtotal: schema.invoices.subtotal,
            currency: schema.invoices.currency,
            customerName: schema.customers.name,
            projectNumber: schema.projects.number,
          })
          .from(schema.invoices)
          .innerJoin(schema.customers, eq(schema.customers.id, schema.invoices.customerId))
          .leftJoin(schema.projects, eq(schema.projects.id, schema.invoices.projectId))
          .where(
            and(
              st === "open"
                ? sql`${schema.invoices.status} <> 'booked'`
                : st
                  ? eq(schema.invoices.status, st)
                  : undefined,
              hasRole(auth.roles, "finance", "admin", "management")
                ? undefined
                : eq(schema.projects.managerId, auth.userId),
            ),
          )
          .orderBy(
            desc(sql`coalesce(${schema.invoices.number}, 2147483647)`),
            desc(schema.invoices.createdAt),
          );
      });
    },
  );

  app.get("/invoices/:id", { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const auth = req.auth as AuthContext;
    return req.withTenant(async (tx) => {
      const inv = await assertCanSeeInvoice(tx, auth, req.params.id);
      const [customer] = await tx
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, inv.customerId));
      const lines = await tx
        .select()
        .from(schema.invoiceLines)
        .where(eq(schema.invoiceLines.invoiceId, inv.id))
        .orderBy(asc(schema.invoiceLines.sort));
      const sourceCounts = lines.length
        ? await tx
            .select({
              lineId: schema.invoiceLineSources.invoiceLineId,
              n: sql<number>`count(*)::int`,
              value: sql<number>`sum(${schema.invoiceLineSources.value})::bigint`,
            })
            .from(schema.invoiceLineSources)
            .where(
              inArray(
                schema.invoiceLineSources.invoiceLineId,
                lines.map((l) => l.id),
              ),
            )
            .groupBy(schema.invoiceLineSources.invoiceLineId)
        : [];
      const credits = await tx
        .select({
          id: schema.invoices.id,
          number: schema.invoices.number,
          status: schema.invoices.status,
          total: schema.invoices.total,
        })
        .from(schema.invoices)
        .where(eq(schema.invoices.creditOfId, inv.id));
      return {
        ...inv,
        customer: customer
          ? {
              id: customer.id,
              name: customer.name,
              number: customer.number,
              address: customer.address,
              postalCode: customer.postalCode,
              city: customer.city,
              ean: customer.ean,
            }
          : null,
        lines: lines.map((l) => ({ ...l, sourceCount: sourceCounts.find((c) => c.lineId === l.id)?.n ?? 0 })),
        totals: invoiceTotals(
          lines
            .filter((l) => ["time", "milestone", "product"].includes(l.kind))
            .map((l) => ({ amount: l.amount, vatBp: l.vatBp })),
        ),
        credits,
        canBook: hasRole(auth.roles, "finance", "admin") && inv.status !== "booked",
      };
    });
  });

  app.patch(
    "/invoices/:id",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          heading: z.string().max(300).optional(),
          invoiceDate: isoDate.optional(),
          dueDate: isoDate.optional(),
          ourReference: z.string().max(200).nullish(),
          theirReference: z.string().max(200).nullish(),
          attachSpecification: z.boolean().optional(),
        }),
      },
    },
    async (req) => {
      const auth = req.auth as AuthContext;
      return req.withTenant(async (tx) => {
        const inv = await assertCanSeeInvoice(tx, auth, req.params.id);
        if (inv.status === "booked") throw new InvoiceError("invoice_booked");
        await tx
          .update(schema.invoices)
          .set({ ...req.body, updatedAt: new Date() })
          .where(eq(schema.invoices.id, inv.id));
        await writeAudit(tx, {
          tenantId: auth.tenantId,
          entity: "invoice",
          entityId: inv.id,
          action: "update",
          userId: auth.userId,
          before: inv,
          after: req.body,
        });
        return { ok: true };
      });
    },
  );

  app.patch(
    "/invoice-lines/:id",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          description: z.string().max(500).optional(),
          quantity: z.number().optional(),
          /** kr */
          unitPrice: z.number().optional(),
          /** kr; explicit new line amount = write-down/up */
          amount: z.number().optional(),
          discountPct: z.number().min(0).max(100).optional(),
          vatPct: z.number().min(0).max(100).optional(),
          writeReason: z.string().max(500).nullish(),
        }),
      },
    },
    async (req) => {
      const auth = req.auth as AuthContext;
      const b = req.body;
      return req.withTenant(async (tx) => {
        const [line] = await tx
          .select({ invoiceId: schema.invoiceLines.invoiceId })
          .from(schema.invoiceLines)
          .where(eq(schema.invoiceLines.id, req.params.id));
        if (!line) throw new HttpError(404, "not_found");
        await assertCanSeeInvoice(tx, auth, line.invoiceId);
        await updateLine(tx, auth.tenantId, auth.userId, req.params.id, {
          description: b.description,
          quantity: b.quantity,
          unitPrice: b.unitPrice !== undefined ? Math.round(b.unitPrice * 100) : undefined,
          amount: b.amount !== undefined ? Math.round(b.amount * 100) : undefined,
          discountBp: b.discountPct !== undefined ? Math.round(b.discountPct * 100) : undefined,
          vatBp: b.vatPct !== undefined ? Math.round(b.vatPct * 100) : undefined,
          writeReason: b.writeReason,
        });
        return { ok: true };
      });
    },
  );

  app.post(
    "/invoices/:id/lines",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          kind: z.enum(["product", "text", "heading", "subtotal"]),
          description: z.string().max(500),
          quantity: z.number().optional(),
          /** kr */
          unitPrice: z.number().optional(),
        }),
      },
    },
    async (req) => {
      const auth = req.auth as AuthContext;
      return req.withTenant(async (tx) => {
        await assertCanSeeInvoice(tx, auth, req.params.id);
        const b = req.body;
        await addFreeLine(tx, auth.tenantId, req.params.id, {
          ...b,
          unitPrice: b.unitPrice !== undefined ? Math.round(b.unitPrice * 100) : undefined,
        });
        return { ok: true };
      });
    },
  );

  app.delete(
    "/invoice-lines/:id",
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const auth = req.auth as AuthContext;
      return req.withTenant(async (tx) => {
        const [line] = await tx
          .select({ invoiceId: schema.invoiceLines.invoiceId })
          .from(schema.invoiceLines)
          .where(eq(schema.invoiceLines.id, req.params.id));
        if (!line) throw new HttpError(404, "not_found");
        await assertCanSeeInvoice(tx, auth, line.invoiceId);
        await deleteLine(tx, req.params.id);
        return { ok: true };
      });
    },
  );

  app.delete("/invoices/:id", { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const auth = req.auth as AuthContext;
    return req.withTenant(async (tx) => {
      await assertCanSeeInvoice(tx, auth, req.params.id);
      await deleteDraft(tx, auth.tenantId, auth.userId, req.params.id);
      return { ok: true };
    });
  });

  app.post(
    "/invoices/:id/ready",
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const auth = req.auth as AuthContext;
      return req.withTenant(async (tx) => {
        const inv = await assertCanSeeInvoice(tx, auth, req.params.id);
        if (inv.status !== "draft") throw new InvoiceError("not_draft");
        await recalcInvoice(tx, inv.id);
        await tx
          .update(schema.invoices)
          .set({ status: "ready", updatedAt: new Date() })
          .where(eq(schema.invoices.id, inv.id));
        await writeAudit(tx, {
          tenantId: auth.tenantId,
          entity: "invoice",
          entityId: inv.id,
          action: "ready",
          userId: auth.userId,
        });
        return { status: "ready" };
      });
    },
  );

  app.post("/invoices/:id/book", { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const auth = requireRole(req, "finance", "admin");
    return req.withTenant(async (tx) => ({
      number: await bookInvoice(tx, auth.tenantId, auth.userId, req.params.id),
    }));
  });

  app.post(
    "/invoices/:id/credit",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          lineIds: z.array(z.string().uuid()).optional(),
          reopenSources: z.boolean().default(false),
          invoiceDate: isoDate.optional(),
        }),
      },
    },
    async (req) => {
      const auth = requireRole(req, "finance", "admin");
      return req.withTenant(async (tx) => ({
        id: await createCreditNote(tx, auth.tenantId, auth.userId, req.params.id, {
          lineIds: req.body.lineIds,
          reopenSources: req.body.reopenSources,
          invoiceDate: req.body.invoiceDate ?? todayCopenhagen(),
        }),
      }));
    },
  );

  app.get(
    "/invoices/:id/html",
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req, reply) => {
      const auth = req.auth as AuthContext;
      const html = await req.withTenant(async (tx) => {
        await assertCanSeeInvoice(tx, auth, req.params.id);
        return invoiceHtml(tx, req.params.id);
      });
      return reply
        .header("content-type", "text/html; charset=utf-8")
        .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'")
        .send(html);
    },
  );

  app.get(
    "/invoices/:id/pdf",
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req, reply) => {
      const auth = req.auth as AuthContext;
      const { html, name } = await req.withTenant(async (tx) => {
        const inv = await assertCanSeeInvoice(tx, auth, req.params.id);
        return {
          html: await invoiceHtml(tx, req.params.id),
          name: `${inv.type === "credit" ? "kreditnota" : "faktura"}-${inv.number ?? "kladde"}.pdf`,
        };
      });
      const pdf = await htmlToPdf(html);
      return reply
        .header("content-type", "application/pdf")
        .header("content-disposition", `inline; filename="${name}"`)
        .send(pdf);
    },
  );
};
