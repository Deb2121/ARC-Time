/**
 * Outbox delivery (transactional outbox, docs/spec/integrations.md). Events are written in the same transaction as
 * the change (e.g. invoice booked) and delivered here, so a booking never depends on the accounting system being up.
 * Integrations are disabled by default: events for a tenant without an enabled connection are marked "skipped".
 */
import { type Db, schema, withTenant } from "@arc-tid/db";
import { type AccountingAdapter, IntegrationError, type InvoiceDoc } from "@arc-tid/integrations";
import { and, asc, eq, sql } from "drizzle-orm";

const MAX_ATTEMPTS = 5;

async function invoiceDoc(
  db: Db,
  tenantId: string,
  invoiceId: string,
): Promise<{ doc: InvoiceDoc; id: string } | null> {
  return withTenant(db, tenantId, async (tx) => {
    const [inv] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
    if (!inv?.number) return null;
    const [c] = await tx.select().from(schema.customers).where(eq(schema.customers.id, inv.customerId));
    if (!c) return null;
    const lines = await tx
      .select()
      .from(schema.invoiceLines)
      .where(
        and(
          eq(schema.invoiceLines.invoiceId, inv.id),
          sql`${schema.invoiceLines.kind} in ('time','milestone','product')`,
        ),
      )
      .orderBy(asc(schema.invoiceLines.sort));
    return {
      id: inv.id,
      doc: {
        number: inv.number,
        type: inv.type,
        invoiceDate: inv.invoiceDate,
        dueDate: inv.dueDate,
        currency: inv.currency,
        heading: inv.heading,
        customer: {
          number: c.number,
          name: c.name,
          cvr: c.cvr,
          ean: c.ean,
          address: c.address,
          postalCode: c.postalCode,
          city: c.city,
          currency: c.currency,
          paymentTermsDays: c.paymentTermsDays,
        },
        lines: lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountBp: l.discountBp,
          amount: l.amount,
        })),
        subtotal: inv.subtotal,
        vat: inv.vat,
        total: inv.total,
      },
    };
  });
}

/**
 * Claims up to 20 pending outbox events across tenants and delivers them (e.g. booked invoice → accounting system).
 * Events without an enabled integration are marked "skipped"; retryable failures go back to pending (max 5 attempts).
 */
export async function processOutbox(
  db: Db,
  accounting: AccountingAdapter | null,
  log: (msg: string) => void = () => {},
): Promise<number> {
  const claimed = await db.execute<{ id: string; tenant_id: string; kind: string }>(
    sql`select * from outbox_claim(20)`,
  );
  for (const ev of claimed) {
    let status = "done";
    let lastError: string | null = null;
    try {
      const enabled = await withTenant(db, ev.tenant_id, async (tx) => {
        const [conn] = await tx
          .select()
          .from(schema.integrationConnections)
          .where(eq(schema.integrationConnections.kind, accounting?.kind ?? "none"));
        return Boolean(conn?.enabled && accounting);
      });
      if (ev.kind === "invoice.booked" && enabled && accounting) {
        const [row] = await withTenant(db, ev.tenant_id, (tx) =>
          tx.select().from(schema.outbox).where(eq(schema.outbox.id, ev.id)),
        );
        const invoiceId = String(row?.payload.invoiceId ?? "");
        const built = await invoiceDoc(db, ev.tenant_id, invoiceId);
        if (built) {
          const res = await accounting.pushInvoice(built.doc);
          await withTenant(db, ev.tenant_id, (tx) =>
            tx
              .update(schema.invoices)
              .set({ externalId: res.externalId })
              .where(eq(schema.invoices.id, built.id)),
          );
        }
      } else {
        status = "skipped";
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      const retry = !(e instanceof IntegrationError) || e.retryable;
      const [row] = await withTenant(db, ev.tenant_id, (tx) =>
        tx
          .select({ attempts: schema.outbox.attempts })
          .from(schema.outbox)
          .where(eq(schema.outbox.id, ev.id)),
      );
      status = retry && (row?.attempts ?? 0) < MAX_ATTEMPTS ? "pending" : "failed";
      log(`outbox ${ev.kind} ${ev.id} failed: ${lastError}`);
    }
    await withTenant(db, ev.tenant_id, (tx) =>
      tx
        .update(schema.outbox)
        .set({ status, lastError, processedAt: status === "pending" ? null : new Date() })
        .where(eq(schema.outbox.id, ev.id)),
    );
  }
  return claimed.length;
}
