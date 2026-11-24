/**
 * Sub-consultants' invoices on a case (D-039, Finance 2026-11-19: "underrådgivere skal registreres"). GRASP
 * Information Expert for registering them, comparing them with the sub-consultant's fee in the rate plan and
 * deciding what can be re-invoiced to the customer.
 *
 *   register   Finance or the case's project manager; on the case and optionally on a phase; amount excl. VAT
 *   compare    per sub-consultant: fee in the rate plan (budget) vs registered so far
 *   re-invoice only when the case is invoiced to the customer and "videre­faktureres" is ticked; then the invoice
 *              suggestion picks it up at amount + markup (packages/db invoicing.ts). On a fixed price the
 *              sub-consultant is normally part of the fee already, so the default is not to re-invoice.
 *   change     only while the invoice is not on a customer invoice; every change is audited
 */
import { schema, type Tx, writeAudit } from "@arc-tid/db";
import { computeFeePlan, type FeePlanInput, kr } from "@arc-tid/domain";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { AuthContext } from "../auth/plugin.ts";
import { assertCaseVisible, canEditCase } from "./case-finance.ts";
import { AppError } from "./errors.ts";

/** A sub-consultant invoice as sent by the form; amount in kr excl. VAT, markup in percent. */
export interface SubInvoiceInput {
  supplier: string;
  invoiceNumber?: string | null | undefined;
  invoiceDate: string;
  amount: number;
  taskId?: string | null | undefined;
  note?: string | null | undefined;
  rebill?: boolean | undefined;
  markupPct?: number | undefined;
}

const norm = (s: string) => s.trim().toLocaleLowerCase("da");

/** Registered invoices on a case, and per sub-consultant: fee in the rate plan vs registered. */
export async function subconsultantOverview(tx: Tx, auth: AuthContext, projectId: string) {
  await assertCaseVisible(tx, auth, projectId);
  const [p] = await tx
    .select({ billable: schema.projects.billable })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!p) throw new AppError(404, "not_found");
  const invoices = await tx
    .select({
      id: schema.subconsultantInvoices.id,
      supplier: schema.subconsultantInvoices.supplier,
      invoiceNumber: schema.subconsultantInvoices.invoiceNumber,
      invoiceDate: schema.subconsultantInvoices.invoiceDate,
      amount: schema.subconsultantInvoices.amount,
      taskId: schema.subconsultantInvoices.taskId,
      phase: schema.tasks.name,
      note: schema.subconsultantInvoices.note,
      rebill: schema.subconsultantInvoices.rebill,
      markupBp: schema.subconsultantInvoices.markupBp,
      onInvoice: schema.subconsultantInvoices.invoiceLineId,
      invoiced: schema.subconsultantInvoices.invoiced,
    })
    .from(schema.subconsultantInvoices)
    .leftJoin(schema.tasks, eq(schema.tasks.id, schema.subconsultantInvoices.taskId))
    .where(eq(schema.subconsultantInvoices.projectId, projectId))
    .orderBy(asc(schema.subconsultantInvoices.invoiceDate));

  // budgets: the sub-consultants in the rate plan generator of the case's fixed-price contracts
  const contracts = await tx
    .select({ id: schema.contracts.id })
    .from(schema.contracts)
    .where(eq(schema.contracts.projectId, projectId));
  const plans = contracts.length
    ? await tx
        .select({ input: schema.feePlans.input })
        .from(schema.feePlans)
        .where(
          inArray(
            schema.feePlans.contractId,
            contracts.map((c) => c.id),
          ),
        )
    : [];
  const budget = new Map<string, { name: string; budget: number }>();
  for (const pl of plans) {
    const input = pl.input as FeePlanInput;
    const r = computeFeePlan(input);
    input.subs.forEach((s, j) => {
      const k = norm(s.name);
      const prev = budget.get(k);
      budget.set(k, { name: prev?.name ?? s.name, budget: (prev?.budget ?? 0) + (r.subTotals[j] ?? 0) });
    });
  }
  const suppliers = new Map<string, { name: string; budget: number | null; registered: number }>();
  for (const [k, b] of budget) suppliers.set(k, { name: b.name, budget: b.budget, registered: 0 });
  for (const i of invoices) {
    const k = norm(i.supplier);
    const s = suppliers.get(k) ?? { name: i.supplier, budget: null, registered: 0 };
    s.registered += i.amount;
    suppliers.set(k, s);
  }
  return {
    billable: p.billable,
    canEdit: await canEditCase(tx, auth, projectId),
    invoices: invoices.map(({ onInvoice, ...i }) => ({ ...i, locked: Boolean(onInvoice) || i.invoiced })),
    suppliers: [...suppliers.values()].map((s) => ({
      ...s,
      remaining: s.budget === null ? null : s.budget - s.registered,
    })),
    total: invoices.reduce((a, i) => a + i.amount, 0),
  };
}

