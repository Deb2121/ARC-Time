/**
 * Accounting periods and month-end figures (brief §4.11, docs/spec/accounting-periods.md).
 * Monthly per legal entity, open → closed, closed in order. Closing locks time entries and invoices dated in the
 * month for everyone, and snapshots fixed-price revenue recognition.
 */
import {
  addDays,
  completionBasisPoints,
  deferredRevenue,
  fromDecimal,
  type LocalDate,
  lastDayOfMonth,
  monthOf,
  recognisedRevenue,
  recognitionDelta,
} from "@arc-tid/domain";
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import { writeAudit } from "./audit.ts";
import type { Tx } from "./client.ts";
import * as s from "./schema.ts";

export class PeriodError extends Error {
  constructor(
    public code: string,
    public status = 409,
  ) {
    super(code);
  }
}

/** Makes sure a period row exists for every month from `fromMonth` to `toMonth`. */
export async function ensurePeriods(
  tx: Tx,
  tenantId: string,
  legalEntityId: string,
  fromMonth: LocalDate,
  toMonth: LocalDate,
) {
  for (let m = monthOf(fromMonth); m <= monthOf(toMonth); m = monthOf(addDays(lastDayOfMonth(m), 1))) {
    await tx.insert(s.accountingPeriods).values({ tenantId, legalEntityId, month: m }).onConflictDoNothing();
  }
}

export interface FixedPriceLine {
  contractId: string;
  projectNumber: string;
  projectName: string;
  price: number;
  completionBp: number;
  recognisedToDate: number;
  previouslyRecognised: number;
  recognisedThisMonth: number;
  invoicedToDate: number;
  /** recognised − invoiced: positive = work in progress, negative = invoiced ahead (deferred) */
  balance: number;
}

export interface MonthEndReport {
  month: LocalDate;
  wipTimeMaterial: number;
  wipByProject: { projectNumber: string; projectName: string; hours: number; value: number }[];
  fixedPrice: FixedPriceLine[];
  retainers: {
    contractId: string;
    projectNumber: string;
    projectName: string;
    invoiced: number;
    usedHours: number;
    poolHours: number;
    deferred: number;
  }[];
}

