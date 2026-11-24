/**
 * Sagsøkonomi and debitorliste routes (docs/spec/case-finance.md, D-029) — GRASP Controller: validate input,
 * check the capability and delegate to services/case-finance.ts and services/receivables.ts.
 *
 *   GET    /case-finance/cases                     Sagsoversigt (rows, cards, options); ?format=xlsx|csv
 *   GET    /case-finance/cases/:id                 case finance detail (phases, employees, plan, invoices)
 *   GET    /case-finance/ready-instalments         "Rater klar til fakturering" across cases
 *   PUT    /case-finance/contracts/:id/plan        save the billing plan (draft, or active at exactly 100 %)
 *   GET    /case-finance/contracts/:id/fee-plan    rate plan generator: input, generated plan, checks (D-039)
 *   PUT    /case-finance/contracts/:id/fee-plan    save the generator's input (amounts in øre)
 *   POST   /case-finance/contracts/:id/fee-plan/apply   write the generated plan as the DRAFT billing plan
 *   GET    /case-finance/contracts/:id/fee-plan/export  ?format=xlsx|csv
 *   GET    /case-finance/cases/:id/subconsultants  sub-consultants' invoices and budget vs registered (D-039)
 *   POST   /case-finance/cases/:id/subconsultants  register a sub-consultant's invoice
 *   PUT    /case-finance/subconsultant-invoices/:id      change one (not when on a customer invoice)
 *   DELETE /case-finance/subconsultant-invoices/:id      remove one (not when on a customer invoice)
 *   POST   /case-finance/plan-items/:id/invoice    "Fakturér rate": invoice draft with the instalment
 *   PATCH  /case-finance/tasks/:id                 ekstraarbejde flag / % complete on a phase
 *   POST   /case-finance/tasks/:id/aconto-invoice  a conto draft (setting must be on)
 *   GET    /case-finance/settings                  thresholds and the a conto switch
 *   PATCH  /case-finance/settings                  change them (Finance)
 *   GET    /receivables                            Debitorliste; ?format=xlsx|csv
 *   GET    /receivables/invoices/:id/payments      payments on an invoice
 *   POST   /receivables/invoices/:id/payments      Registrér betaling (full or partial)
 *   DELETE /receivables/payments/:id               remove a manual payment
 *   POST   /receivables/invoices/:id/reminders     Registrér rykker (1st, 2nd, 3rd)
 *   POST   /receivables/sync                       read payment status from e-conomic
 */
import { todayCopenhagen } from "@arc-tid/domain";
import type { AccountingAdapter } from "@arc-tid/integrations";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthContext } from "../auth/plugin.ts";
import {
  caseFinanceDetail,
  caseFinanceSettings,
  caseOverview,
  caseOverviewExport,
  caseScope,
  invoiceAconto,
  invoiceInstalment,
  readyInstalments,
  saveBillingPlan,
  setCompletion,
  setExtraWork,
  updateCaseFinanceSettings,
} from "../services/case-finance.ts";
import { exportFile } from "../services/export.ts";
import { applyFeePlan, feePlan, feePlanExport, saveFeePlan } from "../services/fee-plan.ts";
import {
  deletePayment,
  invoicePaymentList,
  receivables,
  receivablesExport,
  registerPayment,
  registerReminder,
  syncPayments,
} from "../services/receivables.ts";
import {
  addSubInvoice,
  deleteSubInvoice,
  subconsultantOverview,
  updateSubInvoice,
} from "../services/subconsultants.ts";
import { sendExport } from "./send-export.ts";

