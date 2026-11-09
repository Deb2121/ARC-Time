/**
 * Expenses and mileage (brief §4.7, docs/spec/expenses.md) — GRASP Pure Fabrication for the expense workflows:
 * register (draft), submit, approve/reject, list. Calculations (VAT split, mileage with the 20.000 km threshold,
 * markup) come from @arc-tid/domain (Information Expert). Approval (decision D-019): the employee's line manager
 * approves; Finance may approve anyone's. Approved billable expenses flow into the invoicing basis.
 */
import { closedMonths, schema, type Tx, writeAudit } from "@arc-tid/db";
import {
  expenseCost,
  hasRole,
  isLocked,
  type LocalDate,
  lastDayOfMonth,
  mileageAmount,
  vatSplit,
} from "@arc-tid/domain";
import { and, asc, desc, eq, gte, inArray, lt, lte, ne, sql } from "drizzle-orm";
import { type AuthContext, policyOf } from "../auth/plugin.ts";
import { AppError } from "./errors.ts";
import { approveeIds, canApproveUser } from "./people.ts";

/** Expense types and mileage rates for the registration forms. */
export async function expenseSettings(tx: Tx) {
  return {
    types: await tx
      .select()
      .from(schema.expenseTypes)
      .where(eq(schema.expenseTypes.active, true))
      .orderBy(asc(schema.expenseTypes.name)),
    mileageRates: await tx.select().from(schema.mileageRates).orderBy(desc(schema.mileageRates.year)),
  };
}

/** Columns returned to the UI for one expense (with type, project and employee names). */
const expenseColumns = {
  id: schema.expenses.id,
  userId: schema.expenses.userId,
  employee: schema.users.fullName,
  initials: schema.users.initials,
  date: schema.expenses.date,
  kind: schema.expenses.kind,
  description: schema.expenses.description,
  typeName: schema.expenseTypes.name,
  expenseTypeId: schema.expenses.expenseTypeId,
  projectId: schema.expenses.projectId,
  projectNumber: schema.projects.number,
  projectName: schema.projects.name,
  currency: schema.expenses.currency,
  grossAmount: schema.expenses.grossAmount,
  vatAmount: schema.expenses.vatAmount,
  netAmount: schema.expenses.netAmount,
  billable: schema.expenses.billable,
  markupBp: schema.expenses.markupBp,
  km: schema.expenses.km,
  fromPlace: schema.expenses.fromPlace,
  toPlace: schema.expenses.toPlace,
  receiptFileId: schema.expenses.receiptFileId,
  status: schema.expenses.status,
  rejectComment: schema.expenses.rejectComment,
};

/** Base query joining type, project and employee. */
function expenseQuery(tx: Tx) {
  return tx
    .select(expenseColumns)
    .from(schema.expenses)
    .innerJoin(schema.users, eq(schema.users.id, schema.expenses.userId))
    .leftJoin(schema.expenseTypes, eq(schema.expenseTypes.id, schema.expenses.expenseTypeId))
    .leftJoin(schema.projects, eq(schema.projects.id, schema.expenses.projectId));
}

/** The signed-in employee's expenses in a month (`month` = first day, "YYYY-MM-01"), newest first. */
export async function myExpenses(tx: Tx, auth: AuthContext, month: LocalDate) {
  return expenseQuery(tx)
    .where(
      and(
        eq(schema.expenses.userId, auth.userId),
        gte(schema.expenses.date, month),
        lte(schema.expenses.date, lastDayOfMonth(month)),
      ),
    )
    .orderBy(desc(schema.expenses.date), desc(schema.expenses.createdAt));
}

/** Input for an expense (`kind: "expense"`, gross amount in kr incl. VAT) or a mileage claim (`kind: "mileage"`, km). */
export interface ExpenseInput {
  date: LocalDate;
  kind: "expense" | "mileage";
  description: string;
  projectId?: string | null | undefined;
  expenseTypeId?: string | null | undefined;
  /** kr incl. VAT (expenses only) */
  amount?: number | undefined;
  km?: number | undefined;
  fromPlace?: string | undefined;
  toPlace?: string | undefined;
  billable?: boolean | undefined;
  markupPct?: number | undefined;
  receiptFileId?: string | null | undefined;
}

/** Throws if the date is in a closed accounting month (locked for everyone, brief §4.11). */
async function assertOpenDate(tx: Tx, date: LocalDate) {
  if (isLocked(date, await closedMonths(tx))) throw new AppError(409, "period_closed");
}

