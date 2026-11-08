/**
 * Data import (decision D-024) — GRASP Pure Fabrication: turns a CSV of customers, projects or employees into a
 * plan (create / update per row, with errors), shows it as a dry run, and applies it in one transaction — all rows
 * or none. Parsing and row rules are in packages/domain/src/data-import.ts; this file resolves references
 * (customer numbers, manager e-mails, departments, norm patterns) against the database and writes.
 *
 * Matching: customers and projects by number, employees by e-mail (case-insensitive). Imported employees get no
 * password: they sign in with Microsoft (Entra). New projects get one task "Generelt" so hours can be registered.
 */
import { schema, type Tx, writeAudit } from "@arc-tid/db";
import {
  contractTypeOf,
  type ImportKind,
  kr,
  mapImport,
  parseCsv,
  parseDate,
  parseNumber,
  parseYesNo,
  projectStatusOf,
  rolesOf,
  todayCopenhagen,
  validateRow,
} from "@arc-tid/domain";
import { eq, sql } from "drizzle-orm";
import type { AuthContext } from "../auth/plugin.ts";
import { AppError } from "./errors.ts";

const MAX_ROWS = 2000;

/** One planned row: what will happen and why not, if it cannot. */
export interface PlannedRow {
  line: number;
  action: "create" | "update";
  label: string;
  errors: string[];
  values: Record<string, string>;
  /** id of the existing record for updates */
  existingId?: string;
}

/** Reads the file and plans every row against the current database (no writes). */
async function plan(tx: Tx, kind: ImportKind, csv: string) {
  const mapped = mapImport(kind, parseCsv(csv));
  if (mapped.rows.length > MAX_ROWS) throw new AppError(413, "import_too_large");
  const rows: PlannedRow[] = mapped.rows.map((r) => ({
    line: r.line,
    action: "create",
    label: r.values.name ?? r.values.fullName ?? r.values.email ?? "",
    errors: mapped.missingColumns.length ? [] : validateRow(kind, r.values),
    values: r.values,
  }));
  const dup = (key: string, norm = (s: string) => s) => {
    const seen = new Map<string, number>();
    for (const r of rows) {
      const k = norm(r.values[key] ?? "");
      if (!k) continue;
      if (seen.has(k)) r.errors.push("duplicate_in_file");
      seen.set(k, r.line);
    }
  };
  const users = await tx.select({ id: schema.users.id, email: schema.users.email }).from(schema.users);
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));

  if (kind === "customers") {
    dup("number");
    const existing = new Map((await tx.select().from(schema.customers)).map((c) => [c.number, c.id]));
    for (const r of rows) {
      const id = r.values.number ? existing.get(r.values.number) : undefined;
      if (id) Object.assign(r, { action: "update", existingId: id });
    }
  }
  if (kind === "projects") {
    dup("number");
    const existing = new Map((await tx.select().from(schema.projects)).map((p) => [p.number, p.id]));
    const customers = new Map((await tx.select().from(schema.customers)).map((c) => [c.number, c.id]));
    for (const r of rows) {
      const id = r.values.number ? existing.get(r.values.number) : undefined;
      if (id) Object.assign(r, { action: "update", existingId: id });
      if (r.values.customerNumber && !customers.has(r.values.customerNumber))
        r.errors.push("unknown_customer");
      if (r.values.managerEmail && !userByEmail.has(r.values.managerEmail.toLowerCase()))
        r.errors.push("unknown_manager");
    }
  }
  if (kind === "employees") {
    dup("email", (s) => s.toLowerCase());
    const inFile = new Set(rows.map((r) => (r.values.email ?? "").toLowerCase()));
    const patterns = await tx.select().from(schema.normPatterns);
    for (const r of rows) {
      const id = userByEmail.get((r.values.email ?? "").toLowerCase());
      if (id) Object.assign(r, { action: "update", existingId: id });
      const mgr = (r.values.managerEmail ?? "").toLowerCase();
      if (mgr && !userByEmail.has(mgr) && !inFile.has(mgr)) r.errors.push("unknown_manager");
      if (mgr && mgr === (r.values.email ?? "").toLowerCase()) r.errors.push("own_manager");
      if (
        r.values.normPattern &&
        !patterns.some((p) => p.name.toLowerCase() === r.values.normPattern?.toLowerCase())
      )
        r.errors.push("unknown_normPattern");
    }
  }
  return { missingColumns: mapped.missingColumns, unknownColumns: mapped.unknownColumns, rows };
}

