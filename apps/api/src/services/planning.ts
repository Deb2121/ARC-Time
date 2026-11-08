/**
 * Resource planner (brief §4.8, docs/spec/resource-planning.md) — GRASP Pure Fabrication: builds the capacity
 * heatmap (capacity vs booked per employee per ISO week) and changes allocations. Capacity and bands come from
 * @arc-tid/domain (Information Expert). Visibility: planners (PM, line manager, Finance, Admin, Management) see
 * everyone's capacity so they can staff projects; a plain employee sees only their own row.
 * Who may change an allocation: Admin, the project's manager, or the employee's line manager.
 */
import { schema, type Tx, writeAudit } from "@arc-tid/db";
import {
  addDays,
  capacity,
  dailyNorm,
  freeHours,
  fromDecimal,
  hasRole,
  type LocalDate,
  utilisationBand,
  utilisationBp,
} from "@arc-tid/domain";
import { and, asc, eq, gte, inArray, isNotNull, lte, ne } from "drizzle-orm";
import type { AuthContext } from "../auth/plugin.ts";
import { loadEmployee, normContext } from "./calendar.ts";
import { AppError } from "./errors.ts";
import { canApproveUser } from "./people.ts";

/** Roles that may see everyone's capacity in the planner. */
const PLANNER_ROLES = ["project_manager", "line_manager", "finance", "admin", "management"] as const;

/** One week cell in the heatmap (hours as decimals for the UI). */
export interface PlannerWeek {
  weekStart: LocalDate;
  norm: number;
  absence: number;
  capacity: number;
  booked: number;
  free: number;
  utilisationBp: number | null;
  band: ReturnType<typeof utilisationBand>;
}

/**
 * The heatmap for `weeks` ISO weeks from `fromMonday`: per employee their weeks (capacity, booked, free, band),
 * allocation rows per project, competencies; optionally filtered by competency (case-insensitive substring).
 */
export async function plannerView(
  tx: Tx,
  auth: AuthContext,
  fromMonday: LocalDate,
  weeks: number,
  competence?: string,
) {
  const toSunday = addDays(fromMonday, weeks * 7 - 1);
  const isPlanner = hasRole(auth.roles, ...PLANNER_ROLES);
  const people = await tx
    .select({
      id: schema.users.id,
      fullName: schema.users.fullName,
      initials: schema.users.initials,
      departmentId: schema.users.departmentId,
    })
    .from(schema.users)
    .where(and(eq(schema.users.active, true), isPlanner ? undefined : eq(schema.users.id, auth.userId)))
    .orderBy(asc(schema.users.fullName));
  const ids = people.map((p) => p.id);
  if (!ids.length) return { fromMonday, weeks: [] as LocalDate[], people: [] };

  const competencies = await tx
    .select()
    .from(schema.userCompetencies)
    .where(inArray(schema.userCompetencies.userId, ids));
  const allocations = await tx
    .select({
      userId: schema.allocations.userId,
      projectId: schema.allocations.projectId,
      weekStart: schema.allocations.weekStart,
      hours: schema.allocations.hours,
      number: schema.projects.number,
      name: schema.projects.name,
      managerId: schema.projects.managerId,
    })
    .from(schema.allocations)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.allocations.projectId))
    .where(
      and(
        inArray(schema.allocations.userId, ids),
        gte(schema.allocations.weekStart, fromMonday),
        lte(schema.allocations.weekStart, toSunday),
      ),
    );
  const absences = await tx
    .select({
      userId: schema.timeEntries.userId,
      date: schema.timeEntries.date,
      hours: schema.timeEntries.hours,
    })
    .from(schema.timeEntries)
    .where(
      and(
        inArray(schema.timeEntries.userId, ids),
        isNotNull(schema.timeEntries.absenceCodeId),
        ne(schema.timeEntries.status, "rejected"),
        gte(schema.timeEntries.date, fromMonday),
        lte(schema.timeEntries.date, toSunday),
      ),
    );

  const weekStarts = Array.from({ length: weeks }, (_, i) => addDays(fromMonday, i * 7));
  const term = competence?.trim().toLowerCase();
  const out = [];
  for (const p of people) {
    const comps = competencies
      .filter((c) => c.userId === p.id)
      .map((c) => c.name)
      .sort();
    if (term && !comps.some((c) => c.toLowerCase().includes(term))) continue;
    const emp = await loadEmployee(tx, p.id);
    if (!emp) continue;
    const ctx = await normContext(tx, emp);
    const rows = new Map<
      string,
      { projectId: string; number: string; name: string; canEdit: boolean; hours: Record<string, number> }
    >();
    const weekCells: PlannerWeek[] = weekStarts.map((w) => {
      let norm = 0;
      for (let d = 0; d < 7; d++) norm += dailyNorm(addDays(w, d), ctx);
      const sunday = addDays(w, 6);
      const absence = absences
        .filter((a) => a.userId === p.id && a.date >= w && a.date <= sunday)
        .reduce((s, a) => s + fromDecimal(a.hours), 0);
      const booked = allocations
        .filter((a) => a.userId === p.id && a.weekStart === w)
        .reduce((s, a) => s + fromDecimal(a.hours), 0);
      const cap = capacity(norm, absence);
      return {
        weekStart: w,
        norm: norm / 100,
        absence: absence / 100,
        capacity: cap / 100,
        booked: booked / 100,
        free: freeHours(booked, cap) / 100,
        utilisationBp: utilisationBp(booked, cap),
        band: utilisationBand(booked, cap),
      };
    });
    for (const a of allocations.filter((x) => x.userId === p.id)) {
      const row = rows.get(a.projectId) ?? {
        projectId: a.projectId,
        number: a.number,
        name: a.name,
        canEdit: false,
        hours: {},
      };
      row.hours[a.weekStart] = a.hours;
      row.canEdit = hasRole(auth.roles, "admin") || a.managerId === auth.userId;
      rows.set(a.projectId, row);
    }
    const lineManagerOfThem = await canApproveUser(tx, auth, p.id);
    out.push({
      ...p,
      competencies: comps,
      weeks: weekCells,
      allocations: [...rows.values()]
        .map((r) => ({ ...r, canEdit: r.canEdit || lineManagerOfThem }))
        .sort((a, b) => a.number.localeCompare(b.number)),
      canPlan: hasRole(auth.roles, "admin") || lineManagerOfThem || hasRole(auth.roles, "project_manager"),
    });
  }
  return { fromMonday, weeks: weekStarts, people: out };
}

