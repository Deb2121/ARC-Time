/**
 * Fictional seed data: "ARCnordic Demo ApS". All people, emails and companies are invented (brief §1, §9).
 * Emails use the reserved .test domain. Dev password for every user: "demo1234" (dev login only).
 * M0 seeds organisation and people; later milestones extend this script (customers, projects, entries).
 */
import { fileURLToPath } from "node:url";
import type { Role } from "@arc-tid/domain";
import { hash } from "@node-rs/argon2";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { createDb } from "./client.ts";
import { departments, legalEntities, tenants, userRoles, users } from "./schema.ts";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error("DATABASE_OWNER_URL is not set");

const DEMO_SLUG = "arcnordic-demo";
const DOMAIN = "demo.arcnordic.test";

interface Person {
  name: string;
  initials: string;
  dept: "ark" | "ing" | "byg" | "adm";
  roles: Role[];
  manager?: string; // initials
}

const PEOPLE: Person[] = [
  { name: "Karen Holm", initials: "KH", dept: "adm", roles: ["management", "admin", "line_manager"] },
  { name: "Jonas Friis", initials: "JF", dept: "adm", roles: ["finance"], manager: "KH" },
  {
    name: "Anne Lund",
    initials: "AL",
    dept: "ark",
    roles: ["line_manager", "project_manager"],
    manager: "KH",
  },
  {
    name: "Mikkel Bach",
    initials: "MB",
    dept: "ing",
    roles: ["line_manager", "project_manager"],
    manager: "KH",
  },
  { name: "Sofie Kjær", initials: "SK", dept: "byg", roles: ["line_manager"], manager: "KH" },
  { name: "Peter Dahl", initials: "PD", dept: "ark", roles: ["project_manager"], manager: "AL" },
  { name: "Laura Vinther", initials: "LV", dept: "ark", roles: [], manager: "AL" },
  { name: "Emil Krogh", initials: "EK", dept: "ark", roles: [], manager: "AL" },
  { name: "Ida Skov", initials: "IS", dept: "ing", roles: ["project_manager"], manager: "MB" },
  { name: "Oliver Brandt", initials: "OB", dept: "ing", roles: [], manager: "MB" },
  { name: "Freja Holst", initials: "FH", dept: "byg", roles: [], manager: "SK" },
  { name: "Noah Lind", initials: "NL", dept: "byg", roles: ["project_manager"], manager: "SK" },
];

const { db, close } = createDb(url, { max: 1 });

const existing = await db.select().from(tenants).where(eq(tenants.slug, DEMO_SLUG));
if (existing.length > 0) {
  console.log("demo tenant already seeded — run `pnpm db:reset` for a clean database");
  await close();
  process.exit(0);
}

const passwordHash = await hash("demo1234");

await db.transaction(async (tx) => {
  const [tenant] = await tx
    .insert(tenants)
    .values({ name: "ARCnordic Demo ApS", slug: DEMO_SLUG })
    .returning();
  if (!tenant) throw new Error("tenant insert failed");
  const tenantId = tenant.id;

  const [entity] = await tx
    .insert(legalEntities)
    .values({ tenantId, name: "ARCnordic Demo ApS", cvr: "12345674" })
    .returning();
  if (!entity) throw new Error("legal entity insert failed");

  const [root] = await tx
    .insert(departments)
    .values({ tenantId, legalEntityId: entity.id, name: "Administration", code: "ADM" })
    .returning();
  if (!root) throw new Error("department insert failed");
  const sub = await tx
    .insert(departments)
    .values([
      { tenantId, legalEntityId: entity.id, parentId: root.id, name: "Arkitektur", code: "ARK" },
      { tenantId, legalEntityId: entity.id, parentId: root.id, name: "Ingeniør", code: "ING" },
      { tenantId, legalEntityId: entity.id, parentId: root.id, name: "Byggeledelse", code: "BYG" },
    ])
    .returning();
  const deptId = { adm: root.id, ark: sub[0]?.id, ing: sub[1]?.id, byg: sub[2]?.id };

  const idByInitials = new Map<string, string>();
  for (const p of PEOPLE) {
    const [u] = await tx
      .insert(users)
      .values({
        tenantId,
        email: `${p.initials.toLowerCase()}@${DOMAIN}`,
        fullName: p.name,
        initials: p.initials,
        departmentId: deptId[p.dept],
        managerId: p.manager ? idByInitials.get(p.manager) : undefined,
        passwordHash,
      })
      .returning();
    if (!u) throw new Error("user insert failed");
    idByInitials.set(p.initials, u.id);
    const roles: Role[] = ["employee", ...p.roles];
    await tx.insert(userRoles).values(roles.map((role) => ({ tenantId, userId: u.id, role })));
  }
});

await close();
console.log(`seeded ${PEOPLE.length} users in tenant ${DEMO_SLUG} (password: demo1234)`);
