/**
 * Role-based home dashboard and reminders (brief §4.13, §4.6 reminders) — GRASP Pure Fabrication: gathers, per
 * role, the few things the person should act on ("to-dos") and the key figures they steer by. KPI formulas come
 * from @arc-tid/domain (`kpi.ts`, Information Expert). Reminders are computed live, so they are always correct and
 * need no storage; the same rules drive the weekly e-mail reminder (`services/reminders.ts`).
 */
import { schema, type Tx } from "@arc-tid/db";
import {
  addDays,
  billablePct,
  dailyNorm,
  effectiveRate,
  fromDecimal,
  hasRole,
  type LocalDate,
  lastDayOfMonth,
  monthOf,
  startOfIsoWeek,
  utilisation,
} from "@arc-tid/domain";
import { and, eq, gte, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { type AuthContext, policyOf } from "../auth/plugin.ts";
import { loadEmployee, normContext } from "./calendar.ts";
import { approveeIds, visibleUserIds } from "./people.ts";
import { projectSummaries } from "./projects.ts";

/** One item on the person's to-do list; `count`/`ref` fill the translated text, `href` is where to act. */
export interface Todo {
  kind:
    | "submit_last_week"
    | "week_rejected"
    | "expenses_rejected"
    | "expenses_draft"
    | "approve_timesheets"
    | "approve_expenses"
    | "project_budget"
    | "retainer_usage"
    | "book_invoices"
    | "close_month";
  href: string;
  count?: number;
  ref?: string;
  severity: "info" | "warning";
}

/** Week KPI row (decimals for the UI, basis points for percentages). */
export interface WeekKpi {
  weekStart: LocalDate;
  norm: number;
  work: number;
  billable: number;
  utilisationBp: number | null;
  billableBp: number | null;
}

/** Things the employee should do: submit last week, fix rejected weeks/expenses, submit expense drafts. */
async function employeeTodos(tx: Tx, auth: AuthContext, today: LocalDate): Promise<Todo[]> {
  const todos: Todo[] = [];
  const lastMonday = addDays(startOfIsoWeek(today), -7);
  const [last] = await tx
    .select({ status: schema.timesheetPeriods.status })
    .from(schema.timesheetPeriods)
    .where(
      and(eq(schema.timesheetPeriods.userId, auth.userId), eq(schema.timesheetPeriods.weekStart, lastMonday)),
    );
  const emp = await loadEmployee(tx, auth.userId);
  if (emp) {
    const ctx = await normContext(tx, emp);
    let norm = 0;
    for (let d = 0; d < 7; d++) norm += dailyNorm(addDays(lastMonday, d), ctx);
    if (norm > 0 && (!last || last.status === "open"))
      todos.push({
        kind: "submit_last_week",
        href: `/timesheet?week=${lastMonday}`,
        ref: lastMonday,
        severity: "warning",
      });
  }
  const rejected = await tx
    .select({ weekStart: schema.timesheetPeriods.weekStart })
    .from(schema.timesheetPeriods)
    .where(
      and(eq(schema.timesheetPeriods.userId, auth.userId), eq(schema.timesheetPeriods.status, "rejected")),
    );
  for (const r of rejected)
    todos.push({
      kind: "week_rejected",
      href: `/timesheet?week=${r.weekStart}`,
      ref: r.weekStart,
      severity: "warning",
    });
  const [exp] = await tx
    .select({
      rejected: sql<number>`count(*) filter (where ${schema.expenses.status} = 'rejected')::int`,
      drafts: sql<number>`count(*) filter (where ${schema.expenses.status} = 'draft')::int`,
    })
    .from(schema.expenses)
    .where(eq(schema.expenses.userId, auth.userId));
  if (exp?.rejected)
    todos.push({ kind: "expenses_rejected", href: "/expenses", count: exp.rejected, severity: "warning" });
  if (exp?.drafts)
    todos.push({ kind: "expenses_draft", href: "/expenses", count: exp.drafts, severity: "info" });
  return todos;
}

/** Approver to-dos: submitted timesheets and expenses waiting for the caller. */
async function approverTodos(tx: Tx, auth: AuthContext): Promise<Todo[]> {
  const ids = await approveeIds(tx, auth);
  const todos: Todo[] = [];
  if (ids.length) {
    const [ts] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.timesheetPeriods)
      .where(
        and(inArray(schema.timesheetPeriods.userId, ids), eq(schema.timesheetPeriods.status, "submitted")),
      );
    if (ts?.n) todos.push({ kind: "approve_timesheets", href: "/approval", count: ts.n, severity: "info" });
  }
  const financeAll = policyOf(auth).can("expense.approve_any");
  if (ids.length || financeAll) {
    const [ex] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.expenses)
      .where(
        and(
          eq(schema.expenses.status, "submitted"),
          financeAll ? ne(schema.expenses.userId, auth.userId) : inArray(schema.expenses.userId, ids),
        ),
      );
    if (ex?.n)
      todos.push({ kind: "approve_expenses", href: "/approval?tab=expenses", count: ex.n, severity: "info" });
  }
  return todos;
}

