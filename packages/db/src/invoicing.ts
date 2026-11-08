/**
 * Invoicing service (brief §4.10, docs/spec/invoicing.md, decisions D-014/D-015).
 * All functions run inside the caller's tenant transaction so a change, its audit record and its outbox event
 * commit together.
 *
 * Reservation: creating a draft sets time_entries.invoice_line_id / payment_plan_items.invoice_line_id at once,
 * so no other draft can pick the same entries. Deleting a draft or line releases them. Booking turns the
 * reservation final (entry status "invoiced", plan item "invoiced").
 */
import {
  buildTimeLines,
  DANISH_VAT_BP,
  dueDate,
  fromDecimal,
  type Grouping,
  type InvoiceableEntry,
  invoiceTotals,
  isLocked,
  type LocalDate,
  lineAmount,
  monthOf,
  spreadAmount,
} from "@arc-tid/domain";
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { writeAudit } from "./audit.ts";
import type { Tx } from "./client.ts";
import * as s from "./schema.ts";

export class InvoiceError extends Error {
  constructor(
    public code: string,
    public status = 409,
  ) {
    super(code);
  }
}

const AMOUNT_KINDS = new Set(["time", "milestone", "product"]);

/** Closed accounting months for the tenant (single legal entity in MVP; per entity in M4). */
export async function closedMonths(tx: Tx): Promise<Set<string>> {
  const rows = await tx
    .select({ month: s.accountingPeriods.month })
    .from(s.accountingPeriods)
    .where(eq(s.accountingPeriods.status, "closed"));
  return new Set(rows.map((r) => r.month));
}

/** Approved, billable, unreserved T&M entries for the given projects up to a date. */
export async function invoiceableEntries(
  tx: Tx,
  projectIds: string[],
  upTo: LocalDate,
): Promise<(InvoiceableEntry & { projectId: string; contractId: string; maxHours: number | null })[]> {
  if (!projectIds.length) return [];
  const rows = await tx
    .select({
      id: s.timeEntries.id,
      date: s.timeEntries.date,
      hours: s.timeEntries.hours,
      rate: s.timeEntries.salesRate,
      taskId: s.tasks.id,
      wbs: s.tasks.wbs,
      taskName: s.tasks.name,
      userId: s.users.id,
      userName: s.users.fullName,
      status: s.timeEntries.status,
      invoiceLineId: s.timeEntries.invoiceLineId,
      billable: s.timeEntries.billable,
      projectId: s.timeEntries.projectId,
      contractId: s.contracts.id,
      contractType: s.contracts.type,
      maxHours: s.contracts.maxHours,
    })
    .from(s.timeEntries)
    .innerJoin(s.tasks, eq(s.tasks.id, s.timeEntries.taskId))
    .innerJoin(s.contracts, eq(s.contracts.id, s.tasks.contractId))
    .innerJoin(s.users, eq(s.users.id, s.timeEntries.userId))
    .where(
      and(
        inArray(s.timeEntries.projectId, projectIds),
        eq(s.timeEntries.status, "approved"),
        eq(s.timeEntries.billable, true),
        isNull(s.timeEntries.invoiceLineId),
        lte(s.timeEntries.date, upTo),
        // Fixed price and retainer work is invoiced through the payment plan, not as hours.
        eq(s.contracts.type, "time_material"),
      ),
    )
    .orderBy(asc(s.timeEntries.date));
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    hours: fromDecimal(r.hours),
    rate: r.rate ?? 0,
    taskId: r.taskId,
    taskLabel: `${r.wbs} ${r.taskName}`,
    userId: r.userId,
    userLabel: r.userName,
    status: r.status,
    invoiceLineId: r.invoiceLineId,
    billable: r.billable,
    projectId: r.projectId ?? "",
    contractId: r.contractId,
    maxHours: r.maxHours,
  }));
}

/** T&M cap: hours above the contract's maximum are not invoiceable (docs/spec/projects.md). */
async function applyCaps<T extends { contractId: string; maxHours: number | null; hours: number }>(
  tx: Tx,
  entries: T[],
): Promise<T[]> {
  const capped = [...new Set(entries.filter((e) => e.maxHours !== null).map((e) => e.contractId))];
  if (!capped.length) return entries;
  // Hours already on invoices (reserved or booked) per capped contract.
  const used = await tx
    .select({ contractId: s.tasks.contractId, hours: sql<string>`coalesce(sum(${s.timeEntries.hours}), 0)` })
    .from(s.timeEntries)
    .innerJoin(s.tasks, eq(s.tasks.id, s.timeEntries.taskId))
    .where(and(inArray(s.tasks.contractId, capped), sql`${s.timeEntries.invoiceLineId} is not null`))
    .groupBy(s.tasks.contractId);
  const total = new Map(used.map((u) => [u.contractId ?? "", fromDecimal(Number(u.hours))]));
  return entries.filter((e) => {
    if (e.maxHours === null) return true;
    const sofar = total.get(e.contractId) ?? 0;
    if (sofar + e.hours > fromDecimal(e.maxHours)) return false;
    total.set(e.contractId, sofar + e.hours);
    return true;
  });
}

