/**
 * Invoice access and read models for the API (brief §4.10, docs/spec/invoicing.md) — GRASP Pure Fabrication.
 * The invoicing workflows themselves (draft from suggestion, write-downs, booking, credit notes) live in
 * `@arc-tid/db` (`packages/db/src/invoicing.ts`) so the seed uses exactly the same rules. This module adds what only
 * the API needs: who may see/prepare which invoice, the invoicing basis overview, lists and detail views.
 *
 * Access rule: Finance/Admin see and prepare everything; Management may read; a Project Manager sees and prepares
 * invoices for projects they manage. Only Finance/Admin book and credit (enforced in the routes).
 */
import { InvoiceError, loadInvoice, recalcInvoice, schema, type Tx, writeAudit } from "@arc-tid/db";
import { hasRole, invoiceTotals, isAmountLine, type LocalDate } from "@arc-tid/domain";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { type AuthContext, policyOf } from "../auth/plugin.ts";
import { AppError } from "./errors.ts";

/** Throws 403 unless the caller may prepare invoices for all given projects (Finance, or PM of each project). */
export async function assertCanInvoice(tx: Tx, auth: AuthContext, projectIds: string[]) {
  if (policyOf(auth).can("invoice.prepare_all")) return;
  if (!hasRole(auth.roles, "project_manager")) throw new AppError(403, "forbidden");
  const rows = await tx
    .select({ managerId: schema.projects.managerId })
    .from(schema.projects)
    .where(inArray(schema.projects.id, projectIds));
  if (!rows.length || rows.some((r) => r.managerId !== auth.userId)) throw new AppError(403, "forbidden");
}

/** Loads an invoice the caller may see, or throws 404 (not 403, so existence is not revealed). */
export async function assertCanSeeInvoice(tx: Tx, auth: AuthContext, invoiceId: string) {
  const inv = await loadInvoice(tx, invoiceId);
  if (hasRole(auth.roles, "finance", "admin", "management")) return inv;
  if (hasRole(auth.roles, "project_manager") && inv.projectId) {
    const [p] = await tx
      .select({ managerId: schema.projects.managerId })
      .from(schema.projects)
      .where(eq(schema.projects.id, inv.projectId));
    if (p?.managerId === auth.userId) return inv;
  }
  throw new AppError(404, "not_found");
}

/** Loads the invoice that owns a line and checks the caller may see it; returns the invoice id. */
export async function assertCanSeeLine(tx: Tx, auth: AuthContext, lineId: string): Promise<string> {
  const [line] = await tx
    .select({ invoiceId: schema.invoiceLines.invoiceId })
    .from(schema.invoiceLines)
    .where(eq(schema.invoiceLines.id, lineId));
  if (!line) throw new AppError(404, "not_found");
  await assertCanSeeInvoice(tx, auth, line.invoiceId);
  return line.invoiceId;
}

/**
 * Invoicing basis ("faktureringsgrundlag"): per customer project, everything invoiceable up to `upTo` — approved,
 * billable, unreserved T&M hours (value at the approval rate snapshot, øre), due or ready payment-plan items, and
 * approved billable expenses (net + markup).
 * Project managers see only projects they manage.
 */
