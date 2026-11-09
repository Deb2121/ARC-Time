/**
 * Fictional seed data: "ARCnordic Demo ApS" (brief §1 and §9). Every person, customer, address, CVR number and
 * project is invented. Emails use the reserved .test domain. Dev password for every user: "demo1234".
 *
 * Contents: 3 departments + administration, 12 employees with norm time and rates, Danish holiday calendar with
 * company days, default absence codes, 6 customers, 10 projects across all contract types, ~13 weeks of time
 * entries (older weeks approved with rate snapshots, last week submitted, current week draft).
 * Deterministic: the same input gives the same data (seeded random generator).
 */
import { fileURLToPath } from "node:url";
import {
  addDays,
  DEFAULT_ABSENCE_CODES,
  danishPublicHolidays,
  defaultCompanyDays,
  FULL_TIME_37,
  kr,
  type Role,
  startOfIsoWeek,
  todayCopenhagen,
} from "@arc-tid/domain";
import { hash } from "@node-rs/argon2";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { createDb, type Tx, withTenant } from "./client.ts";
import * as s from "./schema.ts";
import { seedAccess } from "./seed-access.ts";
import { seedExpenses } from "./seed-expenses.ts";
import { seedMoney } from "./seed-money.ts";
import { seedPayroll } from "./seed-payroll.ts";
import { seedPlanning } from "./seed-planning.ts";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error("DATABASE_OWNER_URL is not set");

const DEMO_SLUG = "arcnordic-demo";
const DOMAIN = "demo.arcnordic.test";
const WEEKS_OF_HISTORY = 13;

/* ───────────── deterministic random ───────────── */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261108);
const pick = <T>(xs: readonly T[]): T => {
  const x = xs[Math.floor(rand() * xs.length)];
  if (x === undefined) throw new Error("pick from empty list");
  return x;
};

/** Fictional CVR numbers that pass the mod-11 check. */
function fakeCvr(prefix: number): string {
  const w = [2, 7, 6, 5, 4, 3, 2, 1];
  for (let p = prefix; ; p++) {
    const base = String(p).padStart(7, "0").slice(0, 7);
    for (let last = 0; last <= 9; last++) {
      const digits = `${base}${last}`.split("").map(Number);
      if (digits.reduce((acc, d, i) => acc + d * (w[i] ?? 0), 0) % 11 === 0 && digits[0] !== 0)
        return base + last;
    }
  }
}

/* ───────────── people ───────────── */
type Dept = "adm" | "ark" | "ing" | "byg";
interface Person {
  name: string;
  initials: string;
  dept: Dept;
  roles: Role[];
  manager?: string;
  sales: number; // kr/h
  cost: number; // kr/h
  start: string;
  partTime?: boolean;
  /** share of time on internal tasks */
  internalShare: number;
}

const PEOPLE: Person[] = [
  {
    name: "Karen Holm",
    initials: "KH",
    dept: "adm",
    roles: ["management", "admin", "line_manager"],
    sales: 1250,
    cost: 700,
    start: "2012-03-01",
    internalShare: 0.6,
  },
  {
    name: "Jonas Friis",
    initials: "JF",
    dept: "adm",
    roles: ["finance"],
    manager: "KH",
    sales: 0,
    cost: 480,
    start: "2018-08-01",
    internalShare: 1,
  },
  {
    name: "Anne Lund",
    initials: "AL",
    dept: "ark",
    roles: ["line_manager", "project_manager"],
    manager: "KH",
    sales: 1150,
    cost: 620,
    start: "2014-01-01",
    internalShare: 0.2,
  },
  {
    name: "Mikkel Bach",
    initials: "MB",
    dept: "ing",
    roles: ["line_manager", "project_manager"],
    manager: "KH",
    sales: 1150,
    cost: 620,
    start: "2015-05-01",
    internalShare: 0.2,
  },
  {
    name: "Sofie Kjær",
    initials: "SK",
    dept: "byg",
    roles: ["line_manager"],
    manager: "KH",
    sales: 1050,
    cost: 580,
    start: "2016-09-01",
    internalShare: 0.2,
  },
  {
    name: "Peter Dahl",
    initials: "PD",
    dept: "ark",
    roles: ["project_manager"],
    manager: "AL",
    sales: 1050,
    cost: 540,
    start: "2019-02-01",
    internalShare: 0.1,
  },
  {
    name: "Laura Vinther",
    initials: "LV",
    dept: "ark",
    roles: [],
    manager: "AL",
    sales: 925,
    cost: 450,
    start: "2021-08-01",
    internalShare: 0.1,
  },
  {
    name: "Emil Krogh",
    initials: "EK",
    dept: "ark",
    roles: [],
    manager: "AL",
    sales: 850,
    cost: 400,
    start: "2026-09-14",
    internalShare: 0.25,
  },
  {
    name: "Ida Skov",
    initials: "IS",
    dept: "ing",
    roles: ["project_manager"],
    manager: "MB",
    sales: 1050,
    cost: 540,
    start: "2017-04-01",
    internalShare: 0.1,
  },
  {
    name: "Oliver Brandt",
    initials: "OB",
    dept: "ing",
    roles: [],
    manager: "MB",
    sales: 925,
    cost: 450,
    start: "2020-01-01",
    internalShare: 0.1,
  },
  {
    name: "Freja Holst",
    initials: "FH",
    dept: "byg",
    roles: [],
    manager: "SK",
    sales: 875,
    cost: 430,
    start: "2022-03-01",
    partTime: true,
    internalShare: 0.1,
  },
  {
    name: "Noah Lind",
    initials: "NL",
    dept: "byg",
    roles: ["project_manager"],
    manager: "SK",
    sales: 1000,
    cost: 500,
    start: "2018-11-01",
    internalShare: 0.1,
  },
];

