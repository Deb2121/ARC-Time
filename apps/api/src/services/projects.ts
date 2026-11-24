/**
 * Project scope and budget-vs-actual aggregation (docs/spec/projects.md, reporting.md).
 */
import { schema, type Tx } from "@arc-tid/db";
import {
  type BudgetThresholds,
  budgetActual,
  completionBasisPoints,
  fromDecimal,
  hasRole,
  recognisedRevenue,
} from "@arc-tid/domain";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { AuthContext } from "../auth/plugin.ts";

/** Projects the caller may see: all (admin/finance/management), otherwise managed + member projects. */
export async function visibleProjectIds(tx: Tx, auth: AuthContext): Promise<string[] | "all"> {
  if (hasRole(auth.roles, "admin", "finance", "management")) return "all";
  const rows = await tx
    .selectDistinct({ id: schema.projects.id })
    .from(schema.projects)
    .leftJoin(schema.projectMembers, eq(schema.projectMembers.projectId, schema.projects.id))
    .where(or(eq(schema.projects.managerId, auth.userId), eq(schema.projectMembers.userId, auth.userId)));
  return rows.map((r) => r.id);
}

/** True if the caller may change the project: Admin/Finance, or its project manager. */
export async function canEditProject(tx: Tx, auth: AuthContext, projectId: string): Promise<boolean> {
  if (hasRole(auth.roles, "admin", "finance")) return true;
  const [p] = await tx
    .select({ managerId: schema.projects.managerId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  return p?.managerId === auth.userId;
}

export interface TaskActual {
  taskId: string;
  usedHours: number; // centi-hours
  usedValue: number; // øre
  usedCost: number; // øre
}

/**
 * Actuals per task. Value uses the approval snapshot when present, otherwise an estimate: the member's own price on
 * the case (D-038), then the contract rate, then the employee's default rate; rejected entries are excluded.
 */
export async function taskActuals(tx: Tx, projectIds: string[]): Promise<Map<string, TaskActual>> {
  if (!projectIds.length) return new Map();
  const rows = await tx.execute<{
    task_id: string;
    used_hours: string;
    used_value: string;
    used_cost: string;
  }>(sql`
    select time_entries.task_id,
      sum(time_entries.hours) as used_hours,
      round(sum(case when time_entries.billable
        then time_entries.hours * coalesce(time_entries.sales_rate,
          (select r.rate from project_employee_rates r
          where r.project_id = time_entries.project_id and r.user_id = time_entries.user_id and r.valid_from <= time_entries.date
          order by r.valid_from desc limit 1),
          c.hourly_rate, u.sales_rate) else 0 end)) as used_value,
      round(sum(time_entries.hours * coalesce(time_entries.cost_rate, u.cost_rate))) as used_cost
    from time_entries
    join users u on u.id = time_entries.user_id
    join tasks t on t.id = time_entries.task_id
    left join contracts c on c.id = t.contract_id
    where ${inArray(schema.timeEntries.projectId, projectIds)}
      and time_entries.status <> 'rejected'
    group by time_entries.task_id`);
  return new Map(
    rows.map((r) => [
      r.task_id,
      {
        taskId: r.task_id,
        usedHours: fromDecimal(Number(r.used_hours)),
        usedValue: Number(r.used_value),
        usedCost: Number(r.used_cost),
      },
    ]),
  );
}

/**
 * Budget warning thresholds: the same fee thresholds Finance sets for Sagsøkonomi (default 75 % / 100 %), so the
 * project list and Sagsøkonomi always give the same signal for the same project (D-032).
 */
export async function budgetThresholds(tx: Tx): Promise<BudgetThresholds> {
  const [t] = await tx
    .select({ warningBp: schema.tenants.feeWarningBp, alertBp: schema.tenants.feeAlertBp })
    .from(schema.tenants);
  return t ?? { warningBp: 7_500, alertBp: 10_000 };
}

/**
 * Project list rows with budget vs actual (hours, value, cost, margin, health) for the given ids or all projects,
 * plus how many phases (top-level tasks, rolled up) are over their own budget and the warning threshold used.
 */
export async function projectSummaries(tx: Tx, projectIds: string[] | "all") {
  const where =
    projectIds === "all"
      ? undefined
      : inArray(
          schema.projects.id,
          projectIds.length ? projectIds : ["00000000-0000-0000-0000-000000000000"],
        );
  const projects = await tx
    .select({
      id: schema.projects.id,
      number: schema.projects.number,
      name: schema.projects.name,
      status: schema.projects.status,
      category: schema.projects.category,
      billable: schema.projects.billable,
      customerId: schema.projects.customerId,
      customerName: schema.customers.name,
      managerId: schema.projects.managerId,
      managerName: schema.users.fullName,
      managerInitials: schema.users.initials,
      startDate: schema.projects.startDate,
      endDate: schema.projects.endDate,
    })
    .from(schema.projects)
    .leftJoin(schema.customers, eq(schema.customers.id, schema.projects.customerId))
    .leftJoin(schema.users, eq(schema.users.id, schema.projects.managerId))
    .where(where)
    .orderBy(schema.projects.number);
  const ids = projects.map((p) => p.id);
  if (!ids.length) return [];
  const tasks = await tx.select().from(schema.tasks).where(inArray(schema.tasks.projectId, ids));
  const contracts = await tx.select().from(schema.contracts).where(inArray(schema.contracts.projectId, ids));
  const actuals = await taskActuals(tx, ids);
  const limits = await budgetThresholds(tx);
  const usedOf = (list: typeof tasks) =>
    list.reduce(
      (acc, t) => {
        const a = actuals.get(t.id);
        return a ? { h: acc.h + a.usedHours, v: acc.v + a.usedValue, c: acc.c + a.usedCost } : acc;
      },
      { h: 0, v: 0, c: 0 },
    );
  return projects.map((p) => {
    const pt = tasks.filter((t) => t.projectId === p.id);
    const top = pt.filter((t) => t.level === 1);
    const used = usedOf(pt);
    // A phase = a top-level task with everything under it (WBS "2" covers "2", "2.1", "2.1.3" …).
    const phasesOverBudget = top.filter((ph) => {
      const u = usedOf(pt.filter((t) => t.wbs === ph.wbs || t.wbs.startsWith(`${ph.wbs}.`)));
      const b = budgetActual(
        {
          budgetHours: fromDecimal(ph.budgetHours),
          budgetAmount: ph.budgetAmount,
          usedHours: u.h,
          usedValue: u.v,
          usedCost: u.c,
        },
        limits,
      );
      return b.health === "over";
    }).length;
    return {
      ...p,
      contractTypes: [...new Set(contracts.filter((c) => c.projectId === p.id).map((c) => c.type))],
      ...budgetActual(
        {
          budgetHours: top.reduce((a, t) => a + fromDecimal(t.budgetHours), 0),
          budgetAmount: top.reduce((a, t) => a + t.budgetAmount, 0),
          usedHours: used.h,
          usedValue: used.v,
          usedCost: used.c,
        },
        limits,
      ),
      phasesOverBudget,
      warningBp: limits.warningBp,
    };
  });
}

/** Task tree with budget vs actual rolled up from leaves, plus contract completion for fixed price. */
export async function projectDetail(tx: Tx, projectId: string) {
  const [summary] = await projectSummaries(tx, [projectId]);
  if (!summary) return null;
  const tasks = await tx
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.projectId, projectId))
    .orderBy(schema.tasks.wbs);
  const contracts = await tx.select().from(schema.contracts).where(eq(schema.contracts.projectId, projectId));
  const members = await tx
    .select({ id: schema.users.id, fullName: schema.users.fullName, initials: schema.users.initials })
    .from(schema.projectMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId))
    .where(eq(schema.projectMembers.projectId, projectId));
  const actuals = await taskActuals(tx, [projectId]);
  const limits = await budgetThresholds(tx);

  const childrenOf = (id: string | null) => tasks.filter((t) => t.parentId === id);
  const rolled = new Map<string, { h: number; v: number; c: number }>();
  const roll = (t: (typeof tasks)[number]): { h: number; v: number; c: number } => {
    const own = actuals.get(t.id);
    const acc = { h: own?.usedHours ?? 0, v: own?.usedValue ?? 0, c: own?.usedCost ?? 0 };
    for (const ch of childrenOf(t.id)) {
      const r = roll(ch);
      acc.h += r.h;
      acc.v += r.v;
      acc.c += r.c;
    }
    rolled.set(t.id, acc);
    return acc;
  };
  for (const t of childrenOf(null)) roll(t);

  const taskList = tasks.map((t) => {
    const r = rolled.get(t.id) ?? { h: 0, v: 0, c: 0 };
    return {
      id: t.id,
      parentId: t.parentId,
      contractId: t.contractId,
      level: t.level,
      wbs: t.wbs,
      name: t.name,
      billable: t.billable,
      status: t.status,
      isLeaf: childrenOf(t.id).length === 0,
      ...budgetActual(
        {
          budgetHours: fromDecimal(t.budgetHours),
          budgetAmount: t.budgetAmount,
          usedHours: r.h,
          usedValue: r.v,
          usedCost: r.c,
        },
        limits,
      ),
    };
  });

  const contractList = contracts.map((c) => {
    const ct = taskList.filter((t) => t.contractId === c.id && t.level === 1);
    const usedHours = ct.reduce((a, t) => a + t.usedHours, 0);
    const budgetHours = ct.reduce((a, t) => a + t.budgetHours, 0);
    const completionBp = c.type === "fixed_price" ? completionBasisPoints(usedHours, budgetHours) : null;
    return {
      id: c.id,
      name: c.name,
      type: c.type,
      price: c.price,
      hourlyRate: c.hourlyRate,
      maxHours: c.maxHours,
      retainerHours: c.retainerHours,
      usedHours,
      budgetHours,
      completionBp,
      recognisedRevenue:
        c.type === "fixed_price" && c.price && completionBp !== null
          ? recognisedRevenue(c.price, completionBp)
          : null,
    };
  });
  return { ...summary, tasks: taskList, contracts: contractList, members };
}

export { and };
