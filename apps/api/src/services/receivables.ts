/**
 * Debitorliste: booked invoices with due date, paid, outstanding, status and reminders; ageing cards; registering
 * payments and reminders (rykkere); reading payment status from the accounting system — docs/spec/case-finance.md
 * §5, decision D-029. GRASP Pure Fabrication: queries + the pure rules in @arc-tid/domain (receivables.ts).
 *
 * Payment status comes from e-conomic through the integration adapter when it is configured; manual registration
 * is the fallback (and the only source while the integration is off, as in the demo).
 * Scope: Finance and Management see all invoices; a project manager sees invoices on cases they manage.
 */
import { schema, type Tx, writeAudit } from "@arc-tid/db";
import {
  ageingSummary,
  type DebtStatus,
  debt,
  kr,
  type LocalDate,
  nextReminderError,
  overdueText,
  paymentError,
  todayCopenhagen,
} from "@arc-tid/domain";
import type { AccountingAdapter } from "@arc-tid/integrations";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { type AuthContext, policyOf } from "../auth/plugin.ts";
import { caseScope, inIds } from "./case-finance.ts";
import { AppError } from "./errors.ts";
import type { ExportTable } from "./export.ts";

/** Which invoices to show: only unpaid (default), only overdue, or all. */
export type ReceivableView = "unpaid" | "overdue" | "all";

/** Filters for the debtor list. */
export interface ReceivableFilter {
  view?: ReceivableView | undefined;
  customerId?: string | undefined;
  projectId?: string | undefined;
  managerId?: string | undefined;
}

/**
 * Booked invoices (not credit notes) with computed outstanding / status on `today`. `projectIds` limits the scope
 * (null = all invoices, including those without a case).
 */
export async function receivableRows(tx: Tx, scope: { projectIds: string[] | null }, today: LocalDate) {
  if (scope.projectIds && !scope.projectIds.length) return [];
  const rows = await tx.execute<{
    id: string;
    number: number;
    customer_id: string;
    customer_name: string;
    project_id: string | null;
    project_number: string | null;
    project_name: string | null;
    manager_id: string | null;
    manager_name: string | null;
    invoice_date: string;
    due_date: string;
    total: string;
    credited: string;
    paid: string;
    reminder_levels: number[] | null;
    last_reminder: string | null;
    external_id: string | null;
  }>(sql`
    select i.id, i.number, i.customer_id, cu.name as customer_name, i.project_id,
      p.number as project_number, p.name as project_name, p.manager_id, u.full_name as manager_name,
      i.invoice_date, i.due_date, i.total, i.external_id,
      coalesce((select -sum(cn.total) from invoices cn
                where cn.credit_of_id = i.id and cn.status = 'booked' and cn.type = 'credit'), 0) as credited,
      coalesce((select sum(pm.amount) from invoice_payments pm where pm.invoice_id = i.id), 0) as paid,
      (select array_agg(r.level order by r.level) from invoice_reminders r where r.invoice_id = i.id) as reminder_levels,
      (select max(r.sent_on) from invoice_reminders r where r.invoice_id = i.id) as last_reminder
    from invoices i
    join customers cu on cu.id = i.customer_id
    left join projects p on p.id = i.project_id
    left join users u on u.id = p.manager_id
    where i.status = 'booked' and i.type = 'invoice'
      ${scope.projectIds ? sql`and ${inIds("i.project_id", scope.projectIds)}` : sql``}
    order by i.due_date, i.number`);
  return rows.map((r) => {
    const d = debt(
      { total: Number(r.total), credited: Number(r.credited), paid: Number(r.paid), dueDate: r.due_date },
      today,
    );
    return {
      id: r.id,
      number: r.number,
      customerId: r.customer_id,
      customerName: r.customer_name,
      projectId: r.project_id,
      caseLabel: r.project_number ? `${r.project_number} ${r.project_name}` : null,
      managerId: r.manager_id,
      managerName: r.manager_name,
      invoiceDate: r.invoice_date,
      dueDate: r.due_date,
      total: Number(r.total),
      credited: Number(r.credited),
      paid: Number(r.paid),
      outstanding: d.outstanding,
      daysOverdue: d.daysOverdue,
      status: d.status,
      bucket: d.bucket,
      reminders: r.reminder_levels ?? [],
      lastReminder: r.last_reminder,
      synced: Boolean(r.external_id),
    };
  });
}

export type ReceivableRow = Awaited<ReturnType<typeof receivableRows>>[number];

