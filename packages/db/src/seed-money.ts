/**
 * M2 part of the fictional seed: rate groups, task types, price lists, payment plans, booked invoice history for
 * the first months after go-live, and closed accounting periods. Uses the real services (rates, invoicing,
 * periods) so seeded history follows exactly the same rules as the app.
 */
import { addDays, kr, type LocalDate, lastDayOfMonth, monthOf } from "@arc-tid/domain";
import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { Tx } from "./client.ts";
import { bookInvoice, createDraftFromSuggestion } from "./invoicing.ts";
import { closeMonth, ensurePeriods } from "./periods.ts";
import { snapshotRates } from "./rates.ts";
import * as s from "./schema.ts";

const GROUPS = [
  { name: "Partner", initials: ["KH"] },
  { name: "Seniorrådgiver", initials: ["AL", "MB", "SK"] },
  { name: "Projektleder", initials: ["PD", "IS", "NL"] },
  { name: "Rådgiver", initials: ["LV", "OB", "FH"] },
  { name: "Junior", initials: ["EK"] },
  { name: "Administration", initials: ["JF"] },
];

const STANDARD_RATES: Record<string, number> = {
  Partner: 1350,
  Seniorrådgiver: 1150,
  Projektleder: 1050,
  Rådgiver: 950,
  Junior: 825,
};

/**
 * Seeds the money part of the fictional demo company: price groups, task types, price lists, rate snapshots,
 * payment plans, booked invoice history and closed months. Runs inside the main seed transaction.
 */
