/**
 * Expense and receipt routes (brief §4.7, docs/spec/expenses.md) — GRASP Controller: validate input, delegate to
 * `services/expenses.ts` and `services/files.ts`.
 *
 *   GET    /expenses/settings              expense types + mileage rates
 *   GET    /expenses?month=YYYY-MM-01      own expenses in a month
 *   POST   /expenses                       register an expense or mileage claim (draft)
 *   PUT    /expenses/:id                   edit a draft/rejected expense
 *   DELETE /expenses/:id                   delete a draft/rejected expense
 *   POST   /expenses/submit                submit drafts for approval
 *   GET    /expense-approvals              submitted expenses waiting for the caller
 *   POST   /expenses/:id/approve           approve
 *   POST   /expenses/:id/reject            reject with comment
 *   POST   /files                          upload a receipt (multipart, field "file")
 *   GET    /files/:id                      download a receipt (owner, approver, Finance)
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthContext } from "../auth/plugin.ts";
import { AppError } from "../services/errors.ts";
import {
  approveExpense,
  canSeeFile,
  deleteExpense,
  expenseApprovalQueue,
  expenseSettings,
  myExpenses,
  rejectExpense,
  saveExpense,
  submitExpenses,
} from "../services/expenses.ts";
import { MAX_FILE_BYTES, readStoredFile, storeFile } from "../services/files.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idParams = z.object({ id: z.string().uuid() });
const expenseBody = z
  .object({
    date: isoDate,
    kind: z.enum(["expense", "mileage"]),
    description: z.string().trim().min(1).max(300),
    projectId: z.string().uuid().nullish(),
    expenseTypeId: z.string().uuid().nullish(),
    /** kr incl. VAT */
    amount: z.number().positive().max(1_000_000).optional(),
    km: z.number().positive().max(5000).optional(),
    fromPlace: z.string().max(200).optional(),
    toPlace: z.string().max(200).optional(),
    billable: z.boolean().optional(),
    markupPct: z.number().min(0).max(100).optional(),
    receiptFileId: z.string().uuid().nullish(),
  })
  .refine(
    (b) => (b.kind === "expense" ? b.amount !== undefined : b.km !== undefined),
    "amount_or_km_required",
  );

/** Registers the expense and file endpoints under /api/v1. */
export const expenseRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/expenses/settings", async (req) => req.withTenant((tx) => expenseSettings(tx)));

  app.get(
    "/expenses",
    { schema: { querystring: z.object({ month: z.string().regex(/^\d{4}-\d{2}-01$/) }) } },
    async (req) => req.withTenant((tx) => myExpenses(tx, req.auth as AuthContext, req.query.month)),
  );

  app.post("/expenses", { schema: { body: expenseBody } }, async (req) =>
    req.withTenant((tx) => saveExpense(tx, req.auth as AuthContext, req.body)),
  );

  app.put("/expenses/:id", { schema: { params: idParams, body: expenseBody } }, async (req) =>
    req.withTenant((tx) => saveExpense(tx, req.auth as AuthContext, req.body, req.params.id)),
  );

  app.delete("/expenses/:id", { schema: { params: idParams } }, async (req) =>
    req.withTenant(async (tx) => {
      await deleteExpense(tx, req.auth as AuthContext, req.params.id);
      return { ok: true };
    }),
  );

  app.post(
    "/expenses/submit",
    { schema: { body: z.object({ ids: z.array(z.string().uuid()).optional() }) } },
    async (req) => req.withTenant((tx) => submitExpenses(tx, req.auth as AuthContext, req.body.ids)),
  );

  app.get("/expense-approvals", async (req) =>
    req.withTenant((tx) => expenseApprovalQueue(tx, req.auth as AuthContext)),
  );

  app.post("/expenses/:id/approve", { schema: { params: idParams } }, async (req) =>
    req.withTenant((tx) => approveExpense(tx, req.auth as AuthContext, req.params.id)),
  );

  app.post(
    "/expenses/:id/reject",
    { schema: { params: idParams, body: z.object({ comment: z.string().trim().min(1).max(1000) }) } },
    async (req) =>
      req.withTenant((tx) => rejectExpense(tx, req.auth as AuthContext, req.params.id, req.body.comment)),
  );

  app.post("/files", async (req) => {
    const part = await req.file({ limits: { fileSize: MAX_FILE_BYTES + 1, files: 1 } });
    if (!part) throw new AppError(400, "file_missing");
    const bytes = await part.toBuffer().catch(() => {
      throw new AppError(413, "file_too_large");
    });
    const row = await req.withTenant((tx) => storeFile(tx, req.auth as AuthContext, part.filename, bytes));
    return { id: row.id, filename: row.filename, contentType: row.contentType, size: row.size };
  });

  app.get("/files/:id", { schema: { params: idParams } }, async (req, reply) => {
    const auth = req.auth as AuthContext;
    const { row, bytes } = await req.withTenant(async (tx) => {
      if (!(await canSeeFile(tx, auth, req.params.id))) throw new AppError(404, "not_found");
      return readStoredFile(tx, auth, req.params.id);
    });
    return reply
      .header("content-type", row.contentType)
      .header("content-disposition", `inline; filename="${encodeURIComponent(row.filename)}"`)
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'")
      .send(bytes);
  });
};