const ore = z.number().int().min(0).max(100_000_000_000);
/** The rate plan generator's input (FeePlanInput in @arc-tid/domain), amounts in øre. */
const feePlanInput = z.object({
  phases: z
    .array(
      z.object({
        key: z.string().min(1).max(60),
        name: z.string().trim().min(1).max(200),
        baseFee: ore,
        taskId: z.string().uuid().nullable().optional(),
        start: z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM"),
        weights: z.array(z.number().positive().max(1000)).min(1).max(60),
      }),
    )
    .max(30),
  pools: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        amount: ore,
        phaseKeys: z.array(z.string().min(1).max(60)).max(30),
      }),
    )
    .max(20),
  subs: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        mode: z.enum(["fixed", "share"]),
        total: ore.optional(),
        perPhase: z.record(z.string(), ore).optional(),
      }),
    )
    .max(10),
});
const subInvoiceBody = z.object({
  supplier: z.string().trim().min(1).max(200),
  invoiceNumber: z.string().trim().max(60).nullable().optional(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  /** kr excl. VAT */
  amount: z.number().positive().max(1_000_000_000),
  taskId: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
  rebill: z.boolean().optional(),
  /** percent, e.g. 10 = 10 % */
  markupPct: z.number().min(0).max(100).optional(),
});

const idParams = z.object({ id: z.string().uuid() });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const optionalId = z
  .string()
  .uuid()
  .optional()
  .or(z.literal("").transform(() => undefined));

const caseFilter = z.object({
  feeType: z.enum(["medgaaet_tid", "fast_honorar", ""]).optional(),
  managerId: optionalId,
  customerId: optionalId,
  status: z
    .enum(["honorar_overskredet", "overskridelsesrisiko", "rate_klar", "kan_faktureres", "ajour", ""])
    .optional(),
  format: z.enum(["json", "csv", "xlsx"]).optional(),
});

const receivableFilter = z.object({
  view: z.enum(["unpaid", "overdue", "all"]).optional(),
  customerId: optionalId,
  projectId: optionalId,
  managerId: optionalId,
  format: z.enum(["json", "csv", "xlsx"]).optional(),
});

/** Registers the case finance and debtor list endpoints under /api/v1. */
export const caseFinanceRoutes: FastifyPluginAsyncZod<{ accounting: AccountingAdapter | null }> = async (
  app,
  opts,
) => {
  app.get("/case-finance/cases", { schema: { querystring: caseFilter } }, async (req, reply) => {
    const auth = req.auth as AuthContext;
    const { format, ...filter } = req.query;
    const result = await req.withTenant((tx) => caseOverview(tx, auth, filter));
    if (format !== "csv" && format !== "xlsx") return result;
    return sendExport(reply, await exportFile(caseOverviewExport(result.rows, todayCopenhagen()), format));
  });

  app.get("/case-finance/cases/:id", { schema: { params: idParams } }, async (req) =>
    req.withTenant((tx) => caseFinanceDetail(tx, req.auth as AuthContext, req.params.id)),
  );

  app.get("/case-finance/ready-instalments", async (req) =>
    req.withTenant((tx) => readyInstalments(tx, req.auth as AuthContext)),
  );

  app.put(
    "/case-finance/contracts/:id/plan",
    {
      schema: {
        params: idParams,
        body: z.object({
          activate: z.boolean(),
          items: z
            .array(
              z
                .object({
                  id: z.string().uuid().optional(),
                  description: z.string().trim().min(1).max(300),
                  taskId: z.string().uuid().nullable().optional(),
                  percentage: z.number().gt(0).max(100).nullable().optional(),
                  amount: z.number().positive().nullable().optional(),
                  plannedDate: isoDate,
                })
                .refine((i) => (i.percentage ?? null) !== null || (i.amount ?? null) !== null, {
                  message: "percentage or amount",
                }),
            )
            .max(60),
        }),
      },
    },
    async (req) =>
      req.withTenant((tx) => saveBillingPlan(tx, req.auth as AuthContext, req.params.id, req.body)),
  );

  app.post("/case-finance/plan-items/:id/invoice", { schema: { params: idParams } }, async (req) =>
    req.withTenant((tx) => invoiceInstalment(tx, req.auth as AuthContext, req.params.id)),
  );

  app.patch(
    "/case-finance/tasks/:id",
    {
      schema: {
        params: idParams,
        body: z.object({
          extraWork: z.boolean().optional(),
          /** % complete, 0–100 (decimals allowed), or null to clear */
          completion: z.number().min(0).max(100).nullable().optional(),
        }),
      },
    },
    async (req) => {
      const auth = req.auth as AuthContext;
      return req.withTenant(async (tx) => {
        const out: Record<string, unknown> = {};
        if (req.body.extraWork !== undefined)
          Object.assign(out, await setExtraWork(tx, auth, req.params.id, req.body.extraWork));
        if (req.body.completion !== undefined) {
          const bp = req.body.completion === null ? null : Math.round(req.body.completion * 100);
          Object.assign(out, await setCompletion(tx, auth, req.params.id, bp));
        }
        return out;
      });
    },
  );

  app.post("/case-finance/tasks/:id/aconto-invoice", { schema: { params: idParams } }, async (req) =>
    req.withTenant((tx) => invoiceAconto(tx, req.auth as AuthContext, req.params.id)),
  );

  app.get("/case-finance/settings", async (req) =>
    req.withTenant(async (tx) => {
      await caseScope(tx, req.auth as AuthContext); // 403 for people outside the module
      return caseFinanceSettings(tx);
    }),
  );

  app.patch(
    "/case-finance/settings",
    {
      schema: {
        body: z.object({
          warningBp: z.number().int().min(1).max(20_000).optional(),
          alertBp: z.number().int().min(1).max(20_000).optional(),
          acontoEnabled: z.boolean().optional(),
        }),
      },
    },
    async (req) => req.withTenant((tx) => updateCaseFinanceSettings(tx, req.auth as AuthContext, req.body)),
  );

  app.get("/receivables", { schema: { querystring: receivableFilter } }, async (req, reply) => {
    const auth = req.auth as AuthContext;
    const { format, ...filter } = req.query;
    const result = await req.withTenant((tx) => receivables(tx, auth, filter));
    if (format !== "csv" && format !== "xlsx")
      return { ...result, integration: Boolean(opts.accounting?.invoiceBalance) };
    return sendExport(reply, await exportFile(receivablesExport(result.rows, todayCopenhagen()), format));
  });

  app.get("/receivables/invoices/:id/payments", { schema: { params: idParams } }, async (req) =>
    req.withTenant((tx) => invoicePaymentList(tx, req.auth as AuthContext, req.params.id)),
  );

  app.post(
    "/receivables/invoices/:id/payments",
    {
      schema: {
        params: idParams,
        body: z.object({ full: z.boolean(), amount: z.number().positive().optional(), paidOn: isoDate }),
      },
    },
    async (req) =>
      req.withTenant((tx) => registerPayment(tx, req.auth as AuthContext, req.params.id, req.body)),
  );

  app.delete("/receivables/payments/:id", { schema: { params: idParams } }, async (req) => {
    await req.withTenant((tx) => deletePayment(tx, req.auth as AuthContext, req.params.id));
    return { ok: true };
  });

  app.post(
    "/receivables/invoices/:id/reminders",
    {
      schema: {
        params: idParams,
        body: z.object({ level: z.number().int().min(1).max(3), sentOn: isoDate }),
      },
    },
    async (req) =>
      req.withTenant((tx) => registerReminder(tx, req.auth as AuthContext, req.params.id, req.body)),
  );

  app.get("/case-finance/contracts/:id/fee-plan", { schema: { params: idParams } }, async (req) =>
    req.withTenant((tx) => feePlan(tx, req.auth as AuthContext, req.params.id)),
  );

  app.put(
    "/case-finance/contracts/:id/fee-plan",
    { schema: { params: idParams, body: feePlanInput } },
    async (req) => req.withTenant((tx) => saveFeePlan(tx, req.auth as AuthContext, req.params.id, req.body)),
  );

  app.post("/case-finance/contracts/:id/fee-plan/apply", { schema: { params: idParams } }, async (req) =>
    req.withTenant((tx) => applyFeePlan(tx, req.auth as AuthContext, req.params.id)),
  );

  app.get(
    "/case-finance/contracts/:id/fee-plan/export",
    {
      schema: {
        params: idParams,
        querystring: z.object({ format: z.enum(["csv", "xlsx"]).default("xlsx") }),
      },
    },
    async (req, reply) => {
      const table = await req.withTenant((tx) => feePlanExport(tx, req.auth as AuthContext, req.params.id));
      return sendExport(reply, await exportFile(table, req.query.format));
    },
  );

  app.get("/case-finance/cases/:id/subconsultants", { schema: { params: idParams } }, async (req) =>
    req.withTenant((tx) => subconsultantOverview(tx, req.auth as AuthContext, req.params.id)),
  );

  app.post(
    "/case-finance/cases/:id/subconsultants",
    { schema: { params: idParams, body: subInvoiceBody } },
    async (req) =>
      req.withTenant((tx) => addSubInvoice(tx, req.auth as AuthContext, req.params.id, req.body)),
  );

  app.put(
    "/case-finance/subconsultant-invoices/:id",
    { schema: { params: idParams, body: subInvoiceBody } },
    async (req) =>
      req.withTenant((tx) => updateSubInvoice(tx, req.auth as AuthContext, req.params.id, req.body)),
  );

  app.delete("/case-finance/subconsultant-invoices/:id", { schema: { params: idParams } }, async (req) =>
    req.withTenant((tx) => deleteSubInvoice(tx, req.auth as AuthContext, req.params.id)),
  );

  app.post("/receivables/sync", async (req) =>
    req.withTenant((tx) => syncPayments(tx, req.auth as AuthContext, opts.accounting)),
  );
};
