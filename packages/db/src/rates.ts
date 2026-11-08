/**
 * Loads rate-resolution inputs from the database and snapshots sales/cost rates on time entries
 * (brief §4.9, decision D-014). Used by the API at approval and by the seed script, so both agree.
 */
import { type PriceListRate, resolveRate } from "@arc-tid/domain";
import { eq, inArray } from "drizzle-orm";
import type { Tx } from "./client.ts";
import * as s from "./schema.ts";

const CATCH_ALL_FROM = "1900-01-01";

/**
 * Resolves and stores the sales rate (billable entries only) and cost rate (øre/h) on the given time entries.
 * Called at approval and by the seed so history never changes when rates change later. Returns the number updated.
 */
export async function snapshotRates(tx: Tx, entryIds: string[]): Promise<number> {
  if (!entryIds.length) return 0;
  const rows = await tx
    .select({
      id: s.timeEntries.id,
      date: s.timeEntries.date,
      billable: s.timeEntries.billable,
      userId: s.timeEntries.userId,
      projectId: s.timeEntries.projectId,
      taskTypeId: s.tasks.taskTypeId,
      contractRate: s.contracts.hourlyRate,
      projectListId: s.projects.priceListId,
      customerListId: s.customers.priceListId,
      priceGroupId: s.users.priceGroupId,
      salesRate: s.users.salesRate,
      costRate: s.users.costRate,
    })
    .from(s.timeEntries)
    .innerJoin(s.users, eq(s.users.id, s.timeEntries.userId))
    .leftJoin(s.tasks, eq(s.tasks.id, s.timeEntries.taskId))
    .leftJoin(s.contracts, eq(s.contracts.id, s.tasks.contractId))
    .leftJoin(s.projects, eq(s.projects.id, s.timeEntries.projectId))
    .leftJoin(s.customers, eq(s.customers.id, s.projects.customerId))
    .where(inArray(s.timeEntries.id, entryIds));

  const [standard] = await tx
    .select({ id: s.priceLists.id })
    .from(s.priceLists)
    .where(eq(s.priceLists.isStandard, true))
    .limit(1);
  const listIds = [
    ...new Set(
      rows
        .flatMap((r) => [r.projectListId, r.customerListId])
        .concat(standard?.id ?? null)
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  const listRates = listIds.length
    ? await tx.select().from(s.priceListRates).where(inArray(s.priceListRates.priceListId, listIds))
    : [];
  const ratesOf = (listId: string | null | undefined): PriceListRate[] | null =>
    listId
      ? listRates
          .filter((r) => r.priceListId === listId)
          .map((r) => ({
            priceGroupId: r.priceGroupId,
            taskTypeId: r.taskTypeId,
            rate: r.rate,
            validFrom: r.validFrom,
          }))
      : null;
  const projectIds = [...new Set(rows.flatMap((r) => (r.projectId ? [r.projectId] : [])))];
  const empRates = projectIds.length
    ? await tx
        .select()
        .from(s.projectEmployeeRates)
        .where(inArray(s.projectEmployeeRates.projectId, projectIds))
    : [];

  for (const r of rows) {
    let salesRate: number | null = null;
    if (r.billable && r.projectId) {
      // D-014: the contract's hourly rate is the catch-all line of the project price list.
      const projectList = [
        ...(ratesOf(r.projectListId) ?? []),
        ...(r.contractRate !== null
          ? [{ priceGroupId: null, taskTypeId: null, rate: r.contractRate, validFrom: CATCH_ALL_FROM }]
          : []),
      ];
      salesRate = resolveRate({
        date: r.date,
        userId: r.userId,
        priceGroupId: r.priceGroupId,
        taskTypeId: r.taskTypeId,
        projectEmployeeRates: empRates.filter((e) => e.projectId === r.projectId),
        projectList: projectList.length ? projectList : null,
        customerList: ratesOf(r.customerListId),
        standardList: ratesOf(standard?.id),
        employeeDefault: r.salesRate,
      }).rate;
    }
    await tx.update(s.timeEntries).set({ salesRate, costRate: r.costRate }).where(eq(s.timeEntries.id, r.id));
  }
  return rows.length;
}
