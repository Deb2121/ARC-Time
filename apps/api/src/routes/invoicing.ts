/**
 * Invoicing routes (brief §4.10, docs/spec/invoicing.md) — GRASP Controller. Input validation and the
 * "only Finance books/credits" rule live here; everything else is delegated to `services/invoices.ts` (access,
 * read models) and `@arc-tid/db` invoicing workflows (drafts, write-downs, booking, credit notes).
 *
 *   GET    /invoicing/basis[?upTo]        what can be invoiced per project
 *   POST   /invoices/drafts               draft for chosen projects of one customer
 *   POST   /invoices/bulk-drafts          one draft per active customer project (Finance)
 *   GET    /invoices[?status]             list
 *   GET    /invoices/:id                  detail for the editor
 *   PATCH  /invoices/:id                  header fields (draft/ready)
 *   PATCH  /invoice-lines/:id             edit line / write-down (reason required)
 *   POST   /invoices/:id/lines            add a free line
 *   DELETE /invoice-lines/:id             remove a line (releases its hours)
 *   DELETE /invoices/:id                  delete a draft (releases its hours)
 *   POST   /invoices/:id/ready            mark ready for booking
 *   POST   /invoices/:id/book             book: next number, immutable (Finance)
 *   POST   /invoices/:id/credit           draft credit note (Finance)
 *   GET    /invoices/:id/html | /pdf      document
 */
import {
  addFreeLine,
  bookInvoice,
  createCreditNote,
  createDraftFromSuggestion,
  deleteDraft,
  deleteLine,
  updateLine,
} from "@arc-tid/db";
import { todayCopenhagen } from "@arc-tid/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { type AuthContext, requireRole } from "../auth/plugin.ts";
import { AppError } from "../services/errors.ts";
import { htmlToPdf, invoiceHtml } from "../services/invoice-document.ts";
import {
  activeCustomerProjects,
  assertCanInvoice,
  assertCanSeeInvoice,
  assertCanSeeLine,
  invoiceDetail,
  invoicingBasis,
  listInvoices,
  markReady,
  updateInvoiceHeader,
} from "../services/invoices.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const grouping = z.enum(["task", "employee", "task_employee", "summary"]).default("task");
const idParams = z.object({ id: z.string().uuid() });
/** kr → øre for optional money fields coming from the UI. */
const toMinor = (kr: number | undefined) => (kr === undefined ? undefined : Math.round(kr * 100));

/** Registers the invoicing endpoints under /api/v1. */
export const invoicingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/invoicing/basis",
    { schema: { querystring: z.object({ upTo: isoDate.optional() }) } },
    async (req) =>
      req.withTenant((tx) =>
        invoicingBasis(tx, req.auth as AuthContext, req.query.upTo ?? todayCopenhagen()),
      ),
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
        if (!id) throw new AppError(422, "nothing_to_invoice");
        return { id };
      });
    },
  );

  app.post(
    "/invoices/bulk-drafts",
    { schema: { body: z.object({ upTo: isoDate, invoiceDate: isoDate, grouping }) } },
    async (req) => {
      const auth = requireRole(req, "finance", "admin");
      return req.withTenant(async (tx) => {
        const created: string[] = [];
        for (const p of await activeCustomerProjects(tx)) {
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
    async (req) => req.withTenant((tx) => listInvoices(tx, req.auth as AuthContext, req.query.status)),
  );

  app.get("/invoices/:id", { schema: { params: idParams } }, async (req) =>
    req.withTenant((tx) => invoiceDetail(tx, req.auth as AuthContext, req.params.id)),
  );

  app.patch(
    "/invoices/:id",
    {
      schema: {
        params: idParams,
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
    async (req) =>
      req.withTenant(async (tx) => {
        await updateInvoiceHeader(tx, req.auth as AuthContext, req.params.id, req.body);
        return { ok: true };
      }),
  );

  app.patch(
    "/invoice-lines/:id",
    {
      schema: {
        params: idParams,
        body: z.object({
          description: z.string().max(500).optional(),
          quantity: z.number().optional(),
          /** kr */
          unitPrice: z.number().optional(),
          /** kr; an explicit new line amount = write-down/up (needs writeReason) */
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
        await assertCanSeeLine(tx, auth, req.params.id);
        await updateLine(tx, auth.tenantId, auth.userId, req.params.id, {
          description: b.description,
          quantity: b.quantity,
          unitPrice: toMinor(b.unitPrice),
          amount: toMinor(b.amount),
          discountBp: toMinor(b.discountPct),
          vatBp: toMinor(b.vatPct),
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
        params: idParams,
        body: z.object({
          kind: z.enum(["product", "text", "heading", "subtotal"]),
          description: z.string().max(500),
          quantity: z.number().optional(),
          unitPrice: z.number().optional(),
        }),
      },
    },
    async (req) => {
      const auth = req.auth as AuthContext;
      return req.withTenant(async (tx) => {
        await assertCanSeeInvoice(tx, auth, req.params.id);
        await addFreeLine(tx, auth.tenantId, req.params.id, {
          ...req.body,
          unitPrice: toMinor(req.body.unitPrice),
        });
        return { ok: true };
      });
    },
  );

  app.delete("/invoice-lines/:id", { schema: { params: idParams } }, async (req) =>
    req.withTenant(async (tx) => {
      await assertCanSeeLine(tx, req.auth as AuthContext, req.params.id);
      await deleteLine(tx, req.params.id);
      return { ok: true };
    }),
  );

  app.delete("/invoices/:id", { schema: { params: idParams } }, async (req) => {
    const auth = req.auth as AuthContext;
    return req.withTenant(async (tx) => {
      await assertCanSeeInvoice(tx, auth, req.params.id);
      await deleteDraft(tx, auth.tenantId, auth.userId, req.params.id);
      return { ok: true };
    });
  });

  app.post("/invoices/:id/ready", { schema: { params: idParams } }, async (req) =>
    req.withTenant((tx) => markReady(tx, req.auth as AuthContext, req.params.id)),
  );

  app.post("/invoices/:id/book", { schema: { params: idParams } }, async (req) => {
    const auth = requireRole(req, "finance", "admin");
    return req.withTenant(async (tx) => ({
      number: await bookInvoice(tx, auth.tenantId, auth.userId, req.params.id),
    }));
  });

  app.post(
    "/invoices/:id/credit",
    {
      schema: {
        params: idParams,
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

  app.get("/invoices/:id/html", { schema: { params: idParams } }, async (req, reply) => {
    const auth = req.auth as AuthContext;
    const html = await req.withTenant(async (tx) => {
      await assertCanSeeInvoice(tx, auth, req.params.id);
      return invoiceHtml(tx, req.params.id);
    });
    return reply
      .header("content-type", "text/html; charset=utf-8")
      .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'")
      .send(html);
  });

  app.get("/invoices/:id/pdf", { schema: { params: idParams } }, async (req, reply) => {
    const auth = req.auth as AuthContext;
    const { html, name } = await req.withTenant(async (tx) => {
      const inv = await assertCanSeeInvoice(tx, auth, req.params.id);
      return {
        html: await invoiceHtml(tx, req.params.id),
        name: `${inv.type === "credit" ? "kreditnota" : "faktura"}-${inv.number ?? "kladde"}.pdf`,
      };
    });
    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `inline; filename="${name}"`)
      .send(await htmlToPdf(html));
  });
};
