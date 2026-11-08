/**
 * M3 part of the fictional seed: expense types, mileage rates and a handful of expenses/mileage claims in the open
 * months (so they show up in approval and in the invoicing basis). Amounts are computed with the same domain
 * functions the app uses. Mileage rates are illustrative example values that Finance must verify (decision D-019).
 */
import { addDays, expenseCost, kr, type LocalDate, mileageAmount, monthOf, vatSplit } from "@arc-tid/domain";
import { inArray } from "drizzle-orm";
import type { Tx } from "./client.ts";
import * as s from "./schema.ts";

const TYPES = [
  { name: "Transport og taxa", vatBp: 2500, vatDeductibleBp: 10_000 },
  { name: "Tog og bus", vatBp: 0, vatDeductibleBp: 10_000 },
  { name: "Hotel og overnatning", vatBp: 2500, vatDeductibleBp: 10_000 },
  { name: "Restaurant og repræsentation", vatBp: 2500, vatDeductibleBp: 2_500 },
  { name: "Parkering", vatBp: 2500, vatDeductibleBp: 10_000 },
  { name: "Print og materialer", vatBp: 2500, vatDeductibleBp: 10_000 },
];

/** Illustrative mileage rates (øre per km) — to be verified by Finance against the official rates for each year. */
const RATES = [
  { year: 2025, highRate: 379, lowRate: 223, thresholdKm: 20_000 },
  { year: 2026, highRate: 394, lowRate: 228, thresholdKm: 20_000 },
  { year: 2027, highRate: 394, lowRate: 228, thresholdKm: 20_000 },
];

