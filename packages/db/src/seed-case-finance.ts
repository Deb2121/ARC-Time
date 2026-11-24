/**
 * Fictional seed for case finance (D-029, docs/demo/sagsokonomi.md) on top of the M2 money seed:
 *   - instalment percentages on the fixed-price plans, and ekstraarbejde flags on phases billed by the hour
 *     on a fixed-fee case (26008);
 *   - one instalment that is klar (its predecessor is invoiced and its planned date has just passed);
 *   - payments on older invoices, one invoice partly paid, recent invoices left overdue, and one reminder.
 * Idempotent: the plan/phase steps only fill in missing values, payments are added only while there are none.
 */
import { addDays, type LocalDate, percentOf } from "@arc-tid/domain";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "./client.ts";
import * as s from "./schema.ts";

/** Adds the case finance demo data. Returns true when anything was changed. */
export async function seedCaseFinance(tx: Tx, tenantId: string, today: LocalDate): Promise<boolean> {
  let changed = false;
  const contracts = await tx.select().from(s.contracts).where(eq(s.contracts.tenantId, tenantId));

  // 1. Percentages on fixed-price instalments (derived from the stored amounts).
  for (const c of contracts.filter((x) => x.type === "fixed_price" && x.price)) {
    const items = await tx
      .select()
      .from(s.paymentPlanItems)
      .where(and(eq(s.paymentPlanItems.contractId, c.id), isNull(s.paymentPlanItems.percentageBp)));
    for (const i of items) {
      const bp = Math.round((i.amount * 10_000) / (c.price ?? 1));
      if (percentOf(c.price ?? 0, bp) !== i.amount) continue; // not a whole share — keep it as an amount
      await tx.update(s.paymentPlanItems).set({ percentageBp: bp }).where(eq(s.paymentPlanItems.id, i.id));
      changed = true;
    }
  }

  // 2. Ekstraarbejde: phases on a time & material contract within a fixed-fee case.
  const fixedProjects = new Set(contracts.filter((c) => c.type !== "time_material").map((c) => c.projectId));
  const tmOnFixed = contracts.filter((c) => c.type === "time_material" && fixedProjects.has(c.projectId));
  if (tmOnFixed.length) {
    const res = await tx
      .update(s.tasks)
      .set({ extraWork: true })
      .where(
        and(
          inArray(
            s.tasks.contractId,
            tmOnFixed.map((c) => c.id),
          ),
          eq(s.tasks.extraWork, false),
        ),
      )
      .returning({ id: s.tasks.id });
    changed ||= res.length > 0;
  }

  // 3. One klar instalment: the first active fixed-price plan whose next instalment follows an invoiced one.
  const plans = contracts
    .filter((c) => c.type === "fixed_price" && c.planActive)
    .sort((a, b) => a.name.localeCompare(b.name, "da"));
  const hasReady = await anyReady(tx, plans, today);
  if (!hasReady)
    for (const c of plans) {
      const items = await tx
        .select()
        .from(s.paymentPlanItems)
        .where(eq(s.paymentPlanItems.contractId, c.id))
        .orderBy(asc(s.paymentPlanItems.sequence));
      const idx = items.findIndex((i) => i.status !== "invoiced");
      const next = items[idx];
      if (idx > 0 && next && !next.invoiceLineId && next.dueDate > today) {
        await tx
          .update(s.paymentPlanItems)
          .set({ dueDate: addDays(today, -3) })
          .where(eq(s.paymentPlanItems.id, next.id));
        changed = true;
        break;
      }
    }

  // 4. Payments and a reminder (only once).
  const [anyPayment] = await tx.select({ id: s.invoicePayments.id }).from(s.invoicePayments).limit(1);
  if (!anyPayment) changed = (await seedPayments(tx, tenantId, today)) || changed;
  return changed;
}

/** True when some active plan already has a klar instalment (previous invoiced, date passed, not drafted). */
async function anyReady(tx: Tx, plans: (typeof s.contracts.$inferSelect)[], today: LocalDate) {
  for (const c of plans) {
    const items = await tx
      .select()
      .from(s.paymentPlanItems)
      .where(eq(s.paymentPlanItems.contractId, c.id))
      .orderBy(asc(s.paymentPlanItems.sequence));
    const next = items.find((i) => i.status !== "invoiced");
    if (next && !next.invoiceLineId && next.dueDate <= today) return true;
  }
  return false;
}

/**
 * Older invoices are paid in full two days before their due date; the oldest invoice on the first fixed-fee case
 * with an ekstraarbejde phase is paid 40 %; invoices due within the last 30 days stay unpaid (overdue), and the
 * most overdue unpaid one has had its first reminder. Fully credited invoices are left alone.
 */
async function seedPayments(tx: Tx, tenantId: string, today: LocalDate): Promise<boolean> {
  const invoices = await tx.execute<{
    id: string;
    total: string;
    due_date: string;
    project_id: string | null;
    credited: string;
  }>(sql`
    select i.id, i.total, i.due_date, i.project_id,
      coalesce((select -sum(cn.total) from invoices cn where cn.credit_of_id = i.id and cn.status = 'booked'), 0) as credited
    from invoices i
    where i.tenant_id = ${tenantId} and i.status = 'booked' and i.type = 'invoice' and i.due_date < ${today}
    order by i.due_date, i.number`);
  const open = invoices.filter((i) => Number(i.credited) === 0);
  if (!open.length) return false;

  const extraCase = await tx
    .select({ projectId: s.tasks.projectId })
    .from(s.tasks)
    .where(and(eq(s.tasks.tenantId, tenantId), eq(s.tasks.extraWork, true)))
    .limit(1);
  const partial = open.find((i) => i.project_id === extraCase[0]?.projectId) ?? open[0];
  const cutoff = addDays(today, -30);
  const values: (typeof s.invoicePayments.$inferInsert)[] = [];
  for (const i of open) {
    if (i.id === partial?.id) {
      values.push({
        tenantId,
        invoiceId: i.id,
        paidOn: i.due_date,
        amount: percentOf(Number(i.total), 4000),
      });
    } else if (i.due_date < cutoff) {
      values.push({ tenantId, invoiceId: i.id, paidOn: addDays(i.due_date, -2), amount: Number(i.total) });
    }
  }
  if (values.length) await tx.insert(s.invoicePayments).values(values);

  const paidIds = new Set(values.map((v) => v.invoiceId));
  const overdue = open.find((i) => !paidIds.has(i.id));
  if (overdue)
    await tx
      .insert(s.invoiceReminders)
      .values({
        tenantId,
        invoiceId: overdue.id,
        level: 1,
        sentOn: addDays(overdue.due_date, 8) > today ? today : addDays(overdue.due_date, 8),
      })
      .onConflictDoNothing();
  return true;
}