/** True if the caller may change this employee's allocation on this project. */
async function canEditAllocation(tx: Tx, auth: AuthContext, userId: string, projectId: string) {
  if (hasRole(auth.roles, "admin")) return true;
  const [p] = await tx
    .select({ managerId: schema.projects.managerId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (p?.managerId === auth.userId) return true;
  return canApproveUser(tx, auth, userId);
}

/** Sets planned hours (decimal) for an employee on a project in one ISO week; 0 removes the allocation. */
export async function setAllocation(
  tx: Tx,
  auth: AuthContext,
  a: { userId: string; projectId: string; weekStart: LocalDate; hours: number },
) {
  if (!(await canEditAllocation(tx, auth, a.userId, a.projectId))) throw new AppError(403, "forbidden");
  const where = and(
    eq(schema.allocations.userId, a.userId),
    eq(schema.allocations.projectId, a.projectId),
    eq(schema.allocations.weekStart, a.weekStart),
  );
  const [before] = await tx.select().from(schema.allocations).where(where);
  if (a.hours === 0) {
    if (before) await tx.delete(schema.allocations).where(where);
  } else {
    await tx
      .insert(schema.allocations)
      .values({
        tenantId: auth.tenantId,
        userId: a.userId,
        projectId: a.projectId,
        weekStart: a.weekStart,
        hours: a.hours,
      })
      .onConflictDoUpdate({
        target: [schema.allocations.userId, schema.allocations.projectId, schema.allocations.weekStart],
        set: { hours: a.hours, updatedAt: new Date() },
      });
  }
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "allocation",
    entityId: `${a.userId}:${a.projectId}:${a.weekStart}`,
    action: "set",
    userId: auth.userId,
    before,
    after: a,
  });
  return { ok: true };
}

/** Replaces an employee's competency tags (Admin or their line manager). */
export async function setCompetencies(tx: Tx, auth: AuthContext, userId: string, names: string[]) {
  if (!hasRole(auth.roles, "admin") && !(await canApproveUser(tx, auth, userId)))
    throw new AppError(403, "forbidden");
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(0, 30);
  await tx.delete(schema.userCompetencies).where(eq(schema.userCompetencies.userId, userId));
  if (clean.length)
    await tx
      .insert(schema.userCompetencies)
      .values(clean.map((name) => ({ tenantId: auth.tenantId, userId, name })));
  return { competencies: clean };
}

/** Distinct competency names in the company (for the filter suggestions). */
export async function allCompetencies(tx: Tx) {
  const rows = await tx
    .selectDistinct({ name: schema.userCompetencies.name })
    .from(schema.userCompetencies)
    .orderBy(asc(schema.userCompetencies.name));
  return rows.map((r) => r.name);
}