export interface DraftParams {
  tenantId: string;
  userId: string;
  customerId: string;
  projectIds: string[];
  upTo: LocalDate;
  invoiceDate: LocalDate;
  grouping: Grouping;
  includeMilestones?: boolean;
}

/** Creates a draft invoice from everything invoiceable on the projects (one customer). Returns the invoice id or null if nothing is invoiceable. */
export async function createDraftFromSuggestion(tx: Tx, p: DraftParams): Promise<string | null> {
  const projects = await tx.select().from(s.projects).where(inArray(s.projects.id, p.projectIds));
  if (!projects.length || projects.some((x) => x.customerId !== p.customerId))
    throw new InvoiceError("projects_customer_mismatch", 400);
  const currencies = new Set(projects.map((x) => x.currency));
  if (currencies.size > 1) throw new InvoiceError("mixed_currency", 400);
  const [customer] = await tx.select().from(s.customers).where(eq(s.customers.id, p.customerId));
  if (!customer) throw new InvoiceError("customer_not_found", 404);

  const entries = await applyCaps(tx, await invoiceableEntries(tx, p.projectIds, p.upTo));
  const contracts = await tx.select().from(s.contracts).where(inArray(s.contracts.projectId, p.projectIds));
  const milestones =
    p.includeMilestones === false || !contracts.length
      ? []
      : await tx
          .select()
          .from(s.paymentPlanItems)
          .where(
            and(
              inArray(
                s.paymentPlanItems.contractId,
                contracts.map((c) => c.id),
              ),
              isNull(s.paymentPlanItems.invoiceLineId),
              sql`(${s.paymentPlanItems.status} = 'ready' or (${s.paymentPlanItems.status} = 'planned' and ${s.paymentPlanItems.dueDate} <= ${p.upTo}))`,
            ),
          )
          .orderBy(asc(s.paymentPlanItems.dueDate));
  if (!entries.length && !milestones.length) return null;

  const [invoice] = await tx
    .insert(s.invoices)
    .values({
      tenantId: p.tenantId,
      legalEntityId: projects[0]?.legalEntityId ?? "",
      customerId: p.customerId,
      projectId: projects.length === 1 ? (projects[0]?.id ?? null) : null,
      invoiceDate: p.invoiceDate,
      dueDate: dueDate(p.invoiceDate, customer.paymentTermsDays),
      currency: projects[0]?.currency ?? "DKK",
      heading: projects.length === 1 ? `${projects[0]?.number} ${projects[0]?.name}` : customer.name,
      createdBy: p.userId,
    })
    .returning();
  if (!invoice) throw new InvoiceError("create_failed", 500);

  let sort = 0;
  for (const project of projects.sort((a, b) => a.number.localeCompare(b.number))) {
    const projEntries = entries.filter((e) => e.projectId === project.id);
    const projMilestones = milestones.filter(
      (m) => contracts.find((c) => c.id === m.contractId)?.projectId === project.id,
    );
    if (!projEntries.length && !projMilestones.length) continue;
    if (projects.length > 1) {
      await tx.insert(s.invoiceLines).values({
        tenantId: p.tenantId,
        invoiceId: invoice.id,
        sort: sort++,
        kind: "heading",
        description: `${project.number} ${project.name}`,
        projectId: project.id,
      });
    }
    for (const m of projMilestones) {
      const [line] = await tx
        .insert(s.invoiceLines)
        .values({
          tenantId: p.tenantId,
          invoiceId: invoice.id,
          sort: sort++,
          kind: "milestone",
          description: m.description,
          quantity: 1,
          unitPrice: m.amount,
          amount: m.amount,
          originalAmount: m.amount,
          vatBp: DANISH_VAT_BP,
          projectId: project.id,
          paymentPlanItemId: m.id,
        })
        .returning();
      await tx
        .update(s.paymentPlanItems)
        .set({ invoiceLineId: line?.id })
        .where(eq(s.paymentPlanItems.id, m.id));
    }
    for (const l of buildTimeLines(projEntries, p.grouping)) {
      const [line] = await tx
        .insert(s.invoiceLines)
        .values({
          tenantId: p.tenantId,
          invoiceId: invoice.id,
          sort: sort++,
          kind: "time",
          description: l.description,
          quantity: l.quantity / 100,
          unitPrice: l.unitPrice,
          amount: l.amount,
          originalAmount: l.amount,
          vatBp: DANISH_VAT_BP,
          projectId: project.id,
        })
        .returning();
      if (!line) continue;
      await tx.insert(s.invoiceLineSources).values(
        l.sources.map((src) => ({
          tenantId: p.tenantId,
          invoiceLineId: line.id,
          timeEntryId: src.entryId,
          hours: src.hours / 100,
          value: src.value,
          invoiced: src.invoiced,
        })),
      );
      await tx
        .update(s.timeEntries)
        .set({ invoiceLineId: line.id })
        .where(
          inArray(
            s.timeEntries.id,
            l.sources.map((x) => x.entryId),
          ),
        );
    }
  }
  await recalcInvoice(tx, invoice.id);
  await writeAudit(tx, {
    tenantId: p.tenantId,
    entity: "invoice",
    entityId: invoice.id,
    action: "create",
    userId: p.userId,
    after: { customerId: p.customerId, projectIds: p.projectIds, grouping: p.grouping },
  });
  return invoice.id;
}