/* ───────────── customers & projects ───────────── */
const CUSTOMERS = [
  {
    key: "lyng",
    number: "1001",
    name: "Boligselskabet Lyngparken",
    city: "Lyngby",
    zip: "2800",
    address: "Parkvænget 12",
    ean: "5790000000012",
    contact: "Henrik Mose",
  },
  {
    key: "holm",
    number: "1002",
    name: "Holmstrup Kommune",
    city: "Holmstrup",
    zip: "5900",
    address: "Rådhuspladsen 1",
    ean: "5790000000029",
    contact: "Mette Ravn",
  },
  {
    key: "nord",
    number: "1003",
    name: "Nordvang Ejendomme A/S",
    city: "København Ø",
    zip: "2100",
    address: "Nordvangsvej 40",
    contact: "Lars Eg",
  },
  {
    key: "fjord",
    number: "1004",
    name: "Andelsboligforeningen Fjordbyen",
    city: "Roskilde",
    zip: "4000",
    address: "Fjordbuen 3",
    contact: "Birgit Strand",
  },
  {
    key: "kilde",
    number: "1005",
    name: "Kildegaard Logistik ApS",
    city: "Køge",
    zip: "4600",
    address: "Lagervej 7",
    contact: "Tobias Kilde",
  },
  {
    key: "soholm",
    number: "1006",
    name: "Søholm Friskole",
    city: "Hillerød",
    zip: "3400",
    address: "Skolestien 2",
    contact: "Anja Søholm",
  },
] as const;

type CKey = (typeof CUSTOMERS)[number]["key"];
interface TaskDef {
  name: string;
  hours?: number;
  rate?: number; // kr/h used to derive a budget amount
  billable?: boolean;
  children?: TaskDef[];
}
interface ProjectDef {
  number: string;
  name: string;
  customer: CKey | null;
  pm: string;
  members: string[];
  category: string;
  start: string;
  end?: string;
  contracts: {
    name: string;
    type: "time_material" | "fixed_price" | "retainer";
    price?: number;
    rate?: number;
    maxHours?: number;
    retainerHours?: number;
  }[];
  /** tasks per contract index */
  tasks: TaskDef[][];
  commentRequired?: boolean;
  billable?: boolean;
}

const ARK_PHASES = (scale: number, rate: number): TaskDef[] => [
  { name: "Dispositionsforslag", hours: 60 * scale, rate },
  { name: "Projektforslag", hours: 120 * scale, rate },
  {
    name: "Myndigheds- og udbudsprojekt",
    children: [
      { name: "Myndighedsprojekt", hours: 80 * scale, rate },
      { name: "Udbudsprojekt", hours: 140 * scale, rate },
    ],
  },
  { name: "Fagtilsyn", hours: 90 * scale, rate },
];