/** Debtor list for the caller: rows after filters, ageing cards and filter options. */
export async function receivables(
  tx: Tx,
  auth: AuthContext,
  f: ReceivableFilter = {},
  today = todayCopenhagen(),
) {
  const scope = await caseScope(tx, auth);
  const all = await receivableRows(tx, { projectIds: scope === "all" ? null : scope }, today);
  const scoped = all.filter(
    (r) =>
      (!f.customerId || r.customerId === f.customerId) &&
      (!f.projectId || r.projectId === f.projectId) &&
      (!f.managerId || r.managerId === f.managerId),
  );
  const view = f.view ?? "unpaid";
  const rows = scoped.filter((r) =>
    view === "all" ? true : view === "overdue" ? r.outstanding > 0 && r.daysOverdue > 0 : r.outstanding > 0,
  );
  const opt = (xs: { id: string | null; name: string | null }[]) =>
    [
      ...new Map(
        xs.filter((x) => x.id).map((x) => [x.id as string, { id: x.id as string, name: x.name ?? "" }]),
      ).values(),
    ].sort((a, b) => a.name.localeCompare(b.name, "da"));
  return {
    rows,
    ageing: ageingSummary(scoped),
    options: {
      customers: opt(all.map((r) => ({ id: r.customerId, name: r.customerName }))),
      cases: opt(all.map((r) => ({ id: r.projectId, name: r.caseLabel }))),
      managers: opt(all.map((r) => ({ id: r.managerId, name: r.managerName }))),
    },
    canManage: policyOf(auth).can("receivables.manage"),
  };
}

const STATUS_TEXT: Record<DebtStatus, string> = {
  aaben: "Åben",
  forfalden: "Forfalden",
  delvist_betalt: "Delvist betalt",
  betalt: "Betalt",
  krediteret: "Krediteret",
};

/** Status text as shown in the list: "Forfalden 6 dage" uses the overdue days. */
export const debtStatusText = (r: Pick<ReceivableRow, "status" | "daysOverdue">): string =>
  r.status === "forfalden"
    ? `${STATUS_TEXT.forfalden} (${overdueText(r.daysOverdue)})`
    : STATUS_TEXT[r.status];

/** The debtor list as an export table (amounts incl. VAT), with totals for the amounts. */
export function receivablesExport(rows: ReceivableRow[], today: LocalDate): ExportTable<ReceivableRow> {
  return {
    sheet: "Debitorliste",
    file: `ARCtime_debitorliste_${today}`,
    rows,
    columns: [
      { header: "Fakturanr.", kind: "text", value: (r) => r.number },
      { header: "Kunde", kind: "text", value: (r) => r.customerName },
      { header: "Sag", kind: "text", value: (r) => r.caseLabel },
      { header: "Fakturadato", kind: "date", value: (r) => r.invoiceDate },
      { header: "Forfald", kind: "date", value: (r) => r.dueDate },
      { header: "Beløb inkl. moms", kind: "money", value: (r) => (r.total - r.credited) / 100, total: true },
      { header: "Betalt", kind: "money", value: (r) => r.paid / 100, total: true },
      { header: "Udestående", kind: "money", value: (r) => r.outstanding / 100, total: true },
      { header: "Status", kind: "text", value: (r) => debtStatusText(r) },
      { header: "Rykkere", kind: "integer", value: (r) => r.reminders.length },
    ],
  };
}

/** Loads one booked invoice's receivable row (scope-checked), or 404. */
async function receivableFor(tx: Tx, auth: AuthContext, invoiceId: string, today: LocalDate) {
  const scope = await caseScope(tx, auth);
  const rows = await receivableRows(tx, { projectIds: scope === "all" ? null : scope }, today);
  const row = rows.find((r) => r.id === invoiceId);
  if (!row) throw new AppError(404, "not_found");
  return row;
}

/** Registers a payment (full = the whole outstanding amount, or a part in kr) on a booked invoice; audited. */
export async function registerPayment(
  tx: Tx,
  auth: AuthContext,
  invoiceId: string,
  body: { full: boolean; amount?: number | undefined; paidOn: LocalDate },
  today = todayCopenhagen(),
) {
  if (!policyOf(auth).can("receivables.manage")) throw new AppError(403, "forbidden");
  const row = await receivableFor(tx, auth, invoiceId, today);
  const amount = body.full ? row.outstanding : kr(body.amount ?? 0);
  const err = paymentError(amount, row.outstanding);
  if (err) throw new AppError(422, err);
  if (body.paidOn > today) throw new AppError(422, "payment_in_future");
  const [p] = await tx
    .insert(schema.invoicePayments)
    .values({
      tenantId: auth.tenantId,
      invoiceId,
      paidOn: body.paidOn,
      amount,
      source: "manual",
      createdBy: auth.userId,
    })
    .returning();
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "invoice_payment",
    entityId: p?.id ?? "",
    action: "create",
    userId: auth.userId,
    after: { invoiceId, number: row.number, amount, paidOn: body.paidOn },
  });
  return receivableFor(tx, auth, invoiceId, today);
}

