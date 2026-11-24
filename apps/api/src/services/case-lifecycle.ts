/**
 * The end of a case's life (D-041): closing a phase when its work is done, and completing the whole case once
 * everything is approved and invoiced. GRASP Information Expert for "what is still open on this case".
 *
 *   Afslut fase   project manager, Finance or Admin. Closes the phase and everything under it: no new hours, gone
 *                 from Min uge, and its instalment becomes klar at once (billing-plan rule "phase done"). Refused
 *                 while someone has unsubmitted hours on it (they could no longer correct them). Genåbn reverses it.
 *   Afslut sag    Admin only (like creating a case, D-040), and only when nothing is left: no hours or expenses
 *                 waiting for approval or invoicing, no instalments left, no re-invoiced sub-consultant invoices
 *                 left and no draft invoices. The case then disappears from Min uge; all history is kept. Unpaid
 *                 invoices do not block it (they stay on the Debitorliste). Genåbn sag sets it active again.
 */
import { schema, type Tx, writeAudit } from "@arc-tid/db";
import { hasRole } from "@arc-tid/domain";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import type { AuthContext } from "../auth/plugin.ts";
import { AppError } from "./errors.ts";
import { canEditProject } from "./projects.ts";

/** A phase (top-level task) with every task under it, by WBS ("2" covers "2", "2.1", "2.1.3" …). */
async function phaseTasks(tx: Tx, taskId: string) {
  const [phase] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
  if (!phase) throw new AppError(404, "not_found");
  if (phase.level !== 1) throw new AppError(422, "not_a_phase");
  const all = await tx
    .select({ id: schema.tasks.id, status: schema.tasks.status })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.projectId, phase.projectId),
        or(eq(schema.tasks.wbs, phase.wbs), like(schema.tasks.wbs, `${phase.wbs}.%`)),
      ),
    );
  return { phase, ids: all.map((t) => t.id) };
}

/** Closes (done) or reopens a phase and everything under it; audited. */
export async function setPhaseStatus(tx: Tx, auth: AuthContext, taskId: string, status: "open" | "closed") {
  const { phase, ids } = await phaseTasks(tx, taskId);
  if (!(await canEditProject(tx, auth, phase.projectId))) throw new AppError(403, "forbidden");
  if (status === "closed") {
    const [open] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.timeEntries)
      .where(
        and(
          inArray(schema.timeEntries.taskId, ids),
          sql`${schema.timeEntries.status} in ('draft', 'rejected')`,
        ),
      );
    if (open?.n) throw new AppError(422, "phase_has_open_hours", { count: open.n });
  }
  await tx.update(schema.tasks).set({ status }).where(inArray(schema.tasks.id, ids));
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "task",
    entityId: phase.id,
    action: status === "closed" ? "phase_close" : "phase_reopen",
    userId: auth.userId,
    before: { name: phase.name, status: phase.status },
    after: { name: phase.name, status, tasks: ids.length },
  });
  return { status, tasks: ids.length };
}

/** One thing that keeps a case from being completed, with a count (and an amount in øre where it helps). */
export interface CompletionBlocker {
  code:
    | "hours_not_approved"
    | "hours_not_invoiced"
    | "instalments_left"
    | "expenses_open"
    | "subinvoices_left"
    | "draft_invoices";
  count: number;
  amount?: number;
}

/** What is still open on a case, and the unpaid invoices (shown, but not blocking). */
export async function completionCheck(tx: Tx, auth: AuthContext, projectId: string) {
  const [p] = await tx
    .select({ status: schema.projects.status })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!p) throw new AppError(404, "not_found");
  const one = async (q: ReturnType<typeof sql>) => {
    const [r] = await tx.execute<{ n: number; amount: string | null }>(q);
    return { n: Number(r?.n ?? 0), amount: Number(r?.amount ?? 0) };
  };
  const notApproved = await one(sql`
    select count(*)::int as n, null as amount from time_entries
    where project_id = ${projectId} and status in ('draft', 'submitted', 'rejected')`);
  const notInvoiced = await one(sql`
    select count(*)::int as n, round(sum(e.hours * coalesce(e.sales_rate, 0))) as amount
    from time_entries e join tasks t on t.id = e.task_id join contracts k on k.id = t.contract_id
    where e.project_id = ${projectId} and e.status = 'approved' and e.billable and k.type = 'time_material'`);
  const instalments = await one(sql`
    select count(*)::int as n, sum(pi.amount) as amount
    from payment_plan_items pi join contracts k on k.id = pi.contract_id
    where k.project_id = ${projectId} and k.plan_active and pi.status <> 'invoiced'`);
  const expenses = await one(sql`
    select count(*)::int as n, null as amount from expenses
    where project_id = ${projectId}
      and (status in ('draft', 'submitted', 'rejected') or (status = 'approved' and billable))`);
  const subs = await one(sql`
    select count(*)::int as n, sum(amount) as amount from subconsultant_invoices
    where project_id = ${projectId} and rebill and not invoiced`);
  const drafts = await one(sql`
    select count(distinct i.id)::int as n, null as amount from invoices i
    left join invoice_lines l on l.invoice_id = i.id
    where i.status <> 'booked' and (i.project_id = ${projectId} or l.project_id = ${projectId})`);
  const unpaid = await one(sql`
    select count(*)::int as n, sum(i.total - coalesce(pay.paid, 0)) as amount
    from invoices i
    left join lateral (select sum(amount) as paid from invoice_payments where invoice_id = i.id) pay on true
    where i.status = 'booked' and i.type = 'invoice' and i.project_id = ${projectId}
      and i.total - coalesce(pay.paid, 0) > 0`);

  const blockers: CompletionBlocker[] = [];
  const add = (code: CompletionBlocker["code"], r: { n: number; amount: number }, withAmount = false) => {
    if (r.n > 0) blockers.push({ code, count: r.n, ...(withAmount ? { amount: r.amount } : {}) });
  };
  add("hours_not_approved", notApproved);
  add("hours_not_invoiced", notInvoiced, true);
  add("instalments_left", instalments, true);
  add("expenses_open", expenses);
  add("subinvoices_left", subs, true);
  add("draft_invoices", drafts);
  return {
    status: p.status,
    canComplete: hasRole(auth.roles, "admin"),
    blockers,
    unpaid: { count: unpaid.n, amount: unpaid.amount },
  };
}

/** Completes a case (Admin) when nothing is left; or sets a completed case active again. Audited. */
export async function setProjectStatus(
  tx: Tx,
  auth: AuthContext,
  projectId: string,
  status: "completed" | "active",
) {
  if (!hasRole(auth.roles, "admin")) throw new AppError(403, "forbidden");
  const check = await completionCheck(tx, auth, projectId);
  if (status === "completed") {
    if (check.status === "completed") return { status };
    if (check.blockers.length) throw new AppError(422, "case_not_done", { blockers: check.blockers });
  }
  await tx
    .update(schema.projects)
    .set({
      status,
      updatedAt: new Date(),
      ...(status === "completed" ? { endDate: sql`coalesce(end_date, current_date)` } : {}),
    })
    .where(eq(schema.projects.id, projectId));
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "project",
    entityId: projectId,
    action: status === "completed" ? "complete" : "reopen",
    userId: auth.userId,
    before: { status: check.status },
    after: { status },
  });
  return { status };
}