export async function seedMoney(
  tx: Tx,
  tenantId: string,
  financeUserId: string,
  goLive: LocalDate,
  today: LocalDate,
) {
  // Rate groups and task types
  const groups = await tx
    .insert(s.priceGroups)
    .values(GROUPS.map((g, i) => ({ tenantId, name: g.name, sort: i })))
    .returning();
  for (const g of GROUPS) {
    const id = groups.find((x) => x.name === g.name)?.id;
    await tx.update(s.users).set({ priceGroupId: id }).where(inArray(s.users.initials, g.initials));
  }
  const [design, supervision] = await tx
    .insert(s.taskTypes)
    .values([
      { tenantId, name: "Projektering og rådgivning" },
      { tenantId, name: "Tilsyn og byggeledelse" },
    ])
    .returning();
  await tx
    .update(s.tasks)
    .set({ taskTypeId: supervision?.id })
    .where(sql`${s.tasks.name} ~* '(tilsyn|byggeledelse|byggemøder|aflevering)'`);
  await tx
    .update(s.tasks)
    .set({ taskTypeId: design?.id })
    .where(sql`${s.tasks.taskTypeId} is null and ${s.tasks.billable}`);

  // Standard price list: one line per rate group, plus a catch-all
  const [standard] = await tx
    .insert(s.priceLists)
    .values({ tenantId, name: "Standardprisliste 2026", isStandard: true })
    .returning();
  await tx.insert(s.priceListRates).values([
    ...groups
      .filter((g) => STANDARD_RATES[g.name])
      .map((g) => ({
        tenantId,
        priceListId: standard?.id ?? "",
        priceGroupId: g.id,
        taskTypeId: null,
        rate: kr(STANDARD_RATES[g.name] ?? 0),
        validFrom: "2026-01-01",
      })),
    {
      tenantId,
      priceListId: standard?.id ?? "",
      priceGroupId: null,
      taskTypeId: null,
      rate: kr(950),
      validFrom: "2026-01-01",
    },
  ]);

  // Framework agreement with the municipality: own price list, supervision cheaper than design
  const [holm] = await tx.select().from(s.customers).where(eq(s.customers.number, "1002"));
  if (holm) {
    const [fw] = await tx
      .insert(s.priceLists)
      .values({ tenantId, name: "Rammeaftale Holmstrup Kommune 2026", customerId: holm.id })
      .returning();
    const g = (n: string) => groups.find((x) => x.name === n)?.id ?? null;
    await tx.insert(s.priceListRates).values([
      {
        tenantId,
        priceListId: fw?.id ?? "",
        priceGroupId: g("Seniorrådgiver"),
        taskTypeId: null,
        rate: kr(1075),
        validFrom: "2026-01-01",
      },
      {
        tenantId,
        priceListId: fw?.id ?? "",
        priceGroupId: g("Projektleder"),
        taskTypeId: null,
        rate: kr(995),
        validFrom: "2026-01-01",
      },
      {
        tenantId,
        priceListId: fw?.id ?? "",
        priceGroupId: null,
        taskTypeId: supervision?.id ?? null,
        rate: kr(875),
        validFrom: "2026-01-01",
      },
      {
        tenantId,
        priceListId: fw?.id ?? "",
        priceGroupId: null,
        taskTypeId: null,
        rate: kr(925),
        validFrom: "2026-01-01",
      },
    ]);
    await tx.update(s.customers).set({ priceListId: fw?.id }).where(eq(s.customers.id, holm.id));
  }

  // Project-specific rate: Anne on the Nordvang interior project
  const [nordvang] = await tx.select().from(s.projects).where(eq(s.projects.number, "26004"));
  const [anne] = await tx.select().from(s.users).where(eq(s.users.initials, "AL"));
  if (nordvang && anne) {
    await tx
      .insert(s.projectEmployeeRates)
      .values({ tenantId, projectId: nordvang.id, userId: anne.id, rate: kr(1200), validFrom: "2026-08-01" });
  }

  // Rate snapshots for every approved entry, using the full resolution order
  const approved = await tx
    .select({ id: s.timeEntries.id })
    .from(s.timeEntries)
    .where(eq(s.timeEntries.status, "approved"));
  await snapshotRates(
    tx,
    approved.map((a) => a.id),
  );

  // Payment plans (fixed price) and monthly fees (retainer)
  const plans: Record<string, [string, LocalDate, number][]> = {
    "26001": [
      ["Rate 1 – dispositionsforslag (20 %)", "2026-04-30", 290_000],
      ["Rate 2 – projektforslag (30 %)", "2026-07-31", 435_000],
      ["Rate 3 – myndigheds- og udbudsprojekt (30 %)", "2026-11-30", 435_000],
      ["Rate 4 – aflevering (20 %)", "2027-06-30", 290_000],
    ],
    "26003": [
      ["Rate 1 – screening og projektering (50 %)", "2026-05-31", 120_000],
      ["Rate 2 – udbud og tilsyn (50 %)", "2026-12-31", 120_000],
    ],
    "26006": [
      ["Rate 1 – tilstandsvurdering (25 %)", "2026-05-31", 130_000],
      ["Rate 2 – udbud (25 %)", "2026-08-31", 130_000],
      ["Rate 3 – byggeledelse (25 %)", "2026-11-30", 130_000],
      ["Rate 4 – aflevering (25 %)", "2027-02-28", 130_000],
    ],
    "26008": [
      ["DGNB forhåndscertificering – rate 1 (50 %)", "2026-08-31", 90_000],
      ["DGNB forhåndscertificering – rate 2 (50 %)", "2026-12-31", 90_000],
    ],
  };
  const monthNames = [
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
  plans["26005"] = monthNames.map((m, i) => [
    `Rammeaftale ${m} 2026 (40 t)`,
    lastDayOfMonth(`2026-${String(i + 1).padStart(2, "0")}-01`),
    38_000,
  ]);

  for (const [number, items] of Object.entries(plans)) {
    const [contract] = await tx
      .select({ id: s.contracts.id })
      .from(s.contracts)
      .innerJoin(s.projects, eq(s.projects.id, s.contracts.projectId))
      .where(and(eq(s.projects.number, number), sql`${s.contracts.type} in ('fixed_price', 'retainer')`));
    if (!contract) continue;
    await tx.insert(s.paymentPlanItems).values(
      items.map(([description, dueDate, amount]) => ({
        tenantId,
        contractId: contract.id,
        description,
        dueDate,
        amount: kr(amount),
        // Invoiced in the previous system before go-live
        status: dueDate < goLive ? ("invoiced" as const) : ("planned" as const),
      })),
    );
  }

  // Accounting periods from go-live, invoice and close the first two months
  const [entity] = await tx.select().from(s.legalEntities).limit(1);
  if (!entity) return;
  await tx
    .insert(s.numberSeries)
    .values({ tenantId, legalEntityId: entity.id, kind: "invoice", nextNumber: 1001 });
  await ensurePeriods(tx, tenantId, entity.id, goLive, today);
  const customerProjects = await tx
    .select({ id: s.projects.id, customerId: s.projects.customerId })
    .from(s.projects)
    .where(isNotNull(s.projects.customerId));

  const periods = await tx
    .select()
    .from(s.accountingPeriods)
    .where(lt(s.accountingPeriods.month, monthOf(addDays(today, -35))));
  for (const p of periods.sort((a, b) => a.month.localeCompare(b.month))) {
    const end = lastDayOfMonth(p.month);
    for (const proj of customerProjects) {
      const id = await createDraftFromSuggestion(tx, {
        tenantId,
        userId: financeUserId,
        customerId: proj.customerId ?? "",
        projectIds: [proj.id],
        upTo: end,
        invoiceDate: end,
        grouping: "task",
      });
      if (id) await bookInvoice(tx, tenantId, financeUserId, id);
    }
    await closeMonth(tx, tenantId, financeUserId, p.id, true);
  }
}
