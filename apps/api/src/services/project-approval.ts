/**
 * Project manager approval step (docs/spec/approval.md, mode pm_then_line_manager, decision D-022) — GRASP Pure
 * Fabrication. In this mode the project manager first approves or rejects an employee's week on their project;
 * the line manager then approves the whole week (and may approve early "on behalf", which is audited).
 *
 * Rules: one PM step per project with submitted entries; entries on projects without a manager, or where the
 * employee is the manager, skip straight to the line manager; absence is always the line manager's. A PM reject
 * returns only that project's entries to the employee; edited entries lose their PM approval (saveCell), so after
 * resubmission only they come back to the PM (spec R3 / AC3).
 */
import { schema, type Tx, writeAudit } from "@arc-tid/db";
import { addDays, type LocalDate, startOfIsoWeek } from "@arc-tid/domain";
import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import type { AuthContext } from "../auth/plugin.ts";
import { AppError } from "./errors.ts";

/** How weeks are approved in this tenant. */
export type ApprovalMode = "none" | "line_manager" | "pm_then_line_manager";

/** The tenant's approval mode (defaults to line manager only). */
export async function approvalMode(tx: Tx, tenantId: string): Promise<ApprovalMode> {
  const [t] = await tx
    .select({ mode: schema.tenants.approvalMode })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId));
  return (t?.mode as ApprovalMode | undefined) ?? "line_manager";
}

/** Filter: submitted project entries still waiting for their project manager (excluding the PM's own hours). */
const waitingForPm = () =>
  and(
    eq(schema.timeEntries.status, "submitted"),
    isNull(schema.timeEntries.pmApprovedAt),
    isNotNull(schema.timeEntries.taskId),
    isNotNull(schema.projects.managerId),
    ne(schema.projects.managerId, schema.timeEntries.userId),
  );

