/**
 * M3 part of the fictional seed: competencies per employee and allocations for the coming weeks, spread over each
 * employee's customer projects at roughly 55–115 % of a 37-hour week so the heatmap shows all bands.
 */
import { addDays, type LocalDate, startOfIsoWeek } from "@arc-tid/domain";
import { and, eq, isNotNull } from "drizzle-orm";
import type { Tx } from "./client.ts";
import * as s from "./schema.ts";

const COMPETENCIES: Record<string, string[]> = {
  KH: ["Ledelse", "Bygherrerådgivning"],
  AL: ["Arkitektur", "Revit", "Dispositionsforslag", "Bygherrerådgivning"],
  MB: ["Ingeniør", "VVS", "Energirenovering"],
  SK: ["Byggeledelse", "Fagtilsyn"],
  PD: ["Arkitektur", "Revit", "Projektledelse", "DGNB"],
  LV: ["Arkitektur", "Revit", "Indretning"],
  EK: ["Arkitektur", "Visualisering"],
  IS: ["Brandrådgivning", "Certificeret brandrådgiver", "Projektledelse"],
  OB: ["Ingeniør", "Konstruktion", "LCA"],
  FH: ["Byggeledelse", "Fagtilsyn"],
  NL: ["Byggeledelse", "Projektledelse", "Tagrenovering"],
};

/** Weekly load factor per person (share of 37 h), chosen to show under/ok/over in the heatmap. */
const LOAD: Record<string, number[]> = {
  AL: [0.95, 1.05, 0.9, 0.8, 0.75, 0.7, 0.6, 0.5],
  PD: [1.1, 1.15, 1.0, 0.95, 0.9, 0.8, 0.7, 0.6],
  LV: [0.85, 0.9, 0.95, 0.9, 0.8, 0.6, 0.55, 0.5],
  EK: [0.6, 0.65, 0.7, 0.7, 0.6, 0.55, 0.5, 0.5],
  IS: [0.9, 0.95, 1.05, 1.0, 0.9, 0.8, 0.7, 0.7],
  OB: [0.8, 0.85, 0.9, 0.85, 0.8, 0.7, 0.65, 0.6],
  MB: [0.7, 0.7, 0.75, 0.7, 0.65, 0.6, 0.6, 0.55],
  NL: [1.0, 1.05, 1.1, 0.95, 0.9, 0.85, 0.75, 0.7],
  SK: [0.75, 0.8, 0.8, 0.75, 0.7, 0.65, 0.6, 0.6],
  FH: [0.9, 0.9, 0.85, 0.8, 0.8, 0.7, 0.65, 0.6],
};

/** Seeds competencies and 8 weeks of allocations from the current ISO week (fictional data only). */
export async function seedPlanning(tx: Tx, tenantId: string, today: LocalDate) {
  const users = await tx.select().from(s.users);
  for (const u of users) {
    const names = COMPETENCIES[u.initials];
    if (names)
      await tx.insert(s.userCompetencies).values(names.map((name) => ({ tenantId, userId: u.id, name })));
  }
  const monday = startOfIsoWeek(today);
  for (const u of users) {
    const load = LOAD[u.initials];
    if (!load) continue;
    const memberships = await tx
      .select({ projectId: s.projectMembers.projectId })
      .from(s.projectMembers)
      .innerJoin(s.projects, eq(s.projects.id, s.projectMembers.projectId))
      .where(and(eq(s.projectMembers.userId, u.id), isNotNull(s.projects.customerId)));
    if (!memberships.length) continue;
    for (let w = 0; w < load.length; w++) {
      const total = Math.round((37 * (load[w] ?? 0)) / 0.25) * 0.25;
      const share = memberships.slice(0, 3);
      let left = total;
      for (const [i, m] of share.entries()) {
        const hours = i === share.length - 1 ? left : Math.round(total / share.length / 0.25) * 0.25;
        left -= hours;
        if (hours > 0) {
          await tx.insert(s.allocations).values({
            tenantId,
            userId: u.id,
            projectId: m.projectId,
            weekStart: addDays(monday, w * 7),
            hours,
          });
        }
      }
    }
  }
}