export async function loadInvoice(tx: Tx, invoiceId: string) {
  const [inv] = await tx.select().from(s.invoices).where(eq(s.invoices.id, invoiceId));
  if (!inv) throw new InvoiceError("not_found", 404);
  return inv;
}

async function assertEditable(tx: Tx, invoiceId: string) {
  const inv = await loadInvoice(tx, invoiceId);
  if (inv.status === "booked") throw new InvoiceError("invoice_booked");
  return inv;
}

export async function recalcInvoice(tx: Tx, invoiceId: string) {
  const lines = await tx.select().from(s.invoiceLines).where(eq(s.invoiceLines.invoiceId, invoiceId));
  const t = invoiceTotals(
    lines.filter((l) => AMOUNT_KINDS.has(l.kind)).map((l) => ({ amount: l.amount, vatBp: l.vatBp })),
  );
  await tx
    .update(s.invoices)
    .set({ subtotal: t.subtotal, vat: t.vat, total: t.total, updatedAt: new Date() })
    .where(eq(s.invoices.id, invoiceId));
  return t;
}

export interface LineUpdate {
  description?: string;
  quantity?: number;
  unitPrice?: number;
  discountBp?: number;
  vatBp?: number;
  /** explicit new amount (write-down/up); spread over the line's time entries */
  amount?: number;
  writeReason?: string | null;
}

export async function updateLine(tx: Tx, tenantId: string, userId: string, lineId: string, u: LineUpdate) {
  const [line] = await tx.select().from(s.invoiceLines).where(eq(s.invoiceLines.id, lineId));
  if (!line) throw new InvoiceError("not_found", 404);
  await assertEditable(tx, line.invoiceId);
  const sources = await tx
    .select()
    .from(s.invoiceLineSources)
    .where(eq(s.invoiceLineSources.invoiceLineId, lineId));
  const next = {
    ...line,
    ...Object.fromEntries(Object.entries(u).filter(([, v]) => v !== undefined)),
  } as typeof line;
  if (AMOUNT_KINDS.has(line.kind)) {
    if (u.amount !== undefined) next.amount = u.amount;
    else if (u.quantity !== undefined || u.unitPrice !== undefined || u.discountBp !== undefined) {
      next.amount = lineAmount(Math.round(next.quantity * 100), next.unitPrice, next.discountBp);
    }
    const original = line.originalAmount ?? line.amount;
    if (next.amount !== original && !(u.writeReason ?? line.writeReason)?.trim() && sources.length) {
      throw new InvoiceError("write_reason_required", 422);
    }
    if (sources.length && next.amount !== line.amount) {
      const spread = spreadAmount(
        sources.map((x) => ({
          entryId: x.id,
          hours: fromDecimal(x.hours),
          value: x.value,
          invoiced: x.invoiced,
        })),
        next.amount,
      );
      for (const sp of spread)
        await tx
          .update(s.invoiceLineSources)
          .set({ invoiced: sp.invoiced })
          .where(eq(s.invoiceLineSources.id, sp.entryId));
    }
  }
  await tx
    .update(s.invoiceLines)
    .set({
      description: next.description,
      quantity: next.quantity,
      unitPrice: next.unitPrice,
      discountBp: next.discountBp,
      vatBp: next.vatBp,
      amount: next.amount,
      writeReason: u.writeReason ?? line.writeReason,
    })
    .where(eq(s.invoiceLines.id, lineId));
  await recalcInvoice(tx, line.invoiceId);
  await writeAudit(tx, {
    tenantId,
    entity: "invoice_line",
    entityId: lineId,
    action: "update",
    userId,
    before: line,
    after: next,
    reason: u.writeReason ?? null,
  });
}