/** Mileage already claimed by the user earlier in the same year (metres), for the 20.000 km threshold. */
async function metresBefore(tx: Tx, userId: string, date: LocalDate, excludeId?: string) {
  const [r] = await tx
    .select({ km: sql<string>`coalesce(sum(${schema.expenses.km}), 0)` })
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.userId, userId),
        eq(schema.expenses.kind, "mileage"),
        gte(schema.expenses.date, `${date.slice(0, 4)}-01-01`),
        lt(schema.expenses.date, date),
        ne(schema.expenses.status, "rejected"),
        excludeId ? ne(schema.expenses.id, excludeId) : undefined,
      ),
    );
  return Math.round(Number(r?.km ?? 0) * 1000);
}

/**
 * Creates or updates (when `id` is given and still draft/rejected) an expense for the signed-in employee and
 * computes its amounts: VAT split by expense type for expenses; allowance from the yearly rate table for mileage.
 * Billable requires a project the employee is a member of. Saved as draft; audited.
 */
export async function saveExpense(tx: Tx, auth: AuthContext, input: ExpenseInput, id?: string) {
  await assertOpenDate(tx, input.date);
  let existing: typeof schema.expenses.$inferSelect | undefined;
  if (id) {
    [existing] = await tx.select().from(schema.expenses).where(eq(schema.expenses.id, id));
    if (!existing || existing.userId !== auth.userId) throw new AppError(404, "not_found");
    if (existing.status !== "draft" && existing.status !== "rejected")
      throw new AppError(409, "not_editable");
  }
  if (input.projectId) {
    const [member] = await tx
      .select()
      .from(schema.projectMembers)
      .where(
        and(
          eq(schema.projectMembers.projectId, input.projectId),
          eq(schema.projectMembers.userId, auth.userId),
        ),
      );
    if (!member) throw new AppError(403, "not_project_member");
  }
  if (input.billable && !input.projectId) throw new AppError(422, "billable_needs_project");
  if (input.receiptFileId) {
    const [f] = await tx.select().from(schema.files).where(eq(schema.files.id, input.receiptFileId));
    if (!f || f.ownerId !== auth.userId) throw new AppError(400, "invalid_receipt");
  }

  let amounts: { grossAmount: number; vatAmount: number; netAmount: number; costAmount: number };
  if (input.kind === "mileage") {
    if (!input.km || input.km <= 0) throw new AppError(422, "km_required");
    const year = Number(input.date.slice(0, 4));
    const [rate] = await tx.select().from(schema.mileageRates).where(eq(schema.mileageRates.year, year));
    if (!rate) throw new AppError(422, "no_mileage_rate_for_year");
    const allowance = mileageAmount(
      Math.round(input.km * 1000),
      await metresBefore(tx, auth.userId, input.date, id),
      rate,
    );
    amounts = { grossAmount: allowance, vatAmount: 0, netAmount: allowance, costAmount: allowance };
  } else {
    if (!input.amount || input.amount <= 0) throw new AppError(422, "amount_required");
    const [type] = input.expenseTypeId
      ? await tx.select().from(schema.expenseTypes).where(eq(schema.expenseTypes.id, input.expenseTypeId))
      : [];
    const split = vatSplit(
      Math.round(input.amount * 100),
      type?.vatBp ?? 2500,
      type?.vatDeductibleBp ?? 10_000,
    );
    amounts = {
      grossAmount: split.gross,
      vatAmount: split.vat,
      netAmount: split.net,
      costAmount: expenseCost(split),
    };
  }
  const values = {
    date: input.date,
    kind: input.kind,
    description: input.description,
    projectId: input.projectId ?? null,
    expenseTypeId: input.kind === "expense" ? (input.expenseTypeId ?? null) : null,
    ...amounts,
    billable: Boolean(input.billable && input.projectId),
    markupBp: Math.round((input.markupPct ?? 0) * 100),
    km: input.kind === "mileage" ? (input.km ?? null) : null,
    fromPlace: input.fromPlace ?? null,
    toPlace: input.toPlace ?? null,
    receiptFileId: input.receiptFileId ?? null,
    status: "draft" as const,
    rejectComment: null,
    updatedAt: new Date(),
  };
  const [row] = existing
    ? await tx.update(schema.expenses).set(values).where(eq(schema.expenses.id, existing.id)).returning()
    : await tx
        .insert(schema.expenses)
        .values({ tenantId: auth.tenantId, userId: auth.userId, ...values })
        .returning();
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "expense",
    entityId: row?.id ?? "",
    action: existing ? "update" : "create",
    userId: auth.userId,
    before: existing,
    after: row,
  });
  return row;
}