/** Seeds expense types, mileage rates and example expenses for the demo tenant (fictional data only). */
export async function seedExpenses(tx: Tx, tenantId: string, today: LocalDate) {
  const types = await tx
    .insert(s.expenseTypes)
    .values(TYPES.map((t) => ({ tenantId, ...t })))
    .returning();
  const type = (name: string) => types.find((t) => t.name.startsWith(name));
  await tx.insert(s.mileageRates).values(RATES.map((r) => ({ tenantId, ...r })));

  const people = await tx
    .select()
    .from(s.users)
    .where(inArray(s.users.initials, ["LV", "OB", "NL", "FH", "IS"]));
  const projects = await tx
    .select()
    .from(s.projects)
    .where(inArray(s.projects.number, ["26002", "26006", "26007", "26009", "26004"]));
  const proj = (n: string) => projects.find((p) => p.number === n);
  const thisMonth = monthOf(today);
  const lastMonth = monthOf(addDays(thisMonth, -1));
  const user = (i: string) => people.find((p) => p.initials === i);

  type Plan = {
    who: string;
    date: LocalDate;
    kind: "expense" | "mileage";
    desc: string;
    type?: string;
    amount?: number;
    km?: number;
    from?: string;
    to?: string;
    project?: string;
    billable?: boolean;
    markupPct?: number;
    status: "draft" | "submitted" | "approved";
  };
  const plans: Plan[] = [
    {
      who: "NL",
      date: addDays(lastMonth, 3),
      kind: "mileage",
      desc: "Byggemøde Fjordbyen",
      km: 42.5,
      from: "Glentevej, København NV",
      to: "Fjordbuen, Roskilde",
      project: "26006",
      billable: true,
      status: "approved",
    },
    {
      who: "NL",
      date: addDays(lastMonth, 17),
      kind: "mileage",
      desc: "Tilsyn tagudskiftning",
      km: 42.5,
      from: "Glentevej, København NV",
      to: "Fjordbuen, Roskilde",
      project: "26006",
      billable: true,
      status: "approved",
    },
    {
      who: "FH",
      date: addDays(lastMonth, 9),
      kind: "mileage",
      desc: "Byggeledelse etape 2",
      km: 18.2,
      from: "Glentevej, København NV",
      to: "Parkvænget, Lyngby",
      project: "26009",
      billable: true,
      status: "approved",
    },
    {
      who: "FH",
      date: addDays(lastMonth, 9),
      kind: "expense",
      desc: "Parkering ved byggeplads",
      type: "Parkering",
      amount: 85,
      project: "26009",
      billable: true,
      status: "approved",
    },
    {
      who: "IS",
      date: addDays(lastMonth, 12),
      kind: "expense",
      desc: "Print af brandplaner A1",
      type: "Print",
      amount: 1_437.5,
      project: "26007",
      billable: true,
      markupPct: 10,
      status: "approved",
    },
    {
      who: "LV",
      date: addDays(lastMonth, 21),
      kind: "expense",
      desc: "Frokost workshop med bygherre",
      type: "Restaurant",
      amount: 1_250,
      project: "26004",
      billable: false,
      status: "approved",
    },
    {
      who: "OB",
      date: addDays(thisMonth, 1),
      kind: "expense",
      desc: "Tog til Holmstrup",
      type: "Tog",
      amount: 312,
      project: "26002",
      billable: true,
      status: "submitted",
    },
    {
      who: "NL",
      date: addDays(thisMonth, 2),
      kind: "mileage",
      desc: "Afleveringsforretning",
      km: 42.5,
      from: "Glentevej, København NV",
      to: "Fjordbuen, Roskilde",
      project: "26006",
      billable: true,
      status: "submitted",
    },
    {
      who: "LV",
      date: addDays(thisMonth, 2),
      kind: "expense",
      desc: "Taxa til kundemøde",
      type: "Transport",
      amount: 268,
      project: "26004",
      billable: true,
      status: "draft",
    },
  ];

  const kmSoFar = new Map<string, number>();
  for (const p of plans.filter((x) => x.date <= today)) {
    const u = user(p.who);
    if (!u) continue;
    const t = p.type ? type(p.type) : undefined;
    let amounts: { grossAmount: number; vatAmount: number; netAmount: number; costAmount: number };
    if (p.kind === "mileage") {
      const rate = RATES.find((r) => r.year === Number(p.date.slice(0, 4))) ?? RATES[1];
      const metres = Math.round((p.km ?? 0) * 1000);
      const allowance = mileageAmount(metres, kmSoFar.get(u.id) ?? 0, rate as (typeof RATES)[number]);
      kmSoFar.set(u.id, (kmSoFar.get(u.id) ?? 0) + metres);
      amounts = { grossAmount: allowance, vatAmount: 0, netAmount: allowance, costAmount: allowance };
    } else {
      const split = vatSplit(kr(p.amount ?? 0), t?.vatBp ?? 2500, t?.vatDeductibleBp ?? 10_000);
      amounts = {
        grossAmount: split.gross,
        vatAmount: split.vat,
        netAmount: split.net,
        costAmount: expenseCost(split),
      };
    }
    const approver = u.managerId;
    await tx.insert(s.expenses).values({
      tenantId,
      userId: u.id,
      date: p.date,
      kind: p.kind,
      projectId: p.project ? (proj(p.project)?.id ?? null) : null,
      expenseTypeId: t?.id ?? null,
      description: p.desc,
      ...amounts,
      billable: Boolean(p.billable && p.project),
      markupBp: Math.round((p.markupPct ?? 0) * 100),
      km: p.km ?? null,
      fromPlace: p.from ?? null,
      toPlace: p.to ?? null,
      status: p.status,
      approvedBy: p.status === "approved" ? approver : null,
      approvedAt: p.status === "approved" ? new Date(`${addDays(p.date, 5)}T09:00:00Z`) : null,
    });
  }
  // Make sure the members referenced above are on the projects they claim expenses for.
  for (const p of plans) {
    const u = user(p.who);
    const pr = p.project ? proj(p.project) : undefined;
    if (u && pr)
      await tx
        .insert(s.projectMembers)
        .values({ tenantId, projectId: pr.id, userId: u.id })
        .onConflictDoNothing();
  }
}
