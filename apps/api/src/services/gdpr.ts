/**
 * GDPR workflows (docs/spec/administration.md, decision D-026) — GRASP Pure Fabrication: data-subject export,
 * erasure (pseudonymisation) of former employees, and the nightly retention sweep. The rules (cutoff, pseudonym,
 * blockers) live in packages/domain/src/gdpr.ts; this file reads and writes the tables.
 *
 * Erasure keeps bookkeeping data (approved/invoiced hours, expenses, invoices, payroll lines) but cuts the link to
 * the person: name, e-mail, initials, payroll number and comments are removed; non-bookkeeping personal data
 * (competencies, calendar imports, tokens, favourites, plans, drafts) is deleted. It cannot be undone.
 */
import { type Db, schema, type Tx, withTenant, writeAudit } from "@arc-tid/db";
import {
  erasureBlockers,
  type LocalDate,
  pseudonymFor,
  retentionCutoff,
  todayCopenhagen,
} from "@arc-tid/domain";
import { and, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { AuthContext } from "../auth/plugin.ts";
import { AppError } from "./errors.ts";

/** Loads the person or throws 404. */
async function loadPerson(tx: Tx, userId: string) {
  const [u] = await tx.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u) throw new AppError(404, "not_found");
  return u;
}

/**
 * Everything ARCnordic Tid holds about one person, as one JSON document (spec: data-subject export; AC5 — nothing
 * about others). Receipts are listed by file name; the files themselves stay in the receipt store. Audited.
 */
export async function exportPersonalData(tx: Tx, auth: AuthContext, userId: string) {
  const u = await loadPerson(tx, userId);
  const data = {
    generatedAt: new Date().toISOString(),
    profile: {
      fullName: u.fullName,
      initials: u.initials,
      email: u.email,
      employmentStart: u.employmentStart,
      employmentEnd: u.employmentEnd,
      payrollNumber: u.payrollNumber,
      active: u.active,
      locale: u.locale,
    },
    roles: (
      await tx
        .select({ role: schema.userRoles.role })
        .from(schema.userRoles)
        .where(eq(schema.userRoles.userId, userId))
    ).map((r) => r.role),
    rights: (
      await tx
        .select({ right: schema.userRights.right })
        .from(schema.userRights)
        .where(eq(schema.userRights.userId, userId))
    ).map((r) => r.right),
    competencies: (
      await tx
        .select({ name: schema.userCompetencies.name })
        .from(schema.userCompetencies)
        .where(eq(schema.userCompetencies.userId, userId))
    ).map((r) => r.name),
    timeEntries: await tx
      .select({
        date: schema.timeEntries.date,
        project: schema.projects.number,
        task: schema.tasks.name,
        absence: schema.absenceCodes.nameDa,
        hours: schema.timeEntries.hours,
        billable: schema.timeEntries.billable,
        status: schema.timeEntries.status,
        comment: schema.timeEntries.comment,
      })
      .from(schema.timeEntries)
      .leftJoin(schema.projects, eq(schema.projects.id, schema.timeEntries.projectId))
      .leftJoin(schema.tasks, eq(schema.tasks.id, schema.timeEntries.taskId))
      .leftJoin(schema.absenceCodes, eq(schema.absenceCodes.id, schema.timeEntries.absenceCodeId))
      .where(eq(schema.timeEntries.userId, userId))
      .orderBy(schema.timeEntries.date),
    timesheetWeeks: await tx
      .select({
        weekStart: schema.timesheetPeriods.weekStart,
        status: schema.timesheetPeriods.status,
        comment: schema.timesheetPeriods.comment,
      })
      .from(schema.timesheetPeriods)
      .where(eq(schema.timesheetPeriods.userId, userId)),
    expenses: await tx
      .select({
        date: schema.expenses.date,
        kind: schema.expenses.kind,
        description: schema.expenses.description,
        amount: schema.expenses.grossAmount,
        km: schema.expenses.km,
        from: schema.expenses.fromPlace,
        to: schema.expenses.toPlace,
        status: schema.expenses.status,
        receipt: schema.files.filename,
      })
      .from(schema.expenses)
      .leftJoin(schema.files, eq(schema.files.id, schema.expenses.receiptFileId))
      .where(eq(schema.expenses.userId, userId)),
    plannedHours: await tx
      .select({ weekStart: schema.allocations.weekStart, hours: schema.allocations.hours })
      .from(schema.allocations)
      .where(eq(schema.allocations.userId, userId)),
    payrollLines: await tx
      .select({
        month: schema.payrollLines.month,
        code: schema.salaryCodes.code,
        quantity: schema.payrollLines.quantity,
        amount: schema.payrollLines.amount,
      })
      .from(schema.payrollLines)
      .innerJoin(schema.salaryCodes, eq(schema.salaryCodes.id, schema.payrollLines.salaryCodeId))
      .where(eq(schema.payrollLines.userId, userId)),
    auditAboutPerson: await tx
      .select({
        at: schema.auditLog.at,
        entity: schema.auditLog.entity,
        action: schema.auditLog.action,
        after: schema.auditLog.after,
        reason: schema.auditLog.reason,
      })
      .from(schema.auditLog)
      .where(
        and(
          inArray(schema.auditLog.entity, ["employee", "user_roles"]),
          eq(schema.auditLog.entityId, userId),
        ),
      ),
  };
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "employee",
    entityId: userId,
    action: "gdpr_export",
    userId: auth.userId,
  });
  return data;
}