async function checkInput(tx: Tx, projectId: string, b: SubInvoiceInput) {
  const [p] = await tx
    .select({ billable: schema.projects.billable })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!p) throw new AppError(404, "not_found");
  if (b.rebill && !p.billable) throw new AppError(422, "rebill_not_billable");
  if (b.taskId) {
    const [t] = await tx
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.id, b.taskId), eq(schema.tasks.projectId, projectId)));
    if (!t) throw new AppError(422, "phase_not_on_case");
  }
  return {
    supplier: b.supplier.trim(),
    invoiceNumber: b.invoiceNumber?.trim() || null,
    invoiceDate: b.invoiceDate,
    amount: kr(b.amount),
    taskId: b.taskId ?? null,
    note: b.note?.trim() || null,
    rebill: Boolean(b.rebill),
    markupBp: b.rebill ? Math.round((b.markupPct ?? 0) * 100) : 0,
  };
}

async function assertEdit(tx: Tx, auth: AuthContext, projectId: string) {
  await assertCaseVisible(tx, auth, projectId);
  if (!(await canEditCase(tx, auth, projectId))) throw new AppError(403, "forbidden");
}

/** Registers a sub-consultant's invoice on the case. */
export async function addSubInvoice(tx: Tx, auth: AuthContext, projectId: string, b: SubInvoiceInput) {
  await assertEdit(tx, auth, projectId);
  const values = await checkInput(tx, projectId, b);
  const [row] = await tx
    .insert(schema.subconsultantInvoices)
    .values({ tenantId: auth.tenantId, projectId, ...values, createdBy: auth.userId })
    .returning();
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "subconsultant_invoice",
    entityId: row?.id ?? "",
    action: "create",
    userId: auth.userId,
    after: values,
  });
  return row;
}

async function loadOpen(tx: Tx, id: string) {
  const [row] = await tx
    .select()
    .from(schema.subconsultantInvoices)
    .where(eq(schema.subconsultantInvoices.id, id));
  if (!row) throw new AppError(404, "not_found");
  if (row.invoiceLineId || row.invoiced) throw new AppError(409, "subinvoice_on_invoice");
  return row;
}

/** Changes a registered invoice that is not on a customer invoice. */
export async function updateSubInvoice(tx: Tx, auth: AuthContext, id: string, b: SubInvoiceInput) {
  const before = await loadOpen(tx, id);
  await assertEdit(tx, auth, before.projectId);
  const values = await checkInput(tx, before.projectId, b);
  const [after] = await tx
    .update(schema.subconsultantInvoices)
    .set(values)
    .where(eq(schema.subconsultantInvoices.id, id))
    .returning();
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "subconsultant_invoice",
    entityId: id,
    action: "update",
    userId: auth.userId,
    before,
    after,
  });
  return after;
}

/** Removes a registered invoice that is not on a customer invoice (e.g. registered by mistake); audited. */
export async function deleteSubInvoice(tx: Tx, auth: AuthContext, id: string) {
  const before = await loadOpen(tx, id);
  await assertEdit(tx, auth, before.projectId);
  await tx.delete(schema.subconsultantInvoices).where(eq(schema.subconsultantInvoices.id, id));
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "subconsultant_invoice",
    entityId: id,
    action: "delete",
    userId: auth.userId,
    before,
  });
  return { ok: true };
}