/** Dry run: what the import would do, row by row, without writing anything. */
export async function previewImport(tx: Tx, kind: ImportKind, csv: string) {
  const p = await plan(tx, kind, csv);
  return {
    ...p,
    rows: p.rows.map(({ values: _v, existingId: _e, ...r }) => r),
    counts: {
      create: p.rows.filter((r) => r.action === "create").length,
      update: p.rows.filter((r) => r.action === "update").length,
      errors: p.rows.filter((r) => r.errors.length).length,
    },
  };
}

/** Number or undefined (empty cell = leave unchanged). */
const n = (v: string | undefined) => parseNumber(v) ?? undefined;
/** Drops undefined keys so updates only touch the columns that were filled in. */
const defined = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/** Applies the import (refused with 422 if any row has errors). Returns how many were created and updated. */
export async function commitImport(tx: Tx, auth: AuthContext, kind: ImportKind, csv: string) {
  const p = await plan(tx, kind, csv);
  if (p.missingColumns.length || p.rows.some((r) => r.errors.length))
    throw new AppError(422, "import_has_errors");
  if (!p.rows.length) throw new AppError(400, "import_empty");
  const audit = (entity: string, entityId: string, action: string, after: unknown) =>
    writeAudit(tx, {
      tenantId: auth.tenantId,
      entity,
      entityId,
      action,
      userId: auth.userId,
      after,
      reason: "import",
    });

  if (kind === "customers") {
    let next = Number(
      (
        await tx.execute<{ n: string }>(
          sql`select coalesce(max(number::int), 1000) as n from customers where number ~ '^[0-9]+$'`,
        )
      )[0]?.n ?? 1000,
    );
    for (const r of p.rows) {
      const v = r.values;
      const data = defined({
        name: v.name,
        cvr: v.cvr?.replace(/\s/g, "") || undefined,
        ean: v.ean?.replace(/\s/g, "") || undefined,
        address: v.address || undefined,
        postalCode: v.postalCode || undefined,
        city: v.city || undefined,
        paymentTermsDays: n(v.paymentTermsDays),
      });
      if (r.existingId) {
        await tx.update(schema.customers).set(data).where(eq(schema.customers.id, r.existingId));
        await audit("customer", r.existingId, "update", data);
      } else {
        const number = v.number || String(++next);
        const [row] = await tx
          .insert(schema.customers)
          .values({ tenantId: auth.tenantId, number, name: v.name as string, ...data })
          .returning();
        await audit("customer", row?.id ?? "", "create", row);
      }
    }
  }

  if (kind === "projects") {
    const [entity] = await tx.select().from(schema.legalEntities).limit(1);
    if (!entity) throw new AppError(400, "no_legal_entity");
    const customers = new Map((await tx.select().from(schema.customers)).map((c) => [c.number, c.id]));
    const users = new Map((await tx.select().from(schema.users)).map((u) => [u.email.toLowerCase(), u.id]));
    const yy = todayCopenhagen().slice(2, 4);
    let next = Number(
      (
        await tx.execute<{ n: string }>(
          sql`select coalesce(max(number::int), ${Number(`${yy}000`)}) as n from projects where number ~ ${`^${yy}[0-8][0-9]{2}$`}`,
        )
      )[0]?.n,
    );
    for (const r of p.rows) {
      const v = r.values;
      const managerId = users.get((v.managerEmail ?? "").toLowerCase()) as string;
      const data = defined({
        name: v.name,
        customerId: v.customerNumber ? customers.get(v.customerNumber) : undefined,
        managerId,
        status: v.status ? (projectStatusOf(v.status) ?? undefined) : undefined,
        startDate: parseDate(v.startDate) ?? undefined,
        endDate: parseDate(v.endDate) ?? undefined,
        billable: parseYesNo(v.billable) ?? undefined,
        updatedAt: new Date(),
      });
      let projectId = r.existingId;
      if (projectId) {
        await tx.update(schema.projects).set(data).where(eq(schema.projects.id, projectId));
        await audit("project", projectId, "update", data);
      } else {
        const [project] = await tx
          .insert(schema.projects)
          .values({
            tenantId: auth.tenantId,
            legalEntityId: entity.id,
            number: v.number || String(++next),
            name: v.name as string,
            status: "active",
            ...data,
            managerId,
          })
          .returning();
        if (!project) throw new AppError(500, "create_failed");
        projectId = project.id;
        const type = (v.contractType && contractTypeOf(v.contractType)) || "time_material";
        const price = n(v.price);
        const rate = n(v.hourlyRate);
        const [contract] = await tx
          .insert(schema.contracts)
          .values({
            tenantId: auth.tenantId,
            projectId,
            name: { time_material: "Regning", fixed_price: "Fastpris", retainer: "Rammeaftale" }[type],
            type,
            price: price !== undefined ? kr(price) : null,
            hourlyRate: rate !== undefined ? kr(rate) : null,
          })
          .returning();
        await tx.insert(schema.tasks).values({
          tenantId: auth.tenantId,
          projectId,
          contractId: contract?.id,
          wbs: "1",
          name: "Generelt",
          billable: project.billable,
        });
        await audit("project", projectId, "create", project);
      }
      await tx
        .insert(schema.projectMembers)
        .values({ tenantId: auth.tenantId, projectId, userId: managerId })
        .onConflictDoNothing();
    }
  }

  if (kind === "employees") {
    const departments = await tx.select().from(schema.departments);
    const patterns = await tx.select().from(schema.normPatterns);
    // Default norm: the pattern with the most hours per cycle (normally full time, 37 h).
    const fullTime = [...patterns].sort(
      (a, b) => b.days.reduce((x, y) => x + y, 0) - a.days.reduce((x, y) => x + y, 0),
    )[0];
    const [calendar] = await tx.select().from(schema.holidayCalendars).limit(1);
    const [entity] = await tx.select().from(schema.legalEntities).limit(1);
    const departmentId = async (name: string | undefined) => {
      if (!name) return undefined;
      const found = departments.find((d) => d.name.toLowerCase() === name.toLowerCase());
      if (found) return found.id;
      if (!entity) throw new AppError(400, "no_legal_entity");
      const [d] = await tx
        .insert(schema.departments)
        .values({ tenantId: auth.tenantId, legalEntityId: entity.id, name })
        .returning();
      if (d) departments.push(d);
      return d?.id;
    };
    const ids = new Map<string, string>();
    // Pass 1: create/update people (managers resolved in pass 2, so the file's order does not matter).
    for (const r of p.rows) {
      const v = r.values;
      const email = (v.email as string).trim();
      const data = defined({
        fullName: v.fullName,
        initials: v.initials?.toUpperCase(),
        departmentId: await departmentId(v.department),
        employmentStart: parseDate(v.employmentStart) ?? undefined,
        payrollNumber: v.payrollNumber || undefined,
        flexOpening: n(v.flexOpening),
        vacationOpening: n(v.vacationOpening),
        costRate: n(v.costRate) !== undefined ? kr(n(v.costRate) as number) : undefined,
        salesRate: n(v.salesRate) !== undefined ? kr(n(v.salesRate) as number) : undefined,
        updatedAt: new Date(),
      });
      let userId = r.existingId;
      if (userId) {
        await tx.update(schema.users).set(data).where(eq(schema.users.id, userId));
        await audit("employee", userId, "update", data);
      } else {
        const [u] = await tx
          .insert(schema.users)
          .values({
            tenantId: auth.tenantId,
            email,
            fullName: v.fullName as string,
            initials: (v.initials as string).toUpperCase(),
            holidayCalendarId: calendar?.id,
            ...data,
          })
          .returning();
        if (!u) throw new AppError(500, "create_failed");
        userId = u.id;
        const pattern =
          patterns.find((x) => x.name.toLowerCase() === v.normPattern?.toLowerCase()) ?? fullTime;
        if (pattern)
          await tx.insert(schema.employeeNorms).values({
            tenantId: auth.tenantId,
            userId,
            normPatternId: pattern.id,
            validFrom: u.employmentStart,
          });
        await audit("employee", userId, "create", { email, fullName: u.fullName });
      }
      if (v.roles !== undefined && (v.roles || !r.existingId)) {
        const roles = ["employee" as const, ...(rolesOf(v.roles) ?? [])];
        await tx.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
        await tx
          .insert(schema.userRoles)
          .values(roles.map((role) => ({ tenantId: auth.tenantId, userId: userId as string, role })));
      } else if (!r.existingId) {
        await tx.insert(schema.userRoles).values({ tenantId: auth.tenantId, userId, role: "employee" });
      }
      ids.set(email.toLowerCase(), userId);
    }
    // Pass 2: managers.
    const all = new Map(
      (await tx.select({ id: schema.users.id, email: schema.users.email }).from(schema.users)).map((u) => [
        u.email.toLowerCase(),
        u.id,
      ]),
    );
    for (const r of p.rows) {
      const mgr = r.values.managerEmail?.toLowerCase();
      if (!mgr) continue;
      await tx
        .update(schema.users)
        .set({ managerId: all.get(mgr) })
        .where(eq(schema.users.id, ids.get((r.values.email as string).toLowerCase()) as string));
    }
  }

  return {
    created: p.rows.filter((r) => r.action === "create").length,
    updated: p.rows.filter((r) => r.action === "update").length,
  };
}