/** Project-manager to-dos: own projects at ≥ 90 % of budget and retainers at ≥ 80 % of this month's pool. */
async function projectManagerTodos(tx: Tx, auth: AuthContext, today: LocalDate): Promise<Todo[]> {
  const mine = await tx
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.managerId, auth.userId), eq(schema.projects.status, "active")));
  if (!mine.length) return [];
  const todos: Todo[] = [];
  for (const p of await projectSummaries(
    tx,
    mine.map((m) => m.id),
  )) {
    if (p.health === "warning" || p.health === "over")
      todos.push({
        kind: "project_budget",
        href: `/projects/${p.id}`,
        ref: `${p.number} ${p.name}`,
        count: Math.round((p.hoursConsumptionBp ?? 0) / 100),
        severity: p.health === "over" ? "warning" : "info",
      });
  }
  const month = monthOf(today);
  const retainers = await tx
    .select({
      id: schema.contracts.id,
      projectId: schema.projects.id,
      pool: schema.contracts.retainerHours,
      number: schema.projects.number,
      name: schema.projects.name,
    })
    .from(schema.contracts)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.contracts.projectId))
    .where(
      and(
        eq(schema.contracts.type, "retainer"),
        inArray(
          schema.projects.id,
          mine.map((m) => m.id),
        ),
        isNotNull(schema.contracts.retainerHours),
      ),
    );
  for (const r of retainers) {
    const [used] = await tx.execute<{ hours: string }>(sql`
      select coalesce(sum(e.hours), 0) as hours from time_entries e join tasks t on t.id = e.task_id
      where t.contract_id = ${r.id} and e.status <> 'rejected' and e.date between ${month} and ${lastDayOfMonth(month)}`);
    const pct = r.pool ? Math.round((Number(used?.hours ?? 0) / r.pool) * 100) : 0;
    if (pct >= 80)
      todos.push({
        kind: "retainer_usage",
        href: `/projects/${r.projectId}`,
        ref: `${r.number} ${r.name}`,
        count: pct,
        severity: pct >= 100 ? "warning" : "info",
      });
  }
  return todos;
}

/** Finance to-dos: invoices marked ready for booking, and last month still open after the 5th. */
async function financeTodos(tx: Tx, today: LocalDate): Promise<Todo[]> {
  const todos: Todo[] = [];
  const [ready] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.invoices)
    .where(eq(schema.invoices.status, "ready"));
  if (ready?.n)
    todos.push({ kind: "book_invoices", href: "/invoicing?tab=drafts", count: ready.n, severity: "info" });
  const lastMonth = monthOf(addDays(monthOf(today), -1));
  const [open] = await tx
    .select({ id: schema.accountingPeriods.id })
    .from(schema.accountingPeriods)
    .where(and(eq(schema.accountingPeriods.month, lastMonth), eq(schema.accountingPeriods.status, "open")));
  if (open && Number(today.slice(8, 10)) > 5)
    todos.push({ kind: "close_month", href: "/periods", ref: lastMonth, severity: "warning" });
  return todos;
}

/**
 * Weekly utilisation and billable % for the given people over `weeks` complete ISO weeks before the current one
 * (approved and submitted hours count; drafts are still being written).
 */
