/**
 * Customers (docs/spec/crm.md, light CRM) — GRASP Information Expert for customer records: listing with project
 * counts and creating customers with the next customer number. Everyone may read; Admin, Finance and Project
 * Managers may create (checked in the route).
 */
import { schema, type Tx, writeAudit } from "@arc-tid/db";
import { asc, sql } from "drizzle-orm";
import type { AuthContext } from "../auth/plugin.ts";

/** All customers with their number of projects, sorted by name. */
export async function listCustomers(tx: Tx) {
  return tx
    .select({
      id: schema.customers.id,
      number: schema.customers.number,
      name: schema.customers.name,
      cvr: schema.customers.cvr,
      ean: schema.customers.ean,
      city: schema.customers.city,
      paymentTermsDays: schema.customers.paymentTermsDays,
      active: schema.customers.active,
      projectCount: sql<number>`(select count(*)::int from projects p where p.customer_id = ${schema.customers.id})`,
    })
    .from(schema.customers)
    .orderBy(asc(schema.customers.name));
}

/** Input for a new customer (CVR 8 digits, EAN 13 digits for public-sector e-invoicing). */
export interface NewCustomerInput {
  name: string;
  cvr?: string | undefined;
  ean?: string | undefined;
  address?: string | undefined;
  postalCode?: string | undefined;
  city?: string | undefined;
  paymentTermsDays: number;
}

/** Creates a customer with the next number in the customer series (1001, 1002 …) and audits it. */
export async function createCustomer(tx: Tx, auth: AuthContext, input: NewCustomerInput) {
  const [last] = await tx
    .select({ number: schema.customers.number })
    .from(schema.customers)
    .orderBy(sql`${schema.customers.number}::int desc`)
    .limit(1);
  const [row] = await tx
    .insert(schema.customers)
    .values({ tenantId: auth.tenantId, number: String(Number(last?.number ?? "1000") + 1), ...input })
    .returning();
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "customer",
    entityId: row?.id ?? "",
    action: "create",
    userId: auth.userId,
    after: row,
  });
  return row;
}