const PROJECTS: ProjectDef[] = [
  {
    number: "26001",
    name: "Lyngparken – facaderenovering",
    customer: "lyng",
    pm: "AL",
    members: ["AL", "PD", "LV", "EK", "OB"],
    category: "Renovering",
    start: "2026-03-01",
    end: "2027-06-30",
    contracts: [{ name: "Fastpris totalrådgivning", type: "fixed_price", price: 1_450_000, rate: 1000 }],
    tasks: [ARK_PHASES(2, 1000)],
  },
  {
    number: "26002",
    name: "Holmstrup Skole – tilbygning",
    customer: "holm",
    pm: "PD",
    members: ["PD", "LV", "EK", "IS", "OB"],
    category: "Nybyggeri",
    start: "2026-05-01",
    contracts: [{ name: "Regning efter medgået tid (rammeaftale)", type: "time_material" }],
    tasks: [ARK_PHASES(1.5, 975)],
    commentRequired: true,
  },
  {
    number: "26003",
    name: "Rådhus – energirenovering",
    customer: "holm",
    pm: "MB",
    members: ["MB", "IS", "OB"],
    category: "Energi",
    start: "2026-02-01",
    end: "2026-12-31",
    contracts: [{ name: "Fastpris ingeniørrådgivning", type: "fixed_price", price: 240_000, rate: 1050 }],
    tasks: [
      [
        { name: "Energiscreening", hours: 40, rate: 1050 },
        { name: "Projektering VVS og ventilation", hours: 110, rate: 1050 },
        { name: "Udbud og tilsyn", hours: 50, rate: 1050 },
      ],
    ],
  },
  {
    number: "26004",
    name: "Kontorhus Nordvang – indretning",
    customer: "nord",
    pm: "AL",
    members: ["AL", "LV", "PD"],
    category: "Indretning",
    start: "2026-08-01",
    contracts: [{ name: "Timeaftale", type: "time_material", rate: 1050 }],
    tasks: [
      [
        { name: "Behovsanalyse og workshops", hours: 60, rate: 1050 },
        { name: "Indretningsplan", hours: 120, rate: 1050 },
        { name: "Møbel- og materialeudbud", hours: 70, rate: 1050 },
      ],
    ],
  },
  {
    number: "26005",
    name: "Nordvang – driftsaftale 2026",
    customer: "nord",
    pm: "MB",
    members: ["MB", "OB", "NL"],
    category: "Drift",
    start: "2026-01-01",
    end: "2026-12-31",
    contracts: [
      { name: "Rammeaftale 40 t/md.", type: "retainer", price: 38_000, retainerHours: 40, rate: 950 },
    ],
    tasks: [
      [
        { name: "Vedligeholdelsesplan", hours: 200, rate: 950 },
        { name: "Ad hoc rådgivning", hours: 280, rate: 950 },
      ],
    ],
  },
  {
    number: "26006",
    name: "Fjordbyen – tagudskiftning",
    customer: "fjord",
    pm: "NL",
    members: ["NL", "FH", "SK", "IS"],
    category: "Renovering",
    start: "2026-04-01",
    end: "2027-02-28",
    contracts: [{ name: "Fastpris byggeledelse", type: "fixed_price", price: 520_000, rate: 1000 }],
    tasks: [
      [
        { name: "Tilstandsvurdering", hours: 60, rate: 1000 },
        { name: "Udbud", hours: 90, rate: 1000 },
        {
          name: "Byggeledelse",
          children: [
            { name: "Byggemøder", hours: 120, rate: 1000 },
            { name: "Tilsyn og kvalitetssikring", hours: 150, rate: 1000 },
          ],
        },
        { name: "Aflevering og 1-års eftersyn", hours: 40, rate: 1000 },
      ],
    ],
  },
  {
    number: "26007",
    name: "Lagerhal – brandteknisk rådgivning",
    customer: "kilde",
    pm: "IS",
    members: ["IS", "OB", "MB"],
    category: "Brand",
    start: "2026-07-01",
    contracts: [{ name: "Regning med loft 200 t", type: "time_material", rate: 1100, maxHours: 200 }],
    tasks: [
      [
        { name: "Brandstrategi", hours: 80, rate: 1100 },
        { name: "Certificeret brandrådgiver – kontrol", hours: 120, rate: 1100 },
      ],
    ],
  },
  {
    number: "26008",
    name: "Søholm Friskole – DGNB og ombygning",
    customer: "soholm",
    pm: "PD",
    members: ["PD", "LV", "OB", "SK"],
    category: "Bæredygtighed",
    start: "2026-06-01",
    contracts: [
      { name: "Fastpris DGNB-certificering", type: "fixed_price", price: 180_000, rate: 1000 },
      { name: "Ekstraarbejde efter regning", type: "time_material", rate: 975 },
    ],
    tasks: [
      [
        { name: "DGNB forhåndscertificering", hours: 90, rate: 1000 },
        { name: "LCA-beregning", hours: 90, rate: 1000 },
      ],
      [{ name: "Ekstraarbejde – skitser til ombygning", hours: 60, rate: 975 }],
    ],
  },
  {
    number: "26009",
    name: "Lyngparken etape 2 – byggeledelse",
    customer: "lyng",
    pm: "SK",
    members: ["SK", "FH", "NL"],
    category: "Byggeledelse",
    start: "2026-08-15",
    contracts: [{ name: "Byggeledelse efter regning", type: "time_material", rate: 950 }],
    tasks: [
      [
        { name: "Byggeledelse", hours: 300, rate: 950 },
        { name: "Fagtilsyn", hours: 150, rate: 950 },
      ],
    ],
  },
  {
    number: "26900",
    name: "Intern tid",
    customer: null,
    pm: "KH",
    members: PEOPLE.map((p) => p.initials),
    category: "Intern",
    start: "2026-01-01",
    billable: false,
    contracts: [{ name: "Intern", type: "time_material" }],
    tasks: [
      [
        { name: "Administration og ledelse", billable: false },
        { name: "Kompetenceudvikling", billable: false },
        { name: "Tilbud og salg", billable: false },
        { name: "Faglige netværk og møder", billable: false },
      ],
    ],
  },
];

