/**
 * Rate plan generator for a fixed-price case (D-039) — GRASP Controller/Pure Fabrication around the pure
 * computeFeePlan in @arc-tid/domain: loads and stores the generator's input per contract, shows the generated plan
 * with its control sums, exports it to Excel and — only on request — writes it as a DRAFT billing plan.
 *
 * Safety: "use as draft" refuses an active plan and a plan with invoiced/reserved instalments, so nothing that is
 * running or invoiced is ever replaced. Activating the draft still goes through the billing plan's own 100 % check.
 * Amounts in this API are øre.
 */
import { schema, type Tx, writeAudit } from "@arc-tid/db";
import { computeFeePlan, type FeePlanInput, todayCopenhagen } from "@arc-tid/domain";
import { and, asc, eq } from "drizzle-orm";
import type { AuthContext } from "../auth/plugin.ts";
import { assertCaseVisible, canEditCase, saveBillingPlan } from "./case-finance.ts";
import { AppError } from "./errors.ts";
import type { ExportTable } from "./export.ts";

async function loadContract(tx: Tx, auth: AuthContext, contractId: string) {
  const [c] = await tx.select().from(schema.contracts).where(eq(schema.contracts.id, contractId));
  if (!c) throw new AppError(404, "not_found");
  await assertCaseVisible(tx, auth, c.projectId);
  if (c.type !== "fixed_price") throw new AppError(422, "fee_plan_only_fixed_price");
  const [p] = await tx
    .select({ id: schema.projects.id, number: schema.projects.number, name: schema.projects.name })
    .from(schema.projects)
    .where(eq(schema.projects.id, c.projectId));
  if (!p) throw new AppError(404, "not_found");
  return { c, p };
}

/** The case's phases (top-level tasks) — the generator's starting point. */
async function phasesOf(tx: Tx, projectId: string) {
  return tx
    .select({ id: schema.tasks.id, name: schema.tasks.name, budgetAmount: schema.tasks.budgetAmount })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.projectId, projectId), eq(schema.tasks.level, 1)))
    .orderBy(asc(schema.tasks.sort), asc(schema.tasks.wbs));
}

/** A first suggestion when nothing is saved: one phase per top-level task with its budget and one instalment. */
function defaultInput(tasks: Awaited<ReturnType<typeof phasesOf>>, today: string): FeePlanInput {
  return {
    phases: tasks.map((t) => ({
      key: t.id,
      name: t.name,
      baseFee: t.budgetAmount,
      taskId: t.id,
      start: today.slice(0, 7),
      weights: [1],
    })),
    pools: [],
    subs: [],
  };
}

/** The generator for one fixed-price contract: saved (or suggested) input, the generated plan and its checks. */
export async function feePlan(tx: Tx, auth: AuthContext, contractId: string, today = todayCopenhagen()) {
  const { c, p } = await loadContract(tx, auth, contractId);
  const tasks = await phasesOf(tx, c.projectId);
  const [saved] = await tx.select().from(schema.feePlans).where(eq(schema.feePlans.contractId, c.id));
  const input = (saved?.input as FeePlanInput | undefined) ?? defaultInput(tasks, today);
  const result = computeFeePlan(input);
  const items = await tx
    .select({ invoiceLineId: schema.paymentPlanItems.invoiceLineId, status: schema.paymentPlanItems.status })
    .from(schema.paymentPlanItems)
    .where(eq(schema.paymentPlanItems.contractId, c.id));
  const hasInvoiced = items.some((i) => i.invoiceLineId || i.status === "invoiced");
  return {
    contract: {
      id: c.id,
      name: c.name,
      price: c.price ?? 0,
      planActive: c.planActive,
      planItems: items.length,
    },
    project: p,
    tasks,
    saved: Boolean(saved),
    updatedAt: saved?.updatedAt ?? null,
    input,
    result,
    /** the plan's total differs from the contract's fixed price — the draft cannot be activated until they match */
    priceMismatch: result.total !== (c.price ?? 0),
    canEdit: await canEditCase(tx, auth, c.projectId),
    /** "use as draft" is possible: no active plan, nothing invoiced or reserved, no problems */
    canApply: !c.planActive && !hasInvoiced && result.problems.length === 0 && result.instalments.length > 0,
    blockedBy: c.planActive ? "plan_active" : hasInvoiced ? "plan_item_invoiced" : null,
  };
}