/** Removes a manually registered payment (to correct a mistake); audited. Synced payments cannot be removed. */
export async function deletePayment(tx: Tx, auth: AuthContext, paymentId: string) {
  if (!policyOf(auth).can("receivables.manage")) throw new AppError(403, "forbidden");
  const [p] = await tx.select().from(schema.invoicePayments).where(eq(schema.invoicePayments.id, paymentId));
  if (!p) throw new AppError(404, "not_found");
  if (p.source !== "manual") throw new AppError(409, "payment_from_accounting");
  await tx.delete(schema.invoicePayments).where(eq(schema.invoicePayments.id, p.id));
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "invoice_payment",
    entityId: p.id,
    action: "delete",
    userId: auth.userId,
    before: p,
  });
}

/** Payments registered on an invoice (for the payment dialog). */
export async function invoicePaymentList(tx: Tx, auth: AuthContext, invoiceId: string) {
  await receivableFor(tx, auth, invoiceId, todayCopenhagen());
  return tx
    .select()
    .from(schema.invoicePayments)
    .where(eq(schema.invoicePayments.invoiceId, invoiceId))
    .orderBy(schema.invoicePayments.paidOn);
}

/** Registers that reminder (rykker) 1, 2 or 3 was sent; levels must follow each other. Letters are phase 2. */
export async function registerReminder(
  tx: Tx,
  auth: AuthContext,
  invoiceId: string,
  body: { level: number; sentOn: LocalDate },
  today = todayCopenhagen(),
) {
  if (!policyOf(auth).can("receivables.manage")) throw new AppError(403, "forbidden");
  const row = await receivableFor(tx, auth, invoiceId, today);
  if (row.outstanding <= 0) throw new AppError(409, "invoice_paid");
  if (row.daysOverdue <= 0) throw new AppError(409, "invoice_not_overdue");
  const err = nextReminderError(body.level, row.reminders);
  if (err) throw new AppError(422, err);
  await tx.insert(schema.invoiceReminders).values({
    tenantId: auth.tenantId,
    invoiceId,
    level: body.level,
    sentOn: body.sentOn,
    createdBy: auth.userId,
  });
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "invoice_reminder",
    entityId: invoiceId,
    action: "create",
    userId: auth.userId,
    after: { number: row.number, level: body.level, sentOn: body.sentOn },
  });
  return receivableFor(tx, auth, invoiceId, today);
}

/**
 * Reads payment status from the accounting system for synced invoices (those with an external id) and records
 * the difference as an "economic" payment, so manual and synced payments add up. Needs the adapter configured.
 */
export async function syncPayments(
  tx: Tx,
  auth: AuthContext,
  adapter: AccountingAdapter | null,
  today = todayCopenhagen(),
) {
  if (!policyOf(auth).can("receivables.manage")) throw new AppError(403, "forbidden");
  if (!adapter?.invoiceBalance) throw new AppError(409, "integration_not_configured");
  const synced = await tx
    .select({ id: schema.invoices.id, externalId: schema.invoices.externalId })
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.status, "booked"),
        eq(schema.invoices.type, "invoice"),
        isNotNull(schema.invoices.externalId),
      ),
    );
  const rows = new Map((await receivableRows(tx, { projectIds: null }, today)).map((r) => [r.id, r]));
  let updated = 0;
  for (const inv of synced) {
    const row = rows.get(inv.id);
    if (!row || row.outstanding <= 0 || !inv.externalId) continue;
    const balance = await adapter.invoiceBalance(inv.externalId);
    const paidThere = balance.gross - balance.remainder;
    const delta = paidThere - row.paid;
    if (delta <= 0) continue;
    await tx.insert(schema.invoicePayments).values({
      tenantId: auth.tenantId,
      invoiceId: inv.id,
      paidOn: today,
      amount: Math.min(delta, row.outstanding),
      source: "economic",
      createdBy: auth.userId,
    });
    updated++;
  }
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "invoice_payment",
    entityId: auth.tenantId,
    action: "sync",
    userId: auth.userId,
    after: { checked: synced.length, updated },
  });
  return { checked: synced.length, updated };
}