/* ───────────── seed ───────────── */
const { db, close } = createDb(url, { max: 1 });

const existing = await db.select().from(s.tenants).where(eq(s.tenants.slug, DEMO_SLUG));
if (existing.length > 0) {
  // Top up modules added after this database was seeded (idempotent), then stop.
  const tenantId = existing[0]?.id as string;
  const added = await withTenant(db, tenantId, (tx) => seedPayroll(tx, tenantId));
  if (added) console.log("added payroll setup (salary codes, payroll numbers) to the existing demo tenant");
  if (await withTenant(db, tenantId, (tx) => seedAccess(tx, tenantId)))
    console.log("added extra rights (project creation for AL and PD) to the existing demo tenant");
  console.log(
    "demo tenant already seeded — run `pnpm db:reset; pnpm db:migrate; pnpm db:seed` for a clean database",
  );
  await close();
  process.exit(0);
}

const passwordHash = await hash("demo1234");
const today = todayCopenhagen();
const thisMonday = startOfIsoWeek(today);
const firstMonday = addDays(thisMonday, -7 * WEEKS_OF_HISTORY);
const lastMonday = addDays(thisMonday, -7);

async function insertOne<T>(q: Promise<T[]>): Promise<T> {
  const [row] = await q;
  if (!row) throw new Error("insert returned no row");
  return row;
}