export async function monthEndReport(tx: Tx, month: LocalDate): Promise<MonthEndReport> {
  const end = lastDayOfMonth(month);

  // WIP on T&M: approved billable value not yet on a booked invoice, dated up to month end.
  const wip = await tx.execute<{ number: string; name: string; hours: string; value: string }>(sql`
    select p.number, p.name, sum(e.hours) as hours, round(sum(e.hours * coalesce(e.sales_rate, 0))) as value
    from time_entries e
    join tasks t on t.id = e.task_id
    join contracts c on c.id = t.contract_id
    join projects p on p.id = e.project_id
    left join invoice_lines l on l.id = e.invoice_line_id
    left join invoices i on i.id = l.invoice_id
    where c.type = 'time_material' and e.billable and e.status in ('approved', 'invoiced') and e.date <= ${end}
      and (e.invoice_line_id is null or i.status <> 'booked' or i.invoice_date > ${end})
    group by p.number, p.name
    order by p.number`);

  const contracts = await tx
    .select({
      id: s.contracts.id,
      type: s.contracts.type,
      price: s.contracts.price,
      retainerHours: s.contracts.retainerHours,
      number: s.projects.number,
      name: s.projects.name,
    })
    .from(s.contracts)
    .innerJoin(s.projects, eq(s.projects.id, s.contracts.projectId))
    .orderBy(asc(s.projects.number));

  const fixedPrice: FixedPriceLine[] = [];
  const retainers: MonthEndReport["retainers"] = [];
  for (const c of contracts) {
    if (c.type === "fixed_price" && c.price) {
      const [budget] = await tx
        .select({ hours: sql<string>`coalesce(sum(${s.tasks.budgetHours}), 0)` })
        .from(s.tasks)
        .where(and(eq(s.tasks.contractId, c.id), eq(s.tasks.level, 1)));
      const [used] = await tx.execute<{ hours: string }>(sql`
        select coalesce(sum(e.hours), 0) as hours from time_entries e join tasks t on t.id = e.task_id
        where t.contract_id = ${c.id} and e.status <> 'rejected' and e.date <= ${end}`);
      const completionBp = completionBasisPoints(
        fromDecimal(Number(used?.hours ?? 0)),
        fromDecimal(Number(budget?.hours ?? 0)),
      );
      const recognisedToDate = recognisedRevenue(c.price, completionBp);
      const [prev] = await tx
        .select({ v: s.revenueRecognitions.recognisedToDate })
        .from(s.revenueRecognitions)
        .where(and(eq(s.revenueRecognitions.contractId, c.id), lt(s.revenueRecognitions.month, month)))
        .orderBy(desc(s.revenueRecognitions.month))
        .limit(1);
      const [inv] = await tx.execute<{ amount: string }>(sql`
        select coalesce(sum(l.amount), 0) as amount from invoice_lines l
        join invoices i on i.id = l.invoice_id
        join payment_plan_items pi on pi.id = coalesce(l.payment_plan_item_id, (select l2.payment_plan_item_id from invoice_lines l2 where l2.id = l.credits_line_id))
        where pi.contract_id = ${c.id} and i.status = 'booked' and i.invoice_date <= ${end}`);
      // Milestones invoiced in the previous system before go-live have no invoice line but still count.
      const [legacy] = await tx.execute<{ amount: string }>(sql`
        select coalesce(sum(amount), 0) as amount from payment_plan_items
        where contract_id = ${c.id} and status = 'invoiced' and invoice_line_id is null and due_date <= ${end}`);
      const invoicedToDate = Number(inv?.amount ?? 0) + Number(legacy?.amount ?? 0);
      const previouslyRecognised = prev?.v ?? 0;
      fixedPrice.push({
        contractId: c.id,
        projectNumber: c.number,
        projectName: c.name,
        price: c.price,
        completionBp,
        recognisedToDate,
        previouslyRecognised,
        recognisedThisMonth: recognitionDelta(recognisedToDate, previouslyRecognised),
        invoicedToDate,
        balance: recognisedToDate - invoicedToDate,
      });
    }
    if (c.type === "retainer" && c.retainerHours) {
      const [inv] = await tx.execute<{ amount: string }>(sql`
        select coalesce(sum(l.amount), 0) as amount from invoice_lines l
        join invoices i on i.id = l.invoice_id
        join payment_plan_items pi on pi.id = l.payment_plan_item_id
        where pi.contract_id = ${c.id} and i.status = 'booked' and pi.due_date between ${month} and ${end}`);
      const [used] = await tx.execute<{ hours: string }>(sql`
        select coalesce(sum(e.hours), 0) as hours from time_entries e join tasks t on t.id = e.task_id
        where t.contract_id = ${c.id} and e.status <> 'rejected' and e.date between ${month} and ${end}`);
      const invoiced = Number(inv?.amount ?? 0);
      const usedHours = Number(used?.hours ?? 0);
      retainers.push({
        contractId: c.id,
        projectNumber: c.number,
        projectName: c.name,
        invoiced,
        usedHours,
        poolHours: c.retainerHours,
        deferred: deferredRevenue(invoiced, fromDecimal(usedHours), fromDecimal(c.retainerHours)),
      });
    }
  }

  const wipByProject = wip.map((w) => ({
    projectNumber: w.number,
    projectName: w.name,
    hours: Number(w.hours),
    value: Number(w.value),
  }));
  return {
    month,
    wipTimeMaterial: wipByProject.reduce((a, w) => a + w.value, 0),
    wipByProject,
    fixedPrice,
    retainers,
  };
}

export interface CloseResult {
  closed: boolean;
  warnings: { code: string; count: number }[];
}