export async function addFreeLine(
  tx: Tx,
  tenantId: string,
  invoiceId: string,
  l: {
    kind: "product" | "text" | "heading" | "subtotal";
    description: string;
    quantity?: number;
    unitPrice?: number;
    vatBp?: number;
  },
) {
  await assertEditable(tx, invoiceId);
  const [{ max } = { max: -1 }] = await tx
    .select({ max: sql<number>`coalesce(max(${s.invoiceLines.sort}), -1)` })
    .from(s.invoiceLines)
    .where(eq(s.invoiceLines.invoiceId, invoiceId));
  const quantity = l.quantity ?? (l.kind === "product" ? 1 : 0);
  const unitPrice = l.unitPrice ?? 0;
  await tx.insert(s.invoiceLines).values({
    tenantId,
    invoiceId,
    sort: Number(max) + 1,
    kind: l.kind,
    description: l.description,
    quantity,
    unitPrice,
    amount: l.kind === "product" ? lineAmount(Math.round(quantity * 100), unitPrice) : 0,
    vatBp: l.vatBp ?? DANISH_VAT_BP,
  });
  await recalcInvoice(tx, invoiceId);
}

async function releaseLines(tx: Tx, lineIds: string[]) {
  if (!lineIds.length) return;
  await tx
    .update(s.timeEntries)
    .set({ invoiceLineId: null })
    .where(inArray(s.timeEntries.invoiceLineId, lineIds));
  await tx
    .update(s.paymentPlanItems)
    .set({ invoiceLineId: null })
    .where(inArray(s.paymentPlanItems.invoiceLineId, lineIds));
}

export async function deleteLine(tx: Tx, lineId: string) {
  const [line] = await tx.select().from(s.invoiceLines).where(eq(s.invoiceLines.id, lineId));
  if (!line) throw new InvoiceError("not_found", 404);
  await assertEditable(tx, line.invoiceId);
  await releaseLines(tx, [lineId]);
  await tx.delete(s.invoiceLines).where(eq(s.invoiceLines.id, lineId));
  await recalcInvoice(tx, line.invoiceId);
}

export async function deleteDraft(tx: Tx, tenantId: string, userId: string, invoiceId: string) {
  const inv = await assertEditable(tx, invoiceId);
  const lines = await tx
    .select({ id: s.invoiceLines.id })
    .from(s.invoiceLines)
    .where(eq(s.invoiceLines.invoiceId, invoiceId));
  await releaseLines(
    tx,
    lines.map((l) => l.id),
  );
  await tx.delete(s.invoices).where(eq(s.invoices.id, invoiceId));
  await writeAudit(tx, {
    tenantId,
    entity: "invoice",
    entityId: invoiceId,
    action: "delete",
    userId,
    before: inv,
  });
}

/**
 * Books an invoice (D-015): locks the legal entity's counter row, takes the next number, marks sources invoiced,
 * writes audit + outbox — all in the caller's transaction. If anything fails the whole transaction rolls back,
 * including the counter, so numbers are never skipped or reused.
 */