export async function invoicingBasis(tx: Tx, auth: AuthContext, upTo: LocalDate) {
  const policy = policyOf(auth);
  if (!policy.can("invoice.prepare")) throw new AppError(403, "forbidden");
  const onlyOwn = !policy.can("invoice.prepare_all");
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
    expenses: string;
  }>(sql`
    select p.id as project_id, p.number, p.name, c.id as customer_id, c.name as customer_name, u.initials as manager_initials,
      coalesce(t.hours, 0) as hours, coalesce(t.value, 0) as value, t.oldest,
      coalesce(m.amount, 0) as milestones, coalesce(m.n, 0)::int as milestone_count,
      coalesce(x.amount, 0) as expenses
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
    left join lateral (
      select round(sum(ex.net_amount + ex.net_amount * ex.markup_bp / 10000.0)) as amount
      from expenses ex
      where ex.project_id = p.id and ex.status = 'approved' and ex.billable and ex.invoice_line_id is null
        and ex.date <= ${upTo}
    ) x on true
    where (coalesce(t.hours, 0) > 0 or coalesce(m.n, 0) > 0 or coalesce(x.amount, 0) > 0)
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
    expenses: Number(r.expenses),
    total: Number(r.value) + Number(r.milestones) + Number(r.expenses),
  }));
}

/** Active customer projects, for one-click bulk drafting. */
export async function activeCustomerProjects(tx: Tx) {
  return tx
    .select({ id: schema.projects.id, customerId: schema.projects.customerId })
    .from(schema.projects)
    .where(and(sql`${schema.projects.customerId} is not null`, eq(schema.projects.status, "active")))
    .orderBy(asc(schema.projects.number));
}

/** Invoice list filtered by status ("open" = not booked), newest number first; PMs see their projects only. */
export async function listInvoices(
  tx: Tx,
  auth: AuthContext,
  status?: "draft" | "ready" | "booked" | "open",
) {
  if (!hasRole(auth.roles, "finance", "admin", "management", "project_manager"))
    throw new AppError(403, "forbidden");
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
        status === "open"
          ? sql`${schema.invoices.status} <> 'booked'`
          : status
            ? eq(schema.invoices.status, status)
            : undefined,
        hasRole(auth.roles, "finance", "admin", "management")
          ? undefined
          : eq(schema.projects.managerId, auth.userId),
      ),
    )
    .orderBy(desc(sql`coalesce(${schema.invoices.number}, 2147483647)`), desc(schema.invoices.createdAt));
}

/** Full invoice for the editor: header, customer, lines with how many time entries each covers, VAT totals, credit notes. */
export async function invoiceDetail(tx: Tx, auth: AuthContext, invoiceId: string) {
  const inv = await assertCanSeeInvoice(tx, auth, invoiceId);
  const [customer] = await tx.select().from(schema.customers).where(eq(schema.customers.id, inv.customerId));
  const lines = await tx
    .select()
    .from(schema.invoiceLines)
    .where(eq(schema.invoiceLines.invoiceId, inv.id))
    .orderBy(asc(schema.invoiceLines.sort));
  const sourceCounts = lines.length
    ? await tx
        .select({ lineId: schema.invoiceLineSources.invoiceLineId, n: sql<number>`count(*)::int` })
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
      lines.filter((l) => isAmountLine(l.kind)).map((l) => ({ amount: l.amount, vatBp: l.vatBp })),
    ),
    credits,
    canBook: policyOf(auth).can("invoice.book") && inv.status !== "booked",
  };
}

/** Editable invoice header fields. */
export interface InvoiceHeaderUpdate {
  heading?: string | undefined;
  invoiceDate?: LocalDate | undefined;
  dueDate?: LocalDate | undefined;
  ourReference?: string | null | undefined;
  theirReference?: string | null | undefined;
  attachSpecification?: boolean | undefined;
}

/** Updates header fields of an unbooked invoice (audited). Booked invoices are immutable. */
export async function updateInvoiceHeader(
  tx: Tx,
  auth: AuthContext,
  invoiceId: string,
  patch: InvoiceHeaderUpdate,
) {
  const inv = await assertCanSeeInvoice(tx, auth, invoiceId);
  if (inv.status === "booked") throw new InvoiceError("invoice_booked");
  await tx
    .update(schema.invoices)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.invoices.id, inv.id));
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "invoice",
    entityId: inv.id,
    action: "update",
    userId: auth.userId,
    before: inv,
    after: patch,
  });
}

/** Marks a draft "ready for booking" (lets a PM hand over to Finance; decision D-013 / observed separation of roles). */
export async function markReady(tx: Tx, auth: AuthContext, invoiceId: string) {
  const inv = await assertCanSeeInvoice(tx, auth, invoiceId);
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
}