/** Pre-close checklist: unapproved timesheets and unbooked invoices dated in the month. */
export async function closeChecklist(tx: Tx, month: LocalDate) {
  const end = lastDayOfMonth(month);
  const [unapproved] = await tx.execute<{ n: string }>(sql`
    select count(distinct (e.user_id, date_trunc('week', e.date))) as n from time_entries e
    where e.date between ${month} and ${end} and e.status in ('draft', 'submitted', 'rejected')`);
  const [drafts] = await tx.execute<{ n: string }>(sql`
    select count(*) as n from invoices where status <> 'booked' and invoice_date between ${month} and ${end}`);
  return [
    { code: "unapproved_timesheets", count: Number(unapproved?.n ?? 0) },
    { code: "unbooked_invoices", count: Number(drafts?.n ?? 0) },
  ].filter((w) => w.count > 0);
}

export async function closeMonth(
  tx: Tx,
  tenantId: string,
  userId: string,
  periodId: string,
  acknowledge: boolean,
): Promise<CloseResult> {
  const [p] = await tx.select().from(s.accountingPeriods).where(eq(s.accountingPeriods.id, periodId));
  if (!p) throw new PeriodError("not_found", 404);
  if (p.status === "closed") throw new PeriodError("already_closed");
  const [earlierOpen] = await tx
    .select({ id: s.accountingPeriods.id })
    .from(s.accountingPeriods)
    .where(
      and(
        eq(s.accountingPeriods.legalEntityId, p.legalEntityId),
        eq(s.accountingPeriods.status, "open"),
        lt(s.accountingPeriods.month, p.month),
      ),
    )
    .limit(1);
  if (earlierOpen) throw new PeriodError("earlier_period_open");
  const warnings = await closeChecklist(tx, p.month);
  if (warnings.length && !acknowledge) return { closed: false, warnings };

  const report = await monthEndReport(tx, p.month);
  for (const f of report.fixedPrice) {
    await tx
      .insert(s.revenueRecognitions)
      .values({
        tenantId,
        contractId: f.contractId,
        month: p.month,
        completionBp: f.completionBp,
        recognisedToDate: f.recognisedToDate,
        delta: f.recognisedThisMonth,
      })
      .onConflictDoNothing();
  }
  await tx
    .update(s.accountingPeriods)
    .set({ status: "closed", closedAt: new Date(), closedBy: userId })
    .where(eq(s.accountingPeriods.id, p.id));
  await tx
    .insert(s.outbox)
    .values({ tenantId, kind: "period.closed", payload: { month: p.month, legalEntityId: p.legalEntityId } });
  await writeAudit(tx, {
    tenantId,
    entity: "accounting_period",
    entityId: p.id,
    action: "close",
    userId,
    before: { status: "open" },
    after: { status: "closed", warnings },
    reason: warnings.length ? "closed with acknowledged warnings" : null,
  });
  return { closed: true, warnings };
}

/** Reopens the most recently closed month only (audited). */
export async function reopenMonth(
  tx: Tx,
  tenantId: string,
  userId: string,
  periodId: string,
  reason: string,
) {
  const [p] = await tx.select().from(s.accountingPeriods).where(eq(s.accountingPeriods.id, periodId));
  if (!p) throw new PeriodError("not_found", 404);
  if (p.status !== "closed") throw new PeriodError("not_closed");
  const [later] = await tx
    .select({ id: s.accountingPeriods.id })
    .from(s.accountingPeriods)
    .where(
      and(
        eq(s.accountingPeriods.legalEntityId, p.legalEntityId),
        eq(s.accountingPeriods.status, "closed"),
        sql`${s.accountingPeriods.month} > ${p.month}`,
      ),
    )
    .limit(1);
  if (later) throw new PeriodError("later_period_closed");
  await tx.delete(s.revenueRecognitions).where(eq(s.revenueRecognitions.month, p.month));
  await tx
    .update(s.accountingPeriods)
    .set({ status: "open", closedAt: null, closedBy: null })
    .where(eq(s.accountingPeriods.id, p.id));
  await writeAudit(tx, {
    tenantId,
    entity: "accounting_period",
    entityId: p.id,
    action: "reopen",
    userId,
    before: { status: "closed" },
    after: { status: "open" },
    reason,
  });
}