await db.transaction(async (tx: Tx) => {
  const tenant = await insertOne(
    tx
      .insert(s.tenants)
      .values({ name: "ARCnordic Demo ApS", slug: DEMO_SLUG, goLiveDate: firstMonday })
      .returning(),
  );
  const tenantId = tenant.id;
  const entity = await insertOne(
    tx
      .insert(s.legalEntities)
      .values({ tenantId, name: "ARCnordic Demo ApS", cvr: fakeCvr(1234567) })
      .returning(),
  );

  // Departments (2 levels)
  const adm = await insertOne(
    tx
      .insert(s.departments)
      .values({ tenantId, legalEntityId: entity.id, name: "Administration", code: "ADM" })
      .returning(),
  );
  const subs = await tx
    .insert(s.departments)
    .values(
      (
        [
          ["Arkitektur", "ARK"],
          ["Ingeniør", "ING"],
          ["Byggeledelse", "BYG"],
        ] as const
      ).map(([name, code]) => ({ tenantId, legalEntityId: entity.id, parentId: adm.id, name, code })),
    )
    .returning();
  const deptId: Record<Dept, string> = {
    adm: adm.id,
    ark: subs[0]?.id ?? "",
    ing: subs[1]?.id ?? "",
    byg: subs[2]?.id ?? "",
  };

  // Holiday calendar: statutory + company days for last, this and next year
  const cal = await insertOne(
    tx.insert(s.holidayCalendars).values({ tenantId, name: "Danmark (standard)" }).returning(),
  );
  const year = Number(today.slice(0, 4));
  const holidayRows = [year - 1, year, year + 1].flatMap((y) => [
    ...danishPublicHolidays(y).map((h) => ({
      tenantId,
      calendarId: cal.id,
      date: h.date,
      name: h.nameDa,
      kind: "full" as const,
    })),
    ...defaultCompanyDays(y).map((h) => ({
      tenantId,
      calendarId: cal.id,
      date: h.date,
      name: h.nameDa,
      kind: h.kind,
    })),
  ]);
  await tx.insert(s.holidays).values(holidayRows);
  const holidayDates = new Map(holidayRows.map((h) => [h.date, h.kind]));

  // Norm patterns
  const fullTime = await insertOne(
    tx
      .insert(s.normPatterns)
      .values({ tenantId, name: "Fuld tid 37 t", cycleWeeks: 1, days: FULL_TIME_37.days })
      .returning(),
  );
  const partTime = await insertOne(
    tx
      .insert(s.normPatterns)
      .values({ tenantId, name: "Deltid 30 t (man–tor)", cycleWeeks: 1, days: [750, 750, 750, 750, 0, 0, 0] })
      .returning(),
  );

  // Absence codes
  const codes = await tx
    .insert(s.absenceCodes)
    .values(DEFAULT_ABSENCE_CODES.map((c) => ({ tenantId, ...c })))
    .returning();
  const code = (c: string) => codes.find((x) => x.code === c) ?? codes[0];

  // People
  const userId = new Map<string, string>();
  const personOf = new Map<string, Person>();
  for (const p of PEOPLE) {
    const u = await insertOne(
      tx
        .insert(s.users)
        .values({
          tenantId,
          email: `${p.initials.toLowerCase()}@${DOMAIN}`,
          fullName: p.name,
          initials: p.initials,
          departmentId: deptId[p.dept],
          managerId: p.manager ? userId.get(p.manager) : undefined,
          passwordHash,
          employmentStart: p.start,
          holidayCalendarId: cal.id,
          salesRate: kr(p.sales),
          costRate: kr(p.cost),
          flexOpening: Math.round((rand() * 10 - 3) * 4) / 4,
          vacationOpening: Math.round(rand() * 8 * 100) / 100,
        })
        .returning(),
    );
    userId.set(p.initials, u.id);
    personOf.set(u.id, p);
    await tx
      .insert(s.userRoles)
      .values(["employee" as Role, ...p.roles].map((role) => ({ tenantId, userId: u.id, role })));
    await tx.insert(s.employeeNorms).values({
      tenantId,
      userId: u.id,
      normPatternId: p.partTime ? partTime.id : fullTime.id,
      validFrom: p.start,
    });
  }
  const uid = (initials: string) => userId.get(initials) ?? "";

  // Customers + contacts
  const customerId = new Map<string, string>();
  for (const [i, c] of CUSTOMERS.entries()) {
    const row = await insertOne(
      tx
        .insert(s.customers)
        .values({
          tenantId,
          number: c.number,
          name: c.name,
          cvr: fakeCvr(3000000 + i * 104729),
          ean: "ean" in c ? c.ean : null,
          address: c.address,
          postalCode: c.zip,
          city: c.city,
        })
        .returning(),
    );
    customerId.set(c.key, row.id);
    const first = c.contact.split(" ")[0]?.toLowerCase() ?? "kontakt";
    await tx.insert(s.contacts).values({
      tenantId,
      customerId: row.id,
      name: c.contact,
      title: "Projektansvarlig",
      email: `${first}@kunde${i + 1}.test`,
    });
  }

  // Projects, contracts, tasks, members
  interface Leaf {
    taskId: string;
    projectId: string;
    billable: boolean;
    rate: number | null;
    internal: boolean;
  }
  const leavesByUser = new Map<string, Leaf[]>();
  for (const pd of PROJECTS) {
    const project = await insertOne(
      tx
        .insert(s.projects)
        .values({
          tenantId,
          number: pd.number,
          name: pd.name,
          customerId: pd.customer ? customerId.get(pd.customer) : null,
          legalEntityId: entity.id,
          managerId: uid(pd.pm),
          status: "active",
          category: pd.category,
          startDate: pd.start,
          endDate: pd.end,
          billable: pd.billable ?? true,
          commentRequired: pd.commentRequired ?? false,
        })
        .returning(),
    );
    const leaves: Leaf[] = [];
    let topIndex = 0;
    for (const [ci, cd] of pd.contracts.entries()) {
      const contract = await insertOne(
        tx
          .insert(s.contracts)
          .values({
            tenantId,
            projectId: project.id,
            name: cd.name,
            type: cd.type,
            price: cd.price ? kr(cd.price) : null,
            hourlyRate: cd.rate ? kr(cd.rate) : null,
            maxHours: cd.maxHours ?? null,
            retainerHours: cd.retainerHours ?? null,
          })
          .returning(),
      );
      const insertTasks = async (defs: TaskDef[], parentId: string | null, level: number, prefix: string) => {
        for (const [i, td] of defs.entries()) {
          const wbs = prefix ? `${prefix}.${i + 1}` : String(++topIndex);
          const billable = (pd.billable ?? true) && (td.billable ?? true);
          const isLeaf = !td.children?.length;
          const childHours = (td.children ?? []).reduce((a, c) => a + (c.hours ?? 0), 0);
          const hoursBudget = isLeaf ? (td.hours ?? 0) : childHours;
          const amount = isLeaf
            ? kr((td.hours ?? 0) * (td.rate ?? 0))
            : kr((td.children ?? []).reduce((a, c) => a + (c.hours ?? 0) * (c.rate ?? 0), 0));
          const task = await insertOne(
            tx
              .insert(s.tasks)
              .values({
                tenantId,
                projectId: project.id,
                contractId: contract.id,
                parentId,
                level,
                wbs,
                name: td.name,
                billable,
                budgetHours: hoursBudget,
                budgetAmount: amount,
                sort: i,
              })
              .returning(),
          );
          if (isLeaf) {
            leaves.push({
              taskId: task.id,
              projectId: project.id,
              billable,
              rate: contract.hourlyRate,
              internal: pd.customer === null,
            });
          } else {
            await insertTasks(td.children ?? [], task.id, level + 1, wbs);
          }
        }
      };
      await insertTasks(pd.tasks[ci] ?? [], null, 1, "");
    }
    for (const m of pd.members) {
      await tx.insert(s.projectMembers).values({ tenantId, projectId: project.id, userId: uid(m) });
      const list = leavesByUser.get(uid(m)) ?? [];
      list.push(...leaves);
      leavesByUser.set(uid(m), list);
    }
  }

  // Time entries and timesheet periods
  const normOf = (p: Person, date: string): number => {
    if (date < p.start) return 0;
    const wd = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
    const base = (p.partTime ? [750, 750, 750, 750, 0, 0, 0] : FULL_TIME_37.days)[wd] ?? 0;
    const h = holidayDates.get(date);
    return h === "full" ? 0 : h === "half" ? Math.round(base / 2) : base;
  };

  for (const [id, p] of personOf) {
    const leaves = leavesByUser.get(id) ?? [];
    const internal = leaves.filter((l) => l.internal);
    const external = leaves.filter((l) => !l.internal);
    const vacationWeek = addDays(firstMonday, 7 * (2 + Math.floor(rand() * 8)));
    const approverId = p.manager ? uid(p.manager) : uid("JF"); // D-013: no manager → another admin/finance user
    const rows: (typeof s.timeEntries.$inferInsert)[] = [];

    for (let w = 0; w <= WEEKS_OF_HISTORY; w++) {
      const monday = addDays(firstMonday, 7 * w);
      const weekStatus =
        monday < lastMonday
          ? "approved"
          : monday === lastMonday
            ? rand() < 0.75
              ? "submitted"
              : "open"
            : "open";
      const cells = new Map<string, typeof s.timeEntries.$inferInsert>();
      const add = (
        date: string,
        hoursCenti: number,
        leaf: Leaf | null,
        absence?: string,
        comment?: string,
      ) => {
        if (hoursCenti <= 0) return;
        const key = `${date}|${leaf?.taskId ?? absence}`;
        const prev = cells.get(key);
        if (prev) {
          prev.hours = Number(prev.hours) + hoursCenti / 100;
          return;
        }
        const entryStatus =
          weekStatus === "approved" ? "approved" : weekStatus === "submitted" ? "submitted" : "draft";
        cells.set(key, {
          tenantId,
          userId: id,
          date,
          projectId: leaf?.projectId ?? null,
          taskId: leaf?.taskId ?? null,
          absenceCodeId: absence ? code(absence)?.id : null,
          hours: hoursCenti / 100,
          billable: leaf?.billable ?? false,
          comment:
            comment ??
            (leaf
              ? pick([
                  "Tegningsarbejde",
                  "Møde med bygherre",
                  "Koordinering",
                  "Beregninger",
                  "Tilsyn på pladsen",
                  "Notat og referat",
                ])
              : null),
          status: entryStatus,
          salesRate: entryStatus === "approved" && leaf?.billable ? (leaf.rate ?? kr(p.sales)) : null,
          costRate: entryStatus === "approved" ? kr(p.cost) : null,
          approvedBy: entryStatus === "approved" ? approverId : null,
          approvedAt: entryStatus === "approved" ? new Date(`${addDays(monday, 8)}T09:00:00Z`) : null,
        });
      };

      for (let d = 0; d < 5; d++) {
        const date = addDays(monday, d);
        if (date > today) break;
        const norm = normOf(p, date);
        if (norm === 0) continue;
        if (monday === vacationWeek) {
          add(date, norm, null, "FERIE", undefined);
          continue;
        }
        if (rand() < 0.02) {
          add(date, norm, null, "SYG", undefined);
          continue;
        }
        // jitter: mostly exactly norm, sometimes ±0,25–1 h
        const r = rand();
        const jitter =
          r < 0.6 ? 0 : r < 0.8 ? 25 * (1 + Math.floor(rand() * 4)) : -25 * (1 + Math.floor(rand() * 2));
        let remaining = norm + jitter;
        const internalPart = Math.round((remaining * p.internalShare) / 25) * 25;
        if (internalPart > 0 && internal.length) add(date, internalPart, pick(internal));
        remaining -= internalPart;
        while (remaining > 0 && external.length) {
          const chunk = Math.min(remaining, 25 * (4 + Math.floor(rand() * 16)));
          add(date, chunk, pick(external));
          remaining -= chunk;
        }
        if (remaining > 0 && internal.length) add(date, remaining, pick(internal));
      }
      rows.push(...cells.values());

      if (weekStatus !== "open" || cells.size > 0) {
        const period = await insertOne(
          tx
            .insert(s.timesheetPeriods)
            .values({
              tenantId,
              userId: id,
              weekStart: monday,
              status: weekStatus as "open" | "submitted" | "approved",
              submittedAt: weekStatus !== "open" ? new Date(`${addDays(monday, 4)}T15:00:00Z`) : null,
              decidedBy: weekStatus === "approved" ? approverId : null,
              decidedAt: weekStatus === "approved" ? new Date(`${addDays(monday, 8)}T09:00:00Z`) : null,
            })
            .returning(),
        );
        if (weekStatus !== "open") {
          await tx.insert(s.timesheetEvents).values({
            tenantId,
            periodId: period.id,
            action: "submit",
            userId: id,
            at: period.submittedAt ?? undefined,
          });
        }
        if (weekStatus === "approved") {
          await tx.insert(s.timesheetEvents).values({
            tenantId,
            periodId: period.id,
            action: "approve",
            userId: approverId,
            at: period.decidedAt ?? undefined,
          });
        }
      }
    }
    for (let i = 0; i < rows.length; i += 500) await tx.insert(s.timeEntries).values(rows.slice(i, i + 500));
  }

  // Favourites for the demo employee Laura
  const lauraLeaves = (leavesByUser.get(uid("LV")) ?? []).slice(0, 3);
  if (lauraLeaves.length) {
    await tx
      .insert(s.favourites)
      .values(lauraLeaves.map((l) => ({ tenantId, userId: uid("LV"), taskId: l.taskId })));
  }

  await seedMoney(tx, tenantId, uid("JF"), firstMonday, today);
  await seedExpenses(tx, tenantId, today);
  await seedPlanning(tx, tenantId, today);
  await seedPayroll(tx, tenantId);
  await seedAccess(tx, tenantId);
});

const [{ count } = { count: 0 }] = await db.execute<{ count: number }>(
  // biome-ignore lint/suspicious/noExplicitAny: raw count
  "select count(*)::int as count from time_entries" as any,
);
await close();
console.log(
  `seeded ARCnordic Demo ApS: ${PEOPLE.length} people, ${CUSTOMERS.length} customers, ${PROJECTS.length} projects, ${count} time entries (password: demo1234)`,
);