/** Saves the generator's input (Finance or the case's project manager); phases may only point at the case's tasks. */
export async function saveFeePlan(tx: Tx, auth: AuthContext, contractId: string, input: FeePlanInput) {
  const { c } = await loadContract(tx, auth, contractId);
  if (!(await canEditCase(tx, auth, c.projectId))) throw new AppError(403, "forbidden");
  const own = new Set((await phasesOf(tx, c.projectId)).map((t) => t.id));
  if (input.phases.some((ph) => ph.taskId && !own.has(ph.taskId)))
    throw new AppError(422, "phase_not_on_case");
  const keys = input.phases.map((ph) => ph.key);
  if (new Set(keys).size !== keys.length) throw new AppError(422, "fee_plan_duplicate_phase");

  const [before] = await tx.select().from(schema.feePlans).where(eq(schema.feePlans.contractId, c.id));
  await tx
    .insert(schema.feePlans)
    .values({ tenantId: auth.tenantId, contractId: c.id, input, updatedBy: auth.userId })
    .onConflictDoUpdate({
      target: schema.feePlans.contractId,
      set: { input, updatedBy: auth.userId, updatedAt: new Date() },
    });
  const r = computeFeePlan(input);
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "fee_plan",
    entityId: c.id,
    action: before ? "update" : "create",
    userId: auth.userId,
    before: before ? { total: computeFeePlan(before.input as FeePlanInput).total } : null,
    after: { total: r.total, phases: input.phases.length, instalments: r.instalments.length },
  });
  return feePlan(tx, auth, contractId);
}

/**
 * Writes the generated instalments as the contract's DRAFT billing plan (amounts to the øre, linked to the phases).
 * Refused while the plan is active, when an instalment is invoiced/reserved, or when the generator has problems.
 */
export async function applyFeePlan(tx: Tx, auth: AuthContext, contractId: string) {
  const g = await feePlan(tx, auth, contractId);
  if (!g.canEdit) throw new AppError(403, "forbidden");
  if (!g.saved) throw new AppError(422, "fee_plan_not_saved");
  if (g.blockedBy) throw new AppError(409, g.blockedBy);
  if (g.result.problems.length || !g.result.instalments.length) throw new AppError(422, "fee_plan_invalid");
  await saveBillingPlan(tx, auth, contractId, {
    activate: false,
    items: g.result.instalments.map((i) => ({
      description: i.description,
      taskId: i.taskId,
      amount: i.amount / 100,
      plannedDate: i.date,
    })),
  });
  return { instalments: g.result.instalments.length, total: g.result.total };
}

const MONTHS = [
  "januar",
  "februar",
  "marts",
  "april",
  "maj",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "december",
];
/** "2027-03-01" → "marts 2027" */
export const danishMonth = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

interface ExportRow {
  label: string;
  date: string;
  amount: number | null;
  sharePct: number | null;
  own: number | null;
  subs: (number | null)[];
}

/** The generated plan as an Excel sheet like Finance's: phase rows, instalments, sub-consultant columns, control row. */
export async function feePlanExport(
  tx: Tx,
  auth: AuthContext,
  contractId: string,
): Promise<ExportTable<ExportRow>> {
  const g = await feePlan(tx, auth, contractId);
  const r = g.result;
  const kr = (ore: number) => ore / 100;
  const rows: ExportRow[] = [];
  for (const ph of r.phases) {
    rows.push({
      label: ph.name,
      date: "",
      amount: kr(ph.total),
      sharePct: ph.shareBp / 100,
      own: kr(ph.own),
      subs: ph.subAmounts.map(kr),
    });
    for (const i of r.instalments.filter((x) => x.phaseKey === ph.key))
      rows.push({
        label: `   Rate ${i.sequence}`,
        date: danishMonth(i.date),
        amount: kr(i.amount),
        sharePct: null,
        own: kr(i.own),
        subs: i.subAmounts.map(kr),
      });
  }
  rows.push({
    label: "KONTROL",
    date: "",
    amount: kr(r.instalments.reduce((a, i) => a + i.amount, 0)),
    sharePct: 100,
    own: kr(r.own),
    subs: r.subTotals.map(kr),
  });
  const subs = g.input.subs;
  return {
    sheet: "Rateplan",
    file: `ARCtime_rateplan_${g.project.number}`,
    columns: [
      { header: "Fase / rate", kind: "text", value: (x) => x.label },
      { header: "Måned", kind: "text", value: (x) => x.date },
      { header: "Beløb (kr)", kind: "money", value: (x) => x.amount },
      { header: "Andel af honorar", kind: "percent", value: (x) => x.sharePct },
      { header: "ARCnordic (kr)", kind: "money", value: (x) => x.own },
      ...subs.map((s, j) => ({
        header: `${s.name} (kr)`,
        kind: "money" as const,
        value: (x: ExportRow) => x.subs[j] ?? null,
      })),
    ],
    rows,
  };
}