async function weeklyKpis(tx: Tx, userIds: string[], today: LocalDate, weeks: number): Promise<WeekKpi[]> {
  const end = addDays(startOfIsoWeek(today), -1);
  const start = addDays(startOfIsoWeek(today), -7 * weeks);
  const rows = await tx
    .select({
      userId: schema.timeEntries.userId,
      date: schema.timeEntries.date,
      hours: schema.timeEntries.hours,
      billable: schema.timeEntries.billable,
    })
    .from(schema.timeEntries)
    .where(
      and(
        inArray(schema.timeEntries.userId, userIds),
        isNotNull(schema.timeEntries.taskId),
        gte(schema.timeEntries.date, start),
        lte(schema.timeEntries.date, end),
        inArray(schema.timeEntries.status, ["submitted", "approved", "invoiced"]),
      ),
    );
  const norms = new Map<string, Map<LocalDate, number>>();
  for (const id of userIds) {
    const emp = await loadEmployee(tx, id);
    if (!emp) continue;
    const ctx = await normContext(tx, emp);
    const perDay = new Map<LocalDate, number>();
    for (let d = start; d <= end; d = addDays(d, 1)) perDay.set(d, dailyNorm(d, ctx));
    norms.set(id, perDay);
  }
  const out: WeekKpi[] = [];
  for (let w = start; w <= end; w = addDays(w, 7)) {
    const sunday = addDays(w, 6);
    let norm = 0;
    for (const perDay of norms.values())
      for (let d = w; d <= sunday; d = addDays(d, 1)) norm += perDay.get(d) ?? 0;
    const inWeek = rows.filter((r) => r.date >= w && r.date <= sunday);
    const work = inWeek.reduce((a, r) => a + fromDecimal(r.hours), 0);
    const billable = inWeek.filter((r) => r.billable).reduce((a, r) => a + fromDecimal(r.hours), 0);
    out.push({
      weekStart: w,
      norm: norm / 100,
      work: work / 100,
      billable: billable / 100,
      utilisationBp: utilisation(billable, norm),
      billableBp: billablePct(billable, work),
    });
  }
  return out;
}

/** Invoiced revenue (booked invoices and credit notes, excl. VAT) and the hours on them, for a month. */
async function monthRevenue(tx: Tx, month: LocalDate) {
  const [r] = await tx.execute<{ revenue: string; hours: string }>(sql`
    select coalesce(sum(i.subtotal), 0) as revenue,
      coalesce((select sum(s.hours) from invoice_line_sources s join invoice_lines l on l.id = s.invoice_line_id
        join invoices i2 on i2.id = l.invoice_id
        where i2.status = 'booked' and i2.type = 'invoice' and i2.invoice_date between ${month} and ${lastDayOfMonth(month)}), 0) as hours
    from invoices i where i.status = 'booked' and i.invoice_date between ${month} and ${lastDayOfMonth(month)}`);
  const revenue = Number(r?.revenue ?? 0);
  const hours = fromDecimal(Number(r?.hours ?? 0));
  return { month, revenue, invoicedHours: hours / 100, effectiveRate: effectiveRate(revenue, hours) };
}

/**
 * The dashboard for the signed-in person: their to-dos (by role) and, for line managers, Finance, Management and
 * Admin, key figures — weekly utilisation/billable % for the people they may see (12 weeks), and invoiced revenue
 * with effective hourly rate for this and last month (Finance/Management/Admin only).
 */
export async function dashboard(tx: Tx, auth: AuthContext, today: LocalDate) {
  const todos = [...(await employeeTodos(tx, auth, today))];
  if (hasRole(auth.roles, "line_manager", "finance", "admin")) todos.push(...(await approverTodos(tx, auth)));
  if (hasRole(auth.roles, "project_manager")) todos.push(...(await projectManagerTodos(tx, auth, today)));
  if (policyOf(auth).can("invoice.book")) todos.push(...(await financeTodos(tx, today)));

  let kpis: {
    scope: "team" | "company";
    weeks: WeekKpi[];
    revenue: Awaited<ReturnType<typeof monthRevenue>>[];
  } | null = null;
  if (hasRole(auth.roles, "line_manager", "finance", "admin", "management")) {
    const visible = await visibleUserIds(tx, auth);
    const ids =
      visible === "all"
        ? (
            await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.active, true))
          ).map((u) => u.id)
        : visible;
    const company = visible === "all";
    kpis = {
      scope: company ? "company" : "team",
      weeks: await weeklyKpis(tx, ids, today, 12),
      revenue:
        company && hasRole(auth.roles, "finance", "admin", "management")
          ? [
              await monthRevenue(tx, monthOf(addDays(monthOf(today), -1))),
              await monthRevenue(tx, monthOf(today)),
            ]
          : [],
    };
  }
  return { today, todos, kpis };
}