/** Deletes one of the employee's own draft/rejected expenses. */
export async function deleteExpense(tx: Tx, auth: AuthContext, id: string) {
  const [e] = await tx.select().from(schema.expenses).where(eq(schema.expenses.id, id));
  if (!e || e.userId !== auth.userId) throw new AppError(404, "not_found");
  if (e.status !== "draft" && e.status !== "rejected") throw new AppError(409, "not_editable");
  await tx.delete(schema.expenses).where(eq(schema.expenses.id, id));
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "expense",
    entityId: id,
    action: "delete",
    userId: auth.userId,
    before: e,
  });
}

/** Submits the employee's draft/rejected expenses (all of them, or the given ids) for approval. Returns the count. */
export async function submitExpenses(tx: Tx, auth: AuthContext, ids?: string[]) {
  const rows = await tx
    .update(schema.expenses)
    .set({ status: "submitted", updatedAt: new Date() })
    .where(
      and(
        eq(schema.expenses.userId, auth.userId),
        inArray(schema.expenses.status, ["draft", "rejected"]),
        ids?.length ? inArray(schema.expenses.id, ids) : undefined,
      ),
    )
    .returning({ id: schema.expenses.id });
  return { submitted: rows.length };
}

/** Submitted expenses waiting for the caller: their reports' (line manager) or everyone's (Finance, D-025). */
export async function expenseApprovalQueue(tx: Tx, auth: AuthContext) {
  const all = policyOf(auth).can("expense.approve_any");
  const ids = all ? null : await approveeIds(tx, auth);
  if (ids && !ids.length) return [];
  return expenseQuery(tx)
    .where(
      and(
        eq(schema.expenses.status, "submitted"),
        ids ? inArray(schema.expenses.userId, ids) : sql`${schema.expenses.userId} <> ${auth.userId}`,
      ),
    )
    .orderBy(asc(schema.users.fullName), asc(schema.expenses.date));
}

/** Loads a submitted expense the caller may decide on (line manager of the employee, or Finance — never own). */
async function loadForDecision(tx: Tx, auth: AuthContext, id: string) {
  const [e] = await tx.select().from(schema.expenses).where(eq(schema.expenses.id, id));
  if (!e) throw new AppError(404, "not_found");
  const finance = policyOf(auth).can("expense.approve_any") && e.userId !== auth.userId;
  if (!finance && !(await canApproveUser(tx, auth, e.userId))) throw new AppError(403, "forbidden");
  if (e.status !== "submitted") throw new AppError(409, "not_submitted");
  await assertOpenDate(tx, e.date);
  return e;
}

/** Approves a submitted expense (audited). Billable ones then appear in the invoicing basis. */
export async function approveExpense(tx: Tx, auth: AuthContext, id: string) {
  const e = await loadForDecision(tx, auth, id);
  await tx
    .update(schema.expenses)
    .set({ status: "approved", approvedBy: auth.userId, approvedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.expenses.id, id));
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "expense",
    entityId: id,
    action: "approve",
    userId: auth.userId,
    before: { status: e.status },
    after: { status: "approved" },
  });
  return { status: "approved" };
}

/** Rejects a submitted expense with a required comment shown to the employee (audited). */
export async function rejectExpense(tx: Tx, auth: AuthContext, id: string, comment: string) {
  const e = await loadForDecision(tx, auth, id);
  await tx
    .update(schema.expenses)
    .set({ status: "rejected", rejectComment: comment, updatedAt: new Date() })
    .where(eq(schema.expenses.id, id));
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "expense",
    entityId: id,
    action: "reject",
    userId: auth.userId,
    before: { status: e.status },
    after: { status: "rejected" },
    reason: comment,
  });
  return { status: "rejected" };
}

/** True if the caller may open the receipt file: its owner, the approver of the expense, or Finance/Admin. */
export async function canSeeFile(tx: Tx, auth: AuthContext, fileId: string): Promise<boolean> {
  const [f] = await tx.select().from(schema.files).where(eq(schema.files.id, fileId));
  if (!f) return false;
  if (f.ownerId === auth.userId || hasRole(auth.roles, "finance", "admin")) return true;
  return canApproveUser(tx, auth, f.ownerId);
}