/** What an erasure would do and whether it is blocked (shown to the Admin before confirming). */
export async function erasurePreview(tx: Tx, userId: string) {
  const u = await loadPerson(tx, userId);
  const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const n = sql<number>`count(*)::int`;
  const activeProjectsManaged = await count(
    tx
      .select({ n })
      .from(schema.projects)
      .where(
        and(eq(schema.projects.managerId, userId), inArray(schema.projects.status, ["planned", "active"])),
      ),
  );
  const directReports = await count(
    tx
      .select({ n })
      .from(schema.users)
      .where(and(eq(schema.users.managerId, userId), eq(schema.users.active, true))),
  );
  return {
    alreadyErased: u.email.endsWith(".invalid"),
    blockers: erasureBlockers({ active: u.active, activeProjectsManaged, directReports }),
    keep: {
      timeEntries: await count(
        tx
          .select({ n })
          .from(schema.timeEntries)
          .where(and(eq(schema.timeEntries.userId, userId), ne(schema.timeEntries.status, "draft"))),
      ),
      expenses: await count(
        tx
          .select({ n })
          .from(schema.expenses)
          .where(and(eq(schema.expenses.userId, userId), ne(schema.expenses.status, "draft"))),
      ),
    },
    remove: {
      draftEntries: await count(
        tx
          .select({ n })
          .from(schema.timeEntries)
          .where(and(eq(schema.timeEntries.userId, userId), eq(schema.timeEntries.status, "draft"))),
      ),
      competencies: await count(
        tx.select({ n }).from(schema.userCompetencies).where(eq(schema.userCompetencies.userId, userId)),
      ),
      plannedHours: await count(
        tx.select({ n }).from(schema.allocations).where(eq(schema.allocations.userId, userId)),
      ),
    },
  };
}

/**
 * Erases a former employee (spec R5, AC4): refuses while blocked, then pseudonymises the profile, clears comments
 * on kept entries, and deletes non-bookkeeping personal data. Audited with the reason, without personal data.
 */