export async function bookInvoice(
  tx: Tx,
  tenantId: string,
  userId: string,
  invoiceId: string,
): Promise<number> {
  const inv = await assertEditable(tx, invoiceId);
  const lines = await tx.select().from(s.invoiceLines).where(eq(s.invoiceLines.invoiceId, invoiceId));
  if (!lines.some((l) => AMOUNT_KINDS.has(l.kind))) throw new InvoiceError("invoice_empty", 422);
  if (isLocked(inv.invoiceDate, await closedMonths(tx))) throw new InvoiceError("period_closed");

  await tx
    .insert(s.numberSeries)
    .values({ tenantId, legalEntityId: inv.legalEntityId, kind: "invoice" })
    .onConflictDoNothing();
  const locked = await tx.execute<{ id: string; next_number: number }>(
    sql`select id, next_number from number_series where legal_entity_id = ${inv.legalEntityId} and kind = 'invoice' for update`,
  );
  const series = locked[0];
  if (!series) throw new InvoiceError("number_series_missing", 500);
  const number = Number(series.next_number);
  await tx
    .update(s.numberSeries)
    .set({ nextNumber: number + 1 })
    .where(eq(s.numberSeries.id, series.id));

  await recalcInvoice(tx, invoiceId);
  await tx
    .update(s.invoices)
    .set({ status: "booked", number, bookedAt: new Date(), bookedBy: userId, updatedAt: new Date() })
    .where(eq(s.invoices.id, invoiceId));

  const lineIds = lines.map((l) => l.id);
  if (inv.type === "invoice") {
    await tx
      .update(s.timeEntries)
      .set({ status: "invoiced", updatedAt: new Date() })
      .where(inArray(s.timeEntries.invoiceLineId, lineIds));
    await tx
      .update(s.paymentPlanItems)
      .set({ status: "invoiced" })
      .where(inArray(s.paymentPlanItems.invoiceLineId, lineIds));
  } else if (inv.reopenSources) {
    // Credit note with "re-open": the credited lines' entries/milestones become invoiceable again.
    const toRelease = lines.flatMap((l) => (l.creditsLineId ? [l.creditsLineId] : []));
    if (toRelease.length) {
      await tx
        .update(s.timeEntries)
        .set({ status: "approved", invoiceLineId: null, updatedAt: new Date() })
        .where(inArray(s.timeEntries.invoiceLineId, toRelease));
      await tx
        .update(s.paymentPlanItems)
        .set({ status: "ready", invoiceLineId: null })
        .where(inArray(s.paymentPlanItems.invoiceLineId, toRelease));
    }
  }
  await tx.insert(s.outbox).values({ tenantId, kind: "invoice.booked", payload: { invoiceId, number } });
  await writeAudit(tx, {
    tenantId,
    entity: "invoice",
    entityId: invoiceId,
    action: "book",
    userId,
    before: { status: inv.status },
    after: { status: "booked", number },
  });
  return number;
}

/** Creates a draft credit note for a booked invoice: all lines, or the chosen ones, negated. */
export async function createCreditNote(
  tx: Tx,
  tenantId: string,
  userId: string,
  invoiceId: string,
  opts: { lineIds?: string[]; reopenSources: boolean; invoiceDate: LocalDate },
) {
  const inv = await loadInvoice(tx, invoiceId);
  if (inv.status !== "booked" || inv.type !== "invoice")
    throw new InvoiceError("only_booked_invoices_can_be_credited");
  const lines = (
    await tx
      .select()
      .from(s.invoiceLines)
      .where(eq(s.invoiceLines.invoiceId, invoiceId))
      .orderBy(asc(s.invoiceLines.sort))
  ).filter((l) => !opts.lineIds || opts.lineIds.includes(l.id));
  const [credit] = await tx
    .insert(s.invoices)
    .values({
      tenantId,
      legalEntityId: inv.legalEntityId,
      type: "credit",
      creditOfId: inv.id,
      reopenSources: opts.reopenSources,
      customerId: inv.customerId,
      projectId: inv.projectId,
      invoiceDate: opts.invoiceDate,
      dueDate: opts.invoiceDate,
      currency: inv.currency,
      fxRate: inv.fxRate,
      heading: `Kreditnota til faktura ${inv.number}`,
      createdBy: userId,
    })
    .returning();
  if (!credit) throw new InvoiceError("create_failed", 500);
  for (const l of lines) {
    await tx.insert(s.invoiceLines).values({
      tenantId,
      invoiceId: credit.id,
      sort: l.sort,
      kind: l.kind,
      description: l.description,
      quantity: -l.quantity,
      unitPrice: l.unitPrice,
      discountBp: l.discountBp,
      amount: -l.amount,
      vatBp: l.vatBp,
      projectId: l.projectId,
      creditsLineId: l.id,
    });
  }
  await recalcInvoice(tx, credit.id);
  await writeAudit(tx, {
    tenantId,
    entity: "invoice",
    entityId: credit.id,
    action: "create_credit",
    userId,
    after: { creditOf: inv.number, lines: lines.length, reopenSources: opts.reopenSources },
  });
  return credit.id;
}

/** True when a date may still be changed (its accounting month is open). */
export async function isDateOpen(tx: Tx, date: LocalDate): Promise<boolean> {
  return !(await closedMonths(tx)).has(monthOf(date));
}
