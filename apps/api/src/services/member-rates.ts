/**
 * A project member's own hourly price on a case — decision D-038 (Finance feedback: "flere timepriser, dropdown med
 * standardpriser eller manuel pris"). GRASP Information Expert for the choices and the stored price; the rate
 * resolution itself stays in @arc-tid/domain (rates.ts, step 1 "project_employee").
 *
 *   choices   the case's own hourly rate (the contract), every person-level line of the customer's price list and of
 *             the standard price list valid today, or a price typed in by hand
 *   applies   to every hour that is not approved yet; approved hours keep the price snapshotted at approval
 *   who       the project's manager, Finance or Admin (same as editing the team); every change is audited
 */
import { schema, type Tx, writeAudit } from "@arc-tid/db";
import { todayCopenhagen } from "@arc-tid/domain";
import { and, eq, inArray, lte } from "drizzle-orm";
import type { AuthContext } from "../auth/plugin.ts";
import { AppError } from "./errors.ts";
import { canEditProject } from "./projects.ts";

/** A member price applies to all not-yet-approved hours, so it is valid from the beginning of time. */
const ALWAYS = "1900-01-01";

/** One choice in the price dropdown (øre per hour). */
export interface RateChoice {
  label: string;
  rate: number;
  list: string;
}

/** The case's own hourly rate plus the person-level lines of the customer's and the standard price list. */
export async function rateChoices(tx: Tx, projectId: string, today = todayCopenhagen()) {
  const [p] = await tx
    .select({ billable: schema.projects.billable, customerListId: schema.customers.priceListId })
    .from(schema.projects)
    .leftJoin(schema.customers, eq(schema.customers.id, schema.projects.customerId))
    .where(eq(schema.projects.id, projectId));
  if (!p) throw new AppError(404, "not_found");
  const contracts = await tx
    .select({ hourlyRate: schema.contracts.hourlyRate })
    .from(schema.contracts)
    .where(eq(schema.contracts.projectId, projectId));
  const caseRate = contracts.find((c) => c.hourlyRate !== null)?.hourlyRate ?? null;

  const [standard] = await tx
    .select({ id: schema.priceLists.id })
    .from(schema.priceLists)
    .where(eq(schema.priceLists.isStandard, true))
    .limit(1);
  const listIds = [p.customerListId, standard?.id].filter((x): x is string => Boolean(x));
  const lines = listIds.length
    ? await tx
        .select({
          listId: schema.priceListRates.priceListId,
          list: schema.priceLists.name,
          group: schema.priceGroups.name,
          taskTypeId: schema.priceListRates.taskTypeId,
          rate: schema.priceListRates.rate,
          validFrom: schema.priceListRates.validFrom,
        })
        .from(schema.priceListRates)
        .innerJoin(schema.priceLists, eq(schema.priceLists.id, schema.priceListRates.priceListId))
        .leftJoin(schema.priceGroups, eq(schema.priceGroups.id, schema.priceListRates.priceGroupId))
        .where(
          and(
            inArray(schema.priceListRates.priceListId, listIds),
            lte(schema.priceListRates.validFrom, today),
          ),
        )
    : [];
  // a member price is per person, so lines for one task type do not apply; per group keep the newest line
  const newest = new Map<string, (typeof lines)[number]>();
  for (const l of lines.filter((x) => x.taskTypeId === null)) {
    const key = `${l.listId}|${l.group ?? ""}`;
    const prev = newest.get(key);
    if (!prev || l.validFrom > prev.validFrom) newest.set(key, l);
  }
  const order = (id: string) => (id === p.customerListId ? 0 : 1);
  const choices: RateChoice[] = [...newest.values()]
    .sort((a, b) => order(a.listId) - order(b.listId) || b.rate - a.rate)
    .map((l) => ({ label: `${l.group ?? "Alle"} · ${l.list}`, rate: l.rate, list: l.list }));
  return { billable: p.billable, caseRate, choices };
}

/** The stored member prices of a case: userId → { rate (øre), label (null = typed in by hand) }. */
export async function memberRates(tx: Tx, projectId: string) {
  const rows = await tx
    .select({
      userId: schema.projectEmployeeRates.userId,
      rate: schema.projectEmployeeRates.rate,
      label: schema.projectEmployeeRates.label,
    })
    .from(schema.projectEmployeeRates)
    .where(eq(schema.projectEmployeeRates.projectId, projectId));
  return new Map(rows.map((r) => [r.userId, { rate: r.rate, label: r.label }]));
}

/**
 * Sets (or with `rate: null` removes) a member's price on a case. `rate` in øre per hour. A `label` is kept only when
 * it names a current price list line with exactly that price; anything else is stored as a manual price.
 */
export async function setMemberRate(
  tx: Tx,
  auth: AuthContext,
  projectId: string,
  userId: string,
  b: { rate: number | null; label?: string | null | undefined },
) {
  if (!(await canEditProject(tx, auth, projectId))) throw new AppError(403, "forbidden");
  const [member] = await tx
    .select({ fullName: schema.users.fullName })
    .from(schema.projectMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId))
    .where(and(eq(schema.projectMembers.projectId, projectId), eq(schema.projectMembers.userId, userId)));
  if (!member) throw new AppError(404, "not_found");
  const { billable, choices } = await rateChoices(tx, projectId);
  if (!billable && b.rate !== null) throw new AppError(422, "rate_not_billable");

  const before = (await memberRates(tx, projectId)).get(userId) ?? null;
  const where = and(
    eq(schema.projectEmployeeRates.projectId, projectId),
    eq(schema.projectEmployeeRates.userId, userId),
  );
  let label: string | null = null;
  if (b.rate === null) {
    if (!before) return { ok: true };
    await tx.delete(schema.projectEmployeeRates).where(where);
  } else {
    label = choices.find((c) => c.label === b.label && c.rate === b.rate)?.label ?? null;
    await tx
      .insert(schema.projectEmployeeRates)
      .values({ tenantId: auth.tenantId, projectId, userId, rate: b.rate, validFrom: ALWAYS, label })
      .onConflictDoUpdate({
        target: [schema.projectEmployeeRates.projectId, schema.projectEmployeeRates.userId],
        set: { rate: b.rate, label, validFrom: ALWAYS },
      });
  }
  const source = (r: { rate: number; label: string | null } | null) =>
    r === null ? "Sagens timepris" : (r.label ?? "Manuel pris");
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "project",
    entityId: projectId,
    action: "member_rate",
    userId: auth.userId,
    before: { member: member.fullName, hourlyRate: before?.rate ?? null, priceSource: source(before) },
    after: {
      member: member.fullName,
      hourlyRate: b.rate,
      priceSource: source(b.rate === null ? null : { rate: b.rate, label }),
    },
  });
  return { ok: true };
}