export async function erasePerson(tx: Tx, auth: AuthContext, userId: string, reason: string) {
  const preview = await erasurePreview(tx, userId);
  if (preview.alreadyErased) throw new AppError(409, "already_erased");
  if (preview.blockers.length) throw new AppError(409, preview.blockers[0] as string, preview.blockers);
  const p = pseudonymFor(userId);
  // Drafts without any invoice history are not bookkeeping data.
  await tx
    .delete(schema.timeEntries)
    .where(
      and(
        eq(schema.timeEntries.userId, userId),
        eq(schema.timeEntries.status, "draft"),
        isNull(schema.timeEntries.invoiceLineId),
        sql`not exists (select 1 from invoice_line_sources s where s.time_entry_id = ${schema.timeEntries.id})`,
      ),
    );
  await tx
    .delete(schema.expenses)
    .where(and(eq(schema.expenses.userId, userId), eq(schema.expenses.status, "draft")));
  await tx
    .update(schema.timeEntries)
    .set({ comment: null, internalNote: null })
    .where(eq(schema.timeEntries.userId, userId));
  await tx
    .update(schema.timesheetPeriods)
    .set({ comment: null })
    .where(eq(schema.timesheetPeriods.userId, userId));
  for (const t of [
    schema.userCompetencies,
    schema.calendarImports,
    schema.graphTokens,
    schema.sessions,
    schema.favourites,
    schema.allocations,
    schema.reminderLog,
    schema.userRights,
    schema.userRoles,
  ] as const)
    await tx.delete(t).where(eq(t.userId, userId));
  await tx
    .update(schema.users)
    .set({
      ...p,
      passwordHash: null,
      entraObjectId: null,
      payrollNumber: null,
      managerId: null,
      active: false,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, userId));
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "employee",
    entityId: userId,
    action: "gdpr_erasure",
    userId: auth.userId,
    after: { pseudonym: p.fullName, kept: preview.keep, removed: preview.remove },
    reason,
  });
  return { pseudonym: p.fullName };
}

/**
 * Nightly retention sweep for one tenant: deletes short-lived personal data (expired sessions and Graph tokens,
 * reminder and calendar-import logs older than 13 months) and reports bookkeeping records past the 5-year
 * retention, which Finance purges deliberately (D-026) rather than a job deleting accounting data on its own.
 */
export async function retentionSweep(tx: Tx, today: LocalDate) {
  const now = new Date();
  const yearAgo = new Date(now.getTime() - 400 * 24 * 3600 * 1000);
  const removed = {
    sessions: (
      await tx
        .delete(schema.sessions)
        .where(lt(schema.sessions.expiresAt, now))
        .returning({ x: schema.sessions.tokenHash })
    ).length,
    graphTokens: (
      await tx
        .delete(schema.graphTokens)
        .where(lt(schema.graphTokens.expiresAt, now))
        .returning({ x: schema.graphTokens.userId })
    ).length,
    reminders: (
      await tx
        .delete(schema.reminderLog)
        .where(lt(schema.reminderLog.sentAt, yearAgo))
        .returning({ x: schema.reminderLog.id })
    ).length,
    calendarImports: (
      await tx
        .delete(schema.calendarImports)
        .where(lt(schema.calendarImports.createdAt, yearAgo))
        .returning({ x: schema.calendarImports.id })
    ).length,
  };
  return { removed, pastRetention: await pastRetention(tx, today) };
}

/** Bookkeeping records dated before the retention cutoff, and former employees not yet erased. */
export async function pastRetention(tx: Tx, today: LocalDate) {
  const cutoff = retentionCutoff(today);
  const n = sql<number>`count(*)::int`;
  const [entries] = await tx
    .select({ n })
    .from(schema.timeEntries)
    .where(lt(schema.timeEntries.date, cutoff));
  const [expenses] = await tx.select({ n }).from(schema.expenses).where(lt(schema.expenses.date, cutoff));
  const [invoices] = await tx
    .select({ n })
    .from(schema.invoices)
    .where(lt(schema.invoices.invoiceDate, cutoff));
  const formerNotErased = await tx
    .select({
      id: schema.users.id,
      fullName: schema.users.fullName,
      employmentEnd: schema.users.employmentEnd,
    })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.active, false),
        sql`${schema.users.email} not like '%.invalid'`,
        or(isNull(schema.users.employmentEnd), lt(schema.users.employmentEnd, today)),
      ),
    );
  return {
    cutoff,
    timeEntries: entries?.n ?? 0,
    expenses: expenses?.n ?? 0,
    invoices: invoices?.n ?? 0,
    formerNotErased,
  };
}

/** Runs the retention sweep for every tenant (background job; each tenant in its own RLS-scoped transaction). */
export async function runRetentionSweep(db: Db, today: LocalDate = todayCopenhagen()) {
  const tenants = await db.execute<{ id: string }>(sql`select id from job_tenant_ids()`);
  const out: Record<string, Awaited<ReturnType<typeof retentionSweep>>> = {};
  for (const t of tenants) out[t.id] = await withTenant(db, t.id, (tx) => retentionSweep(tx, today));
  return out;
}
