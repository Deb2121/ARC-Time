/**
 * Project setup workflows (docs/spec/projects.md) — GRASP Creator + Pure Fabrication: creating projects (with their
 * first contract and the PM as member), adding tasks to the WBS and editing tasks. Read models and budget-vs-actual
 * live in `services/projects.ts`; this module only changes data, and audits every change.
 */
import { schema, type Tx, writeAudit } from "@arc-tid/db";
import { kr, type LocalDate } from "@arc-tid/domain";
import { and, eq, like, sql } from "drizzle-orm";
import type { AuthContext } from "../auth/plugin.ts";
import { AppError } from "./errors.ts";
import { canEditProject } from "./projects.ts";

/** Maximum WBS depth (brief §4.3). */
export const WBS_MAX_LEVEL = 5;

/** Input for a new project; money in kroner (converted to øre here). */
export interface NewProjectInput {
  name: string;
  customerId: string | null;
  managerId: string;
  contractType: "time_material" | "fixed_price" | "retainer";
  price?: number | undefined;
  hourlyRate?: number | undefined;
  startDate?: LocalDate | undefined;
  endDate?: LocalDate | undefined;
  billable: boolean;
  commentRequired: boolean;
  category?: string | undefined;
}

/**
 * Next project number: two-digit year + three-digit sequence (26001, 26002 …). Numbers from 900 up are reserved
 * for internal projects (e.g. 26900 "Intern tid").
 */
async function nextProjectNumber(tx: Tx): Promise<string> {
  const yy = new Date().getFullYear().toString().slice(2);
  const [last] = await tx
    .select({ number: schema.projects.number })
    .from(schema.projects)
    .where(and(like(schema.projects.number, `${yy}___`), sql`${schema.projects.number} < ${`${yy}900`}`))
    .orderBy(sql`${schema.projects.number} desc`)
    .limit(1);
  return last ? String(Number(last.number) + 1) : `${yy}001`;
}

/** Creates an active project with one contract of the chosen type and the PM as member (audited). */
export async function createProject(tx: Tx, auth: AuthContext, b: NewProjectInput) {
  const [entity] = await tx.select().from(schema.legalEntities).limit(1);
  if (!entity) throw new AppError(400, "no_legal_entity");
  const [project] = await tx
    .insert(schema.projects)
    .values({
      tenantId: auth.tenantId,
      number: await nextProjectNumber(tx),
      name: b.name,
      customerId: b.customerId,
      legalEntityId: entity.id,
      managerId: b.managerId,
      status: "active",
      startDate: b.startDate,
      endDate: b.endDate,
      billable: b.billable,
      commentRequired: b.commentRequired,
      category: b.category,
    })
    .returning();
  if (!project) throw new AppError(500, "create_failed");
  await tx.insert(schema.contracts).values({
    tenantId: auth.tenantId,
    projectId: project.id,
    name: { time_material: "Regning", fixed_price: "Fastpris", retainer: "Rammeaftale" }[b.contractType],
    type: b.contractType,
    price: b.price !== undefined ? kr(b.price) : null,
    hourlyRate: b.hourlyRate !== undefined ? kr(b.hourlyRate) : null,
  });
  await tx
    .insert(schema.projectMembers)
    .values({ tenantId: auth.tenantId, projectId: project.id, userId: b.managerId })
    .onConflictDoNothing();
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "project",
    entityId: project.id,
    action: "create",
    userId: auth.userId,
    after: project,
  });
  return project;
}

/** Input for a new task; budget amount in kroner. */
export interface NewTaskInput {
  parentId: string | null;
  name: string;
  budgetHours: number;
  budgetAmount: number;
  billable?: boolean | undefined;
}

/**
 * Adds a task to the project's WBS (max 5 levels). A sub-task inherits its parent's contract; a top-level task gets
 * the project's first contract. A task that already has hours cannot get sub-tasks (time lives on leaf tasks only).
 * The WBS code is the parent's code + the next sibling number (e.g. "3.2").
 */
export async function addTask(tx: Tx, auth: AuthContext, projectId: string, b: NewTaskInput) {
  if (!(await canEditProject(tx, auth, projectId))) throw new AppError(403, "forbidden");
  const [project] = await tx.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new AppError(404, "not_found");
  let level = 1;
  let prefix = "";
  let contractId: string | null = null;
  if (b.parentId) {
    const [parent] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, b.parentId));
    if (!parent || parent.projectId !== project.id) throw new AppError(400, "invalid_parent");
    if (parent.level >= WBS_MAX_LEVEL) throw new AppError(422, "wbs_max_depth");
    const [hasEntries] = await tx
      .select({ id: schema.timeEntries.id })
      .from(schema.timeEntries)
      .where(eq(schema.timeEntries.taskId, parent.id))
      .limit(1);
    if (hasEntries) throw new AppError(422, "parent_has_time");
    level = parent.level + 1;
    prefix = `${parent.wbs}.`;
    contractId = parent.contractId;
  } else {
    const [c] = await tx
      .select()
      .from(schema.contracts)
      .where(eq(schema.contracts.projectId, project.id))
      .limit(1);
    contractId = c?.id ?? null;
  }
  const siblings = await tx
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.projectId, project.id),
        b.parentId ? eq(schema.tasks.parentId, b.parentId) : sql`${schema.tasks.parentId} is null`,
      ),
    );
  const [task] = await tx
    .insert(schema.tasks)
    .values({
      tenantId: auth.tenantId,
      projectId: project.id,
      contractId,
      parentId: b.parentId,
      level,
      wbs: `${prefix}${siblings.length + 1}`,
      name: b.name,
      billable: b.billable ?? project.billable,
      budgetHours: b.budgetHours,
      budgetAmount: kr(b.budgetAmount),
      sort: siblings.length,
    })
    .returning();
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "task",
    entityId: task?.id ?? "",
    action: "create",
    userId: auth.userId,
    after: task,
  });
  return task;
}

/** Editable task fields; budget amount in kroner. */
export interface TaskUpdate {
  name?: string | undefined;
  budgetHours?: number | undefined;
  budgetAmount?: number | undefined;
  status?: "open" | "closed" | undefined;
  billable?: boolean | undefined;
}

/** Updates a task (name, budget, open/closed, billable) — only the project's PM, Finance or Admin (audited). */
export async function updateTask(tx: Tx, auth: AuthContext, taskId: string, patch: TaskUpdate) {
  const [task] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
  if (!task) throw new AppError(404, "not_found");
  if (!(await canEditProject(tx, auth, task.projectId))) throw new AppError(403, "forbidden");
  const { budgetAmount, ...rest } = patch;
  const [after] = await tx
    .update(schema.tasks)
    .set({ ...rest, ...(budgetAmount !== undefined ? { budgetAmount: kr(budgetAmount) } : {}) })
    .where(eq(schema.tasks.id, task.id))
    .returning();
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "task",
    entityId: task.id,
    action: "update",
    userId: auth.userId,
    before: task,
    after,
  });
  return after;
}
