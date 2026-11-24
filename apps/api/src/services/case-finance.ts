/**
 * Sagsøkonomi: case overview, case finance detail, billing plan (faktureringsplan) and the "rater klar til
 * fakturering" list — docs/spec/case-finance.md, decision D-029. GRASP Pure Fabrication: loads the rows and hands
 * them to the pure rules in @arc-tid/domain (case-finance.ts, billing-plan.ts); nothing is calculated here.
 *
 * Scope: Finance and Management see every customer case; a project manager sees only cases they manage
 * (not cases they are merely a member of). Employees and Admin without a finance role do not see the module.
 */
import {
  createSingleLineDraft,
  readyPlanItems,
  schema,
  type Tx,
  toPlanInstalment,
  writeAudit,
} from "@arc-tid/db";
import {
  acontoSuggestion,
  type CaseEntry,
  type CaseFilter,
  type CaseStatus,
  caseFinance,
  caseStatus,
  type FeeThresholds,
  type FeeType,
  feeTypeOf,
  feeWarningText,
  fromDecimal,
  instalmentAmounts,
  instalmentStatuses,
  kr,
  type LocalDate,
  matchesCaseFilter,
  nextInstalment,
  type PlanInstalment,
  todayCopenhagen,
  validatePlan,
} from "@arc-tid/domain";
import { and, asc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { type AuthContext, policyOf } from "../auth/plugin.ts";
import { AppError } from "./errors.ts";
import type { ExportTable } from "./export.ts";
import { assertCanInvoice } from "./invoices.ts";
import { receivableRows } from "./receivables.ts";

/** `<column> in (…ids)` for raw SQL that uses table aliases (drizzle's inArray would name the full table). */
export const inIds = (column: string, ids: readonly string[]) =>
  sql`${sql.raw(column)} in (${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;

/** Case ids the caller may see in the module: "all", or the cases they manage. Throws 403 without the right. */
export async function caseScope(tx: Tx, auth: AuthContext): Promise<string[] | "all"> {
  const policy = policyOf(auth);
  if (!policy.can("case_finance.view")) throw new AppError(403, "forbidden");
  if (policy.can("case_finance.view_all")) return "all";
  const rows = await tx
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.managerId, auth.userId));
  return rows.map((r) => r.id);
}

/** Throws 404 unless the caller may see this case in the module (404 so existence is not revealed). */
export async function assertCaseVisible(tx: Tx, auth: AuthContext, projectId: string) {
  const scope = await caseScope(tx, auth);
  if (scope !== "all" && !scope.includes(projectId)) throw new AppError(404, "not_found");
}

/** May the caller change the billing plan, phase flags and % complete? Finance, or the case's project manager. */
export async function canEditCase(tx: Tx, auth: AuthContext, projectId: string): Promise<boolean> {
  if (auth.roles.includes("finance")) return true;
  const [p] = await tx
    .select({ managerId: schema.projects.managerId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  return p?.managerId === auth.userId;
}

/** Tenant thresholds and the a conto switch. */
export async function caseFinanceSettings(tx: Tx) {
  const [t] = await tx
    .select({
      warningBp: schema.tenants.feeWarningBp,
      alertBp: schema.tenants.feeAlertBp,
      acontoEnabled: schema.tenants.acontoEnabled,
    })
    .from(schema.tenants);
  return t ?? { warningBp: 7500, alertBp: 10000, acontoEnabled: false };
}

/** Changes the fee thresholds or the a conto switch (Finance); audited. */
export async function updateCaseFinanceSettings(
  tx: Tx,
  auth: AuthContext,
  body: { warningBp?: number | undefined; alertBp?: number | undefined; acontoEnabled?: boolean | undefined },
) {
  if (!policyOf(auth).can("case_finance.settings")) throw new AppError(403, "forbidden");
  const before = await caseFinanceSettings(tx);
  const after = { ...before, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) };
  if (after.warningBp > after.alertBp) throw new AppError(422, "threshold_order");
  await tx
    .update(schema.tenants)
    .set({ feeWarningBp: after.warningBp, feeAlertBp: after.alertBp, acontoEnabled: after.acontoEnabled })
    .where(eq(schema.tenants.id, auth.tenantId));
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "tenant_settings",
    entityId: auth.tenantId,
    action: "update",
    userId: auth.userId,
    before,
    after,
  });
  return after;
}

/* ───────────────────────────── loading ───────────────────────────── */

type Contract = typeof schema.contracts.$inferSelect;
type PlanItem = typeof schema.paymentPlanItems.$inferSelect;
type Task = typeof schema.tasks.$inferSelect;

/** Everything about a set of cases that the calculations need, loaded in a few queries. */
async function loadCaseData(tx: Tx, scope: string[] | "all", onlyId?: string) {
  const ids = onlyId ? [onlyId] : scope;
  if (ids !== "all" && !ids.length) return null;
  const idFilter = ids === "all" ? undefined : inArray(schema.projects.id, ids);
  const projects = await tx
    .select({
      id: schema.projects.id,
      number: schema.projects.number,
      name: schema.projects.name,
      status: schema.projects.status,
      customerId: schema.projects.customerId,
      customerName: schema.customers.name,
      managerId: schema.projects.managerId,
      managerName: schema.users.fullName,
    })
    .from(schema.projects)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.projects.customerId))
    .leftJoin(schema.users, eq(schema.users.id, schema.projects.managerId))
    .where(and(ne(schema.projects.status, "archived"), idFilter))
    .orderBy(asc(schema.projects.number));
  const projectIds = projects.map((p) => p.id);
  if (!projectIds.length) return null;

  const contracts = await tx
    .select()
    .from(schema.contracts)
    .where(inArray(schema.contracts.projectId, projectIds));
  const tasks = await tx
    .select()
    .from(schema.tasks)
    .where(inArray(schema.tasks.projectId, projectIds))
    .orderBy(asc(schema.tasks.sort), asc(schema.tasks.wbs));
  const planItems = contracts.length
    ? await tx
        .select()
        .from(schema.paymentPlanItems)
        .where(
          inArray(
            schema.paymentPlanItems.contractId,
            contracts.map((c) => c.id),
          ),
        )
        .orderBy(asc(schema.paymentPlanItems.sequence), asc(schema.paymentPlanItems.dueDate))
    : [];

  // Time entries: rate snapshot when approved, otherwise the current estimate (the member's own price on the case,
  // D-038, then the contract rate, then the employee rate).
  const entries = await tx.execute<{
    project_id: string;
    task_id: string;
    user_id: string;
    hours: string;
    billable: boolean;
    status: CaseEntry["status"];
    sales_rate: string;
    cost_rate: string;
    contract_type: Contract["type"] | null;
  }>(sql`
    select te.project_id, te.task_id, te.user_id, te.hours, te.billable, te.status,
      coalesce(te.sales_rate,
        (select r.rate from project_employee_rates r
          where r.project_id = te.project_id and r.user_id = te.user_id and r.valid_from <= te.date
          order by r.valid_from desc limit 1),
        c.hourly_rate, u.sales_rate, 0) as sales_rate,
      coalesce(te.cost_rate, u.cost_rate, 0) as cost_rate,
      c.type as contract_type
    from time_entries te
    join users u on u.id = te.user_id
    join tasks t on t.id = te.task_id
    left join contracts c on c.id = t.contract_id
    where ${inIds("te.project_id", projectIds)} and te.status <> 'rejected'`);

  // Booked invoice lines (net) per case; credit notes carry negative amounts. "On fee" = instalment/a conto lines.
  const invoiced = await tx.execute<{ project_id: string; on_fee: boolean; amount: string }>(sql`
    select il.project_id, (il.kind = 'milestone') as on_fee, coalesce(sum(il.amount), 0) as amount
    from invoice_lines il join invoices i on i.id = il.invoice_id
    where i.status = 'booked' and il.kind in ('time', 'expense', 'milestone', 'product')
      and ${inIds("il.project_id", projectIds)}
    group by il.project_id, (il.kind = 'milestone')`);

  const users = await tx
    .select({ id: schema.users.id, fullName: schema.users.fullName, initials: schema.users.initials })
    .from(schema.users);
  // sub-consultants' invoices per case (D-041): part of the case's cost
  const subCosts = await tx.execute<{ project_id: string; amount: string }>(sql`
    select project_id, coalesce(sum(amount), 0) as amount from subconsultant_invoices
    where ${inIds("project_id", projectIds)} group by project_id`);
  return { projects, contracts, tasks, planItems, entries, invoiced, users, subCosts };
}

type CaseData = NonNullable<Awaited<ReturnType<typeof loadCaseData>>>;

/** Fee type of a case: fast honorar when it has a fixed-price or retainer contract, else medgået tid. */
function caseFeeType(contracts: Contract[]): FeeType {
  return contracts.some((c) => feeTypeOf(c.type) === "fast_honorar") ? "fast_honorar" : "medgaaet_tid";
}

/** Fee of a case: fixed prices plus the retainers' fee schedules. */
function caseFee(contracts: Contract[], items: PlanItem[]): number {
  return contracts.reduce((sum, c) => {
    if (c.type === "fixed_price") return sum + (c.price ?? 0);
    if (c.type === "retainer")
      return sum + items.filter((i) => i.contractId === c.id).reduce((a, i) => a + i.amount, 0);
    return sum;
  }, 0);
}

/** Plan items and their computed status/amount per contract. */
function planOf(contract: Contract, items: PlanItem[], tasks: Task[], today: LocalDate) {
  const closed = new Set(tasks.filter((t) => t.status === "closed").map((t) => t.id));
  const own = items.filter((i) => i.contractId === contract.id);
  const inst = own.map((i) => toPlanInstalment(i, closed));
  const statuses = instalmentStatuses(inst, today);
  return { own, inst, statuses };
}

/** One overview row: the domain's case finance plus labels, next instalment and status. */
function buildRow(d: CaseData, p: CaseData["projects"][number], t: FeeThresholds, today: LocalDate) {
  const contracts = d.contracts.filter((c) => c.projectId === p.id);
  const tasks = d.tasks.filter((x) => x.projectId === p.id);
  const items = d.planItems.filter((i) => contracts.some((c) => c.id === i.contractId));
  const feeType = caseFeeType(contracts);
  const entries: CaseEntry[] = d.entries
    .filter((e) => e.project_id === p.id)
    .map((e) => ({
      userId: e.user_id,
      taskId: e.task_id,
      hours: fromDecimal(Number(e.hours)),
      salesRate: Number(e.sales_rate),
      costRate: Number(e.cost_rate),
      billable: e.billable,
      status: e.status,
      timeAndMaterial: e.contract_type ? e.contract_type === "time_material" : feeType === "medgaaet_tid",
    }));
  // Instalments marked invoiced without an invoice line were invoiced before go-live (opening balance).
  const historic = items
    .filter((i) => i.status === "invoiced" && !i.invoiceLineId)
    .reduce((a, i) => a + i.amount, 0);
  const lines = d.invoiced.filter((r) => r.project_id === p.id);
  const onFee = lines.filter((r) => r.on_fee).reduce((a, r) => a + Number(r.amount), 0) + historic;
  const all = lines.reduce((a, r) => a + Number(r.amount), 0) + historic;
  const f = caseFinance({
    feeType,
    fee: feeType === "fast_honorar" ? caseFee(contracts, items) : null,
    entries,
    invoicedTotal: all,
    invoicedAgainstFee: onFee,
    externalCost: Number(d.subCosts.find((x) => x.project_id === p.id)?.amount ?? 0),
    thresholds: t,
  });

  let ready = 0;
  let readyAmount = 0;
  let next: { date: LocalDate; amount: number; description: string; status: string } | null = null;
  for (const c of contracts.filter((x) => x.type !== "time_material" && x.planActive)) {
    const { own, inst, statuses } = planOf(c, items, tasks, today);
    for (const i of own)
      if (statuses.get(i.id) === "klar" && !i.invoiceLineId) {
        ready++;
        readyAmount += i.amount;
      }
    const n = nextInstalment(inst);
    const item = n && own.find((i) => i.id === n.id);
    if (item && (!next || item.dueDate < next.date))
      next = {
        date: item.dueDate,
        amount: item.amount,
        description: item.description,
        status: statuses.get(item.id) ?? "",
      };
  }
  const status: CaseStatus = caseStatus(f, ready);
  return {
    id: p.id,
    number: p.number,
    name: p.name,
    projectStatus: p.status,
    customerId: p.customerId ?? "",
    customerName: p.customerName,
    managerId: p.managerId,
    managerName: p.managerName,
    feeType,
    hours: f.hours.total / 100,
    forbrugt: f.forbrugt,
    kostpris: f.kostpris,
    underraadgivere: f.externalCost,
    faktureret: f.faktureret,
    ikkeFaktureret: f.ikkeFaktureret,
    fee: f.fee,
    resthonorar: f.resthonorar,
    forbrugtPct: f.forbrugtPct,
    feeLevel: f.feeLevel,
    feeWarning:
      f.feeLevel && f.feeLevel !== "ok" && f.forbrugtPct !== null ? feeWarningText(f.forbrugtPct) : null,
    nextInstalment: next,
    readyInstalments: ready,
    readyAmount,
    caseStatus: status,
    _finance: f,
  };
}

export type CaseRow = Omit<ReturnType<typeof buildRow>, "_finance">;

/** Sagsoversigt: one row per customer case in scope, the summary cards and the filter options. */
export async function caseOverview(
  tx: Tx,
  auth: AuthContext,
  filter: CaseFilter = {},
  today = todayCopenhagen(),
) {
  const scope = await caseScope(tx, auth);
  const d = await loadCaseData(tx, scope);
  const settings = await caseFinanceSettings(tx);
  const all = d ? d.projects.map((p) => stripFinance(buildRow(d, p, settings, today))) : [];
  const rows = all.filter((r) => matchesCaseFilter(r, filter));
  return {
    rows,
    cards: {
      activeCases: rows.filter((r) => r.projectStatus === "active").length,
      canInvoiceNow: rows.reduce((a, r) => a + r.ikkeFaktureret + r.readyAmount, 0),
      instalmentsReady: rows.reduce((a, r) => a + r.readyInstalments, 0),
      casesAtRisk: rows.filter(
        (r) => r.caseStatus === "overskridelsesrisiko" || r.caseStatus === "honorar_overskredet",
      ).length,
    },
    options: {
      managers: uniqueBy(
        all.flatMap((r) => (r.managerId ? [{ id: r.managerId, name: r.managerName ?? "" }] : [])),
      ),
      customers: uniqueBy(all.map((r) => ({ id: r.customerId, name: r.customerName }))),
    },
    settings,
  };
}

const stripFinance = ({ _finance, ...row }: ReturnType<typeof buildRow>): CaseRow => row;
const uniqueBy = (xs: { id: string; name: string }[]) =>
  [...new Map(xs.map((x) => [x.id, x])).values()].sort((a, b) => a.name.localeCompare(b.name, "da"));

const FEE_LABEL: Record<FeeType, string> = { medgaaet_tid: "Medgået tid", fast_honorar: "Fast honorar" };
const STATUS_LABEL: Record<CaseStatus, string> = {
  honorar_overskredet: "Honorar overskredet",
  overskridelsesrisiko: "Overskridelsesrisiko",
  rate_klar: "Rate klar",
  kan_faktureres: "Kan faktureres",
  ajour: "Ajour",
};
/** The case overview as an export table (same filters as the screen), with totals for hours and amounts. */
export function caseOverviewExport(rows: CaseRow[], today: LocalDate): ExportTable<CaseRow> {
  const kr = (minor: number | null) => (minor === null ? null : minor / 100);
  return {
    sheet: "Sagsoversigt",
    file: `ARCtime_sagsoversigt_${today}`,
    rows,
    columns: [
      { header: "Sagsnr.", kind: "text", value: (r) => r.number },
      { header: "Sag", kind: "text", value: (r) => r.name },
      { header: "Kunde", kind: "text", value: (r) => r.customerName },
      { header: "Projektleder", kind: "text", value: (r) => r.managerName },
      { header: "Honorarform", kind: "text", value: (r) => FEE_LABEL[r.feeType] },
      { header: "Timer", kind: "hours", value: (r) => r.hours, total: true },
      { header: "Forbrugt", kind: "money", value: (r) => kr(r.forbrugt), total: true },
      { header: "Faktureret", kind: "money", value: (r) => kr(r.faktureret), total: true },
      { header: "Ikke faktureret", kind: "money", value: (r) => kr(r.ikkeFaktureret), total: true },
      { header: "Honorar", kind: "money", value: (r) => kr(r.fee), total: true },
      { header: "Rest", kind: "money", value: (r) => kr(r.resthonorar), total: true },
      { header: "Næste rate (dato)", kind: "date", value: (r) => r.nextInstalment?.date },
      { header: "Næste rate (beløb)", kind: "money", value: (r) => kr(r.nextInstalment?.amount ?? null) },
      { header: "Status", kind: "text", value: (r) => STATUS_LABEL[r.caseStatus] },
    ],
  };
}

/** Case page for finance: the overview row, phase budget, hours per employee, billing plan and invoice history. */
export async function caseFinanceDetail(
  tx: Tx,
  auth: AuthContext,
  projectId: string,
  today = todayCopenhagen(),
) {
  await assertCaseVisible(tx, auth, projectId);
  const scope = await caseScope(tx, auth);
  const d = await loadCaseData(tx, scope, projectId);
  const p = d?.projects[0];
  if (!d || !p) throw new AppError(404, "not_found");
  const settings = await caseFinanceSettings(tx);
  const row = buildRow(d, p, settings, today);
  const f = row._finance;
  const tasks = d.tasks.filter((t) => t.projectId === p.id);
  const contracts = d.contracts.filter((c) => c.projectId === p.id);

  // a conto: already invoiced per phase (drafts included, so a suggestion is never made twice)
  const aconto = await tx
    .select({
      taskId: schema.invoiceLines.acontoTaskId,
      amount: sql<string>`coalesce(sum(${schema.invoiceLines.amount}), 0)`,
    })
    .from(schema.invoiceLines)
    .where(and(eq(schema.invoiceLines.projectId, p.id), isNotNull(schema.invoiceLines.acontoTaskId)))
    .groupBy(schema.invoiceLines.acontoTaskId);
  const acontoBy = new Map(aconto.map((a) => [a.taskId ?? "", Number(a.amount)]));

  const phases = tasks.map((t) => {
    const invoicedAconto = acontoBy.get(t.id) ?? 0;
    return {
      id: t.id,
      wbs: t.wbs,
      name: t.name,
      level: t.level,
      status: t.status,
      extraWork: t.extraWork,
      budgetHours: Number(t.budgetHours),
      budgetAmount: t.budgetAmount,
      hours: (f.hours.byTask.get(t.id) ?? 0) / 100,
      forbrugt: f.forbrugtByTask.get(t.id) ?? 0,
      completionBp: t.completionBp,
      acontoInvoiced: invoicedAconto,
      acontoSuggestion:
        settings.acontoEnabled && t.completionBp !== null && t.budgetAmount > 0 && !t.extraWork
          ? acontoSuggestion(t.budgetAmount, t.completionBp, invoicedAconto)
          : null,
    };
  });
  const names = new Map(d.users.map((u) => [u.id, u]));
  const employees = [...f.hours.byUser.entries()]
    .map(([userId, h]) => ({
      userId,
      name: names.get(userId)?.fullName ?? "",
      initials: names.get(userId)?.initials ?? "",
      hours: h / 100,
      forbrugt: f.forbrugtByUser.get(userId) ?? 0,
    }))
    .sort((a, b) => b.hours - a.hours);

  const plans = contracts
    .filter((c) => c.type !== "time_material")
    .map((c) => {
      const { own, inst, statuses } = planOf(c, d.planItems, tasks, today);
      const validation = c.type === "fixed_price" ? validatePlan(c.price ?? 0, inst) : null;
      return {
        contractId: c.id,
        name: c.name,
        type: c.type,
        price: c.price,
        planActive: c.planActive,
        validation,
        items: own.map((i) => ({
          id: i.id,
          sequence: i.sequence,
          description: i.description,
          taskId: i.taskId,
          percentageBp: i.percentageBp,
          amount: i.amount,
          plannedDate: i.dueDate,
          // A draft plan shows its instalments as "afventer" until finance activates it.
          status: c.planActive ? statuses.get(i.id) : i.status === "invoiced" ? "faktureret" : "afventer",
          reserved: Boolean(i.invoiceLineId) && i.status !== "invoiced",
          locked: Boolean(i.invoiceLineId) || i.status === "invoiced",
        })),
      };
    });

  const invoices = await caseInvoices(tx, p.id, today);
  return {
    ...stripFinance(row),
    phases,
    employees,
    plans,
    invoices,
    settings,
    canEdit: await canEditCase(tx, auth, p.id),
    canInvoice: policyOf(auth).can("invoice.prepare"),
  };
}

/** Invoice history of a case (booked invoices and drafts, newest first) with paid / outstanding. */
async function caseInvoices(tx: Tx, projectId: string, today: LocalDate) {
  const booked = await receivableRows(tx, { projectIds: [projectId] }, today);
  const drafts = await tx
    .select({
      id: schema.invoices.id,
      invoiceDate: schema.invoices.invoiceDate,
      subtotal: schema.invoices.subtotal,
      total: schema.invoices.total,
      status: schema.invoices.status,
    })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.projectId, projectId), ne(schema.invoices.status, "booked")));
  return { booked, drafts };
}

/* ───────────────────────────── billing plan ───────────────────────────── */

/** One instalment as sent by the plan editor. Percentages are whole or decimal percent (20 = 20 %), amounts kr. */
export interface PlanItemInput {
  id?: string | undefined;
  description: string;
  taskId?: string | null | undefined;
  percentage?: number | null | undefined;
  amount?: number | null | undefined;
  plannedDate: LocalDate;
}

/**
 * Saves a contract's billing plan: replaces the instalments that are not on an invoice, keeps invoiced/reserved
 * ones unchanged, numbers them in the given order and derives amounts from percentages. `activate` requires the
 * plan to add up to exactly 100 % of the fee (fixed price); a retainer's fee schedule has no 100 % rule.
 */
export async function saveBillingPlan(
  tx: Tx,
  auth: AuthContext,
  contractId: string,
  input: { items: PlanItemInput[]; activate: boolean },
) {
  const [c] = await tx.select().from(schema.contracts).where(eq(schema.contracts.id, contractId));
  if (!c) throw new AppError(404, "not_found");
  await assertCaseVisible(tx, auth, c.projectId);
  if (!(await canEditCase(tx, auth, c.projectId))) throw new AppError(403, "forbidden");
  if (c.type === "time_material") throw new AppError(422, "plan_only_for_fixed_price_or_retainer");

  const existing = await tx
    .select()
    .from(schema.paymentPlanItems)
    .where(eq(schema.paymentPlanItems.contractId, c.id));
  const locked = existing.filter((i) => i.invoiceLineId || i.status === "invoiced");
  const sentIds = new Set(input.items.flatMap((i) => (i.id ? [i.id] : [])));
  for (const l of locked) {
    const sent = input.items.find((i) => i.id === l.id);
    if (!sent) throw new AppError(409, "plan_item_invoiced");
    const sentAmount = sent.amount != null ? kr(sent.amount) : null;
    const sentPct = sent.percentage != null ? Math.round(sent.percentage * 100) : null;
    if ((sentPct !== null && sentPct !== l.percentageBp) || (sentPct === null && sentAmount !== l.amount))
      throw new AppError(409, "plan_item_invoiced");
  }
  const phaseIds = input.items.flatMap((i) => (i.taskId ? [i.taskId] : []));
  if (phaseIds.length) {
    const own = await tx
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(and(inArray(schema.tasks.id, phaseIds), eq(schema.tasks.projectId, c.projectId)));
    if (own.length !== new Set(phaseIds).size) throw new AppError(422, "phase_not_on_case");
  }
  if (c.type === "retainer" && input.items.some((i) => i.percentage != null))
    throw new AppError(422, "retainer_needs_amounts");

  const drafts: (PlanInstalment & { input: PlanItemInput })[] = input.items.map((i, idx) => ({
    id: i.id ?? `new-${idx}`,
    sequence: idx + 1,
    percentageBp: i.percentage != null ? Math.round(i.percentage * 100) : null,
    amount: i.percentage != null ? null : i.amount != null ? kr(i.amount) : null,
    plannedDate: i.plannedDate,
    invoiced: false,
    input: i,
  }));
  const fee = c.type === "fixed_price" ? (c.price ?? 0) : drafts.reduce((a, i) => a + (i.amount ?? 0), 0);
  const validation = validatePlan(fee, drafts);
  if (input.activate && c.type === "fixed_price" && !validation.ok)
    throw new AppError(422, validation.code, { totalBp: validation.totalBp, total: validation.total });
  if (input.activate && !input.items.length) throw new AppError(422, "plan_empty");
  const amounts = instalmentAmounts(fee, drafts);

  const lockedIds = new Set(locked.map((l) => l.id));
  const toDelete = existing.filter((e) => !lockedIds.has(e.id) && !sentIds.has(e.id)).map((e) => e.id);
  if (toDelete.length)
    await tx.delete(schema.paymentPlanItems).where(inArray(schema.paymentPlanItems.id, toDelete));
  for (const dft of drafts) {
    const values = {
      description: dft.input.description,
      dueDate: dft.plannedDate,
      amount: amounts.get(dft.id) ?? 0,
      sequence: dft.sequence,
      taskId: dft.input.taskId ?? null,
      percentageBp: dft.percentageBp,
    };
    const prior = existing.find((e) => e.id === dft.input.id);
    if (prior && lockedIds.has(prior.id)) {
      // invoiced/reserved: only the order and the text may change
      await tx
        .update(schema.paymentPlanItems)
        .set({ sequence: values.sequence, description: values.description })
        .where(eq(schema.paymentPlanItems.id, prior.id));
    } else if (prior) {
      await tx.update(schema.paymentPlanItems).set(values).where(eq(schema.paymentPlanItems.id, prior.id));
    } else {
      await tx
        .insert(schema.paymentPlanItems)
        .values({ tenantId: auth.tenantId, contractId: c.id, ...values });
    }
  }
  await tx.update(schema.contracts).set({ planActive: input.activate }).where(eq(schema.contracts.id, c.id));
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "payment_plan",
    entityId: c.id,
    action: input.activate ? "activate" : "save_draft",
    userId: auth.userId,
    before: existing,
    after: {
      items: drafts.map((x) => ({ ...x.input, amount: amounts.get(x.id) })),
      totalBp: validation.totalBp,
    },
  });
  return { planActive: input.activate, validation };
}

/** "Fakturér rate": an invoice draft with one line for a klar instalment; returns the draft's id. */
export async function invoiceInstalment(
  tx: Tx,
  auth: AuthContext,
  planItemId: string,
  today = todayCopenhagen(),
) {
  const [item] = await tx
    .select()
    .from(schema.paymentPlanItems)
    .where(eq(schema.paymentPlanItems.id, planItemId));
  if (!item) throw new AppError(404, "not_found");
  const [c] = await tx.select().from(schema.contracts).where(eq(schema.contracts.id, item.contractId));
  if (!c) throw new AppError(404, "not_found");
  await assertCaseVisible(tx, auth, c.projectId);
  if (!policyOf(auth).can("invoice.prepare")) throw new AppError(403, "forbidden");
  await assertCanInvoice(tx, auth, [c.projectId]);
  if (item.invoiceLineId) throw new AppError(409, "plan_item_on_draft");
  const ready = await readyPlanItems(tx, [c], today);
  if (!ready.some((r) => r.id === item.id)) throw new AppError(409, "instalment_not_ready");
  const invoiceId = await createSingleLineDraft(tx, {
    tenantId: auth.tenantId,
    userId: auth.userId,
    projectId: c.projectId,
    invoiceDate: today,
    description: item.description,
    amount: item.amount,
    paymentPlanItemId: item.id,
  });
  return { invoiceId };
}

/** "Rater klar til fakturering": every klar, not-yet-drafted instalment across the cases in scope. */
export async function readyInstalments(tx: Tx, auth: AuthContext, today = todayCopenhagen()) {
  const scope = await caseScope(tx, auth);
  const d = await loadCaseData(tx, scope);
  if (!d) return [];
  const ready = await readyPlanItems(
    tx,
    d.contracts.filter((c) => c.planActive),
    today,
  );
  return ready
    .map((i) => {
      const c = d.contracts.find((x) => x.id === i.contractId);
      const p = d.projects.find((x) => x.id === c?.projectId);
      return {
        id: i.id,
        caseId: p?.id ?? "",
        caseNumber: p?.number ?? "",
        caseName: p?.name ?? "",
        customerName: p?.customerName ?? "",
        managerName: p?.managerName ?? null,
        description: i.description,
        plannedDate: i.dueDate,
        amount: i.amount,
      };
    })
    .filter((r) => r.caseId);
}

/* ───────────────────────────── phases: ekstraarbejde, % complete, a conto ───────────────────────────── */

/**
 * Flags a phase (and its sub-phases) as ekstraarbejde on a fixed-fee case, or back. Extra work is linked to the
 * case's time & material contract (created as "Ekstraarbejde, medgået tid" if missing), so its hours are billed
 * as medgået tid outside the fee. Not allowed once hours on the phase are on an invoice.
 */
export async function setExtraWork(tx: Tx, auth: AuthContext, taskId: string, extraWork: boolean) {
  const [task] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
  if (!task) throw new AppError(404, "not_found");
  await assertCaseVisible(tx, auth, task.projectId);
  if (!(await canEditCase(tx, auth, task.projectId))) throw new AppError(403, "forbidden");
  const contracts = await tx
    .select()
    .from(schema.contracts)
    .where(eq(schema.contracts.projectId, task.projectId));
  const fixed = contracts.find((c) => c.type !== "time_material");
  if (!fixed) throw new AppError(422, "extra_work_only_on_fixed_fee");
  const subtree = await tx
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.projectId, task.projectId),
        sql`(${schema.tasks.id} = ${task.id} or ${schema.tasks.wbs} like ${`${task.wbs}.%`})`,
      ),
    );
  const ids = subtree.map((t) => t.id);
  const [onInvoice] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.timeEntries)
    .where(and(inArray(schema.timeEntries.taskId, ids), isNotNull(schema.timeEntries.invoiceLineId)));
  if ((onInvoice?.n ?? 0) > 0) throw new AppError(409, "phase_has_invoiced_hours");

  let target = fixed.id;
  if (extraWork) {
    const tm = contracts.find((c) => c.type === "time_material");
    if (tm) target = tm.id;
    else {
      const [created] = await tx
        .insert(schema.contracts)
        .values({
          tenantId: auth.tenantId,
          projectId: task.projectId,
          name: "Ekstraarbejde, medgået tid",
          type: "time_material",
        })
        .returning();
      target = created?.id ?? fixed.id;
    }
  }
  await tx.update(schema.tasks).set({ extraWork, contractId: target }).where(inArray(schema.tasks.id, ids));
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "task",
    entityId: task.id,
    action: "extra_work",
    userId: auth.userId,
    before: { extraWork: task.extraWork, contractId: task.contractId },
    after: { extraWork, contractId: target, phases: ids.length },
  });
  return { extraWork, contractId: target };
}

/** The project manager's % complete on a phase (for a conto), 0–100 % in basis points, or null to clear. */
export async function setCompletion(tx: Tx, auth: AuthContext, taskId: string, completionBp: number | null) {
  const [task] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
  if (!task) throw new AppError(404, "not_found");
  await assertCaseVisible(tx, auth, task.projectId);
  if (!(await canEditCase(tx, auth, task.projectId))) throw new AppError(403, "forbidden");
  if (completionBp !== null && (completionBp < 0 || completionBp > 10_000))
    throw new AppError(422, "completion_range");
  await tx.update(schema.tasks).set({ completionBp }).where(eq(schema.tasks.id, task.id));
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "task",
    entityId: task.id,
    action: "completion",
    userId: auth.userId,
    before: { completionBp: task.completionBp },
    after: { completionBp },
  });
  return { completionBp };
}

/** A conto invoice draft for a phase: phase fee × % complete − already invoiced (only when the setting is on). */
export async function invoiceAconto(tx: Tx, auth: AuthContext, taskId: string, today = todayCopenhagen()) {
  const settings = await caseFinanceSettings(tx);
  if (!settings.acontoEnabled) throw new AppError(409, "aconto_disabled");
  const [task] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
  if (!task) throw new AppError(404, "not_found");
  await assertCaseVisible(tx, auth, task.projectId);
  if (!policyOf(auth).can("invoice.prepare")) throw new AppError(403, "forbidden");
  await assertCanInvoice(tx, auth, [task.projectId]);
  if (task.completionBp === null) throw new AppError(422, "completion_missing");
  const [done] = await tx
    .select({ amount: sql<string>`coalesce(sum(${schema.invoiceLines.amount}), 0)` })
    .from(schema.invoiceLines)
    .where(eq(schema.invoiceLines.acontoTaskId, task.id));
  const amount = acontoSuggestion(task.budgetAmount, task.completionBp, Number(done?.amount ?? 0));
  if (amount <= 0) throw new AppError(409, "nothing_to_invoice");
  const pct = new Intl.NumberFormat("da-DK", { maximumFractionDigits: 1 }).format(task.completionBp / 100);
  const invoiceId = await createSingleLineDraft(tx, {
    tenantId: auth.tenantId,
    userId: auth.userId,
    projectId: task.projectId,
    invoiceDate: today,
    description: `A conto ${task.name} (${pct} % færdig)`,
    amount,
    acontoTaskId: task.id,
  });
  return { invoiceId, amount };
}