/** Number of open PM steps (distinct projects) in one employee's week — shown to the line manager. */
export async function pendingPmSteps(tx: Tx, userId: string, weekStart: LocalDate): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(distinct ${schema.timeEntries.projectId})::int` })
    .from(schema.timeEntries)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.timeEntries.projectId))
    .where(
      and(
        waitingForPm(),
        eq(schema.timeEntries.userId, userId),
        gte(schema.timeEntries.date, weekStart),
        lte(schema.timeEntries.date, addDays(weekStart, 6)),
      ),
    );
  return r?.n ?? 0;
}

/**
 * The project manager's inbox: per employee × week × project, the submitted hours waiting for them, with the
 * individual entries (date, task, hours, comment). Empty unless the tenant uses pm_then_line_manager.
 */
export async function pmInbox(tx: Tx, auth: AuthContext) {
  if ((await approvalMode(tx, auth.tenantId)) !== "pm_then_line_manager")
    return { enabled: false, items: [] };
  const rows = await tx
    .select({
      id: schema.timeEntries.id,
      userId: schema.timeEntries.userId,
      fullName: schema.users.fullName,
      date: schema.timeEntries.date,
      hours: schema.timeEntries.hours,
      billable: schema.timeEntries.billable,
      comment: schema.timeEntries.comment,
      taskName: schema.tasks.name,
      projectId: schema.projects.id,
      projectNumber: schema.projects.number,
      projectName: schema.projects.name,
    })
    .from(schema.timeEntries)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.timeEntries.projectId))
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.timeEntries.taskId))
    .innerJoin(schema.users, eq(schema.users.id, schema.timeEntries.userId))
    .where(and(waitingForPm(), eq(schema.projects.managerId, auth.userId)))
    .orderBy(schema.timeEntries.date);
  const groups = new Map<
    string,
    {
      userId: string;
      fullName: string;
      weekStart: LocalDate;
      projectId: string;
      projectNumber: string;
      projectName: string;
      hours: number;
      billable: number;
      entries: { date: LocalDate; taskName: string; hours: number; comment: string | null }[];
    }
  >();
  for (const r of rows) {
    const weekStart = startOfIsoWeek(r.date);
    const key = `${r.userId}|${weekStart}|${r.projectId}`;
    const g = groups.get(key) ?? {
      userId: r.userId,
      fullName: r.fullName,
      weekStart,
      projectId: r.projectId,
      projectNumber: r.projectNumber,
      projectName: r.projectName,
      hours: 0,
      billable: 0,
      entries: [],
    };
    g.hours += r.hours;
    if (r.billable) g.billable += r.hours;
    g.entries.push({ date: r.date, taskName: r.taskName, hours: r.hours, comment: r.comment });
    groups.set(key, g);
  }
  const items = [...groups.values()].map((g) => ({
    ...g,
    hours: Math.round(g.hours * 100) / 100,
    billable: Math.round(g.billable * 100) / 100,
  }));
  items.sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.fullName.localeCompare(b.fullName));
  return { enabled: true, items };
}

/** One PM decision: an employee's week on one project. */
export interface PmDecision {
  userId: string;
  weekStart: LocalDate;
  projectId: string;
  decision: "approve" | "reject";
  comment?: string | undefined;
}

/**
 * Records the project manager's decision. Approve: the entries get the PM stamp and the week becomes "partially
 * approved" (the line manager still decides). Reject: only these entries go back to the employee and the week is
 * rejected with the comment (prefixed with the project number). Logged on the week and audited.
 */
export async function pmDecide(tx: Tx, auth: AuthContext, d: PmDecision) {
  if ((await approvalMode(tx, auth.tenantId)) !== "pm_then_line_manager")
    throw new AppError(409, "pm_step_disabled");
  const [project] = await tx.select().from(schema.projects).where(eq(schema.projects.id, d.projectId));
  if (!project) throw new AppError(404, "not_found");
  if (project.managerId !== auth.userId) throw new AppError(403, "forbidden");
  if (d.userId === auth.userId) throw new AppError(403, "self_approval");
  const [period] = await tx
    .select()
    .from(schema.timesheetPeriods)
    .where(
      and(eq(schema.timesheetPeriods.userId, d.userId), eq(schema.timesheetPeriods.weekStart, d.weekStart)),
    );
  if (!period || (period.status !== "submitted" && period.status !== "partially_approved"))
    throw new AppError(409, "not_submitted");
  const scope = and(
    eq(schema.timeEntries.userId, d.userId),
    eq(schema.timeEntries.projectId, d.projectId),
    gte(schema.timeEntries.date, d.weekStart),
    lte(schema.timeEntries.date, addDays(d.weekStart, 6)),
    eq(schema.timeEntries.status, "submitted"),
    isNull(schema.timeEntries.pmApprovedAt),
  );
  const ids = (await tx.select({ id: schema.timeEntries.id }).from(schema.timeEntries).where(scope)).map(
    (r) => r.id,
  );
  if (!ids.length) throw new AppError(409, "nothing_to_decide");

  let status: "submitted" | "partially_approved" | "rejected" = period.status;
  let comment: string | null = null;
  if (d.decision === "approve") {
    await tx
      .update(schema.timeEntries)
      .set({ pmApprovedBy: auth.userId, pmApprovedAt: new Date(), updatedAt: new Date() })
      .where(inArray(schema.timeEntries.id, ids));
    status = "partially_approved";
  } else {
    if (!d.comment || d.comment.trim().length < 3) throw new AppError(400, "comment_required");
    comment = `${project.number}: ${d.comment.trim()}`;
    await tx
      .update(schema.timeEntries)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(inArray(schema.timeEntries.id, ids));
    status = "rejected";
  }
  await tx
    .update(schema.timesheetPeriods)
    .set({
      status,
      updatedAt: new Date(),
      ...(comment ? { comment, decidedBy: auth.userId, decidedAt: new Date() } : {}),
    })
    .where(eq(schema.timesheetPeriods.id, period.id));
  await tx.insert(schema.timesheetEvents).values({
    tenantId: auth.tenantId,
    periodId: period.id,
    action: `pm_${d.decision}`,
    userId: auth.userId,
    comment,
  });
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "timesheet_period",
    entityId: period.id,
    action: `pm_${d.decision}`,
    userId: auth.userId,
    before: { status: period.status },
    after: { status, project: project.number, entries: ids.length },
    ...(comment ? { reason: comment } : {}),
  });
  return { status, entries: ids.length };
}
