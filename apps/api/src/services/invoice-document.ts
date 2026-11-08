/**
 * Invoice document (HTML → PDF, decision D-016). Danish layout; amounts with decimal comma.
 * Template texts are our own. Bank details come from the legal entity (fictional in the seed).
 */
import { schema, type Tx } from "@arc-tid/db";
import { formatMinor, invoiceTotals } from "@arc-tid/domain";
import { asc, eq, inArray } from "drizzle-orm";

const esc = (s: string | null | undefined) =>
  (s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
const kr = (minor: number) => formatMinor(minor, "da");
const qty = (n: number) =>
  new Intl.NumberFormat("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const date = (d: string) =>
  new Intl.DateTimeFormat("da-DK", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${d}T00:00:00Z`));

/**
 * Renders the invoice/credit note as a self-contained Danish HTML document (KLADDE watermark until booked,
 * optional time-specification appendix). Input is escaped; used for preview and as the PDF source.
 */
export async function invoiceHtml(tx: Tx, invoiceId: string): Promise<string> {
  const [inv] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
  if (!inv) throw new Error("not_found");
  const [customer] = await tx.select().from(schema.customers).where(eq(schema.customers.id, inv.customerId));
  const [entity] = await tx
    .select()
    .from(schema.legalEntities)
    .where(eq(schema.legalEntities.id, inv.legalEntityId));
  const lines = await tx
    .select()
    .from(schema.invoiceLines)
    .where(eq(schema.invoiceLines.invoiceId, invoiceId))
    .orderBy(asc(schema.invoiceLines.sort));
  const totals = invoiceTotals(
    lines
      .filter((l) => ["time", "milestone", "product"].includes(l.kind))
      .map((l) => ({ amount: l.amount, vatBp: l.vatBp })),
  );

  const spec = inv.attachSpecification
    ? await tx
        .select({
          date: schema.timeEntries.date,
          initials: schema.users.initials,
          task: schema.tasks.name,
          wbs: schema.tasks.wbs,
          hours: schema.invoiceLineSources.hours,
          comment: schema.timeEntries.comment,
        })
        .from(schema.invoiceLineSources)
        .innerJoin(schema.timeEntries, eq(schema.timeEntries.id, schema.invoiceLineSources.timeEntryId))
        .innerJoin(schema.users, eq(schema.users.id, schema.timeEntries.userId))
        .innerJoin(schema.tasks, eq(schema.tasks.id, schema.timeEntries.taskId))
        .where(
          inArray(
            schema.invoiceLineSources.invoiceLineId,
            lines.length ? lines.map((l) => l.id) : ["00000000-0000-0000-0000-000000000000"],
          ),
        )
        .orderBy(asc(schema.timeEntries.date), asc(schema.users.initials))
    : [];

  const title = inv.type === "credit" ? "Kreditnota" : "Faktura";
  const number = inv.number ? String(inv.number) : "KLADDE";
  let running = 0;
  const rows = lines
    .map((l) => {
      if (l.kind === "heading") return `<tr class="heading"><td colspan="5">${esc(l.description)}</td></tr>`;
      if (l.kind === "text") return `<tr><td colspan="5" class="muted">${esc(l.description)}</td></tr>`;
      if (l.kind === "subtotal") {
        const v = running;
        running = 0;
        return `<tr class="subtotal"><td colspan="4">${esc(l.description || "Subtotal")}</td><td class="num">${kr(v)}</td></tr>`;
      }
      running += l.amount;
      const writeNote =
        l.originalAmount !== null && l.originalAmount !== l.amount
          ? `<div class="muted small">Reguleret fra ${kr(l.originalAmount)}</div>`
          : "";
      return `<tr><td>${esc(l.description)}${writeNote}</td><td class="num">${qty(l.quantity)}</td><td class="num">${kr(l.unitPrice)}</td><td class="num">${l.discountBp ? `${qty(l.discountBp / 100)} %` : ""}</td><td class="num">${kr(l.amount)}</td></tr>`;
    })
    .join("");

  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><title>${title} ${number}</title><style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: "Open Sans", Arial, sans-serif; color: #2a2a2a; font-size: 10pt; }
  .brand { font-size: 20pt; letter-spacing: -0.02em; } .brand .a { color: #CA0538; font-weight: 600; } .brand .b { color: #0b0b0c; }
  header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18mm; }
  .meta td { padding: 1px 0 1px 12px; } .meta td:first-child { color: #71717a; padding-left: 0; }
  h1 { font-weight: 400; font-size: 18pt; margin: 0 0 4mm; }
  table.lines { width: 100%; border-collapse: collapse; margin-top: 6mm; }
  table.lines th { text-align: left; font-size: 8pt; text-transform: uppercase; letter-spacing: .04em; color: #71717a; border-bottom: 1px solid #0b0b0c; padding: 4px 6px; }
  table.lines td { padding: 5px 6px; border-bottom: 1px solid #e4e4e7; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tr.heading td { font-weight: 600; padding-top: 10px; border-bottom: none; } tr.subtotal td { font-weight: 600; }
  .totals { margin-left: auto; margin-top: 6mm; width: 60%; border-collapse: collapse; }
  .totals td { padding: 3px 6px; } .totals tr.grand td { border-top: 2px solid #0b0b0c; font-weight: 700; font-size: 12pt; padding-top: 6px; }
  .muted { color: #71717a; } .small { font-size: 8pt; }
  footer { margin-top: 14mm; font-size: 8.5pt; color: #4a4a4a; border-top: 1px solid #e4e4e7; padding-top: 4mm; }
  .draft { position: fixed; top: 40%; left: 15%; font-size: 72pt; color: rgba(202,5,56,.08); transform: rotate(-20deg); }
  .spec { page-break-before: always; } .spec table { width: 100%; border-collapse: collapse; font-size: 8.5pt; } .spec td, .spec th { padding: 3px 4px; border-bottom: 1px solid #e4e4e7; text-align: left; }
  </style></head><body>
  ${inv.status !== "booked" ? '<div class="draft">KLADDE</div>' : ""}
  <header>
    <div>
      <div class="brand"><span class="a">${esc((entity?.name ?? "").slice(0, 3))}</span><span class="b">${esc((entity?.name ?? "").slice(3))}</span></div>
      <div class="muted small">CVR ${esc(entity?.cvr)}</div>
      <div style="margin-top:12mm">
        <strong>${esc(customer?.name)}</strong><br>${esc(customer?.address)}<br>${esc(customer?.postalCode)} ${esc(customer?.city)}
        ${customer?.cvr ? `<br><span class="muted small">CVR ${esc(customer.cvr)}</span>` : ""}
        ${customer?.ean ? `<br><span class="muted small">EAN ${esc(customer.ean)}</span>` : ""}
      </div>
    </div>
    <table class="meta">
      <tr><td>${title} nr.</td><td><strong>${number}</strong></td></tr>
      <tr><td>Fakturadato</td><td>${date(inv.invoiceDate)}</td></tr>
      ${inv.type === "invoice" ? `<tr><td>Forfaldsdato</td><td>${date(inv.dueDate)}</td></tr>` : ""}
      <tr><td>Kundenr.</td><td>${esc(customer?.number)}</td></tr>
      ${inv.theirReference ? `<tr><td>Jeres ref.</td><td>${esc(inv.theirReference)}</td></tr>` : ""}
      ${inv.ourReference ? `<tr><td>Vores ref.</td><td>${esc(inv.ourReference)}</td></tr>` : ""}
    </table>
  </header>
  <h1>${title}${inv.heading ? ` · ${esc(inv.heading)}` : ""}</h1>
  <table class="lines"><thead><tr><th>Beskrivelse</th><th class="num">Antal</th><th class="num">Pris</th><th class="num">Rabat</th><th class="num">Beløb</th></tr></thead><tbody>${rows}</tbody></table>
  <table class="totals">
    <tr><td>Subtotal</td><td class="num">${kr(totals.subtotal)} ${esc(inv.currency)}</td></tr>
    ${totals.vatByRate.map((v) => `<tr><td>Moms ${qty(v.vatBp / 100)} % af ${kr(v.base)}</td><td class="num">${kr(v.vat)} ${esc(inv.currency)}</td></tr>`).join("")}
    <tr class="grand"><td>I alt</td><td class="num">${kr(totals.total)} ${esc(inv.currency)}</td></tr>
  </table>
  <footer>
    ${inv.type === "invoice" ? `Betaling senest ${date(inv.dueDate)} til reg.nr. 0000 kontonr. 0001234567 (fiktiv bankkonto) med angivelse af fakturanummer ${number}.` : ""}
    <br>${esc(entity?.name)} · CVR ${esc(entity?.cvr)}
  </footer>
  ${
    spec.length
      ? `<section class="spec"><h1>Timespecifikation · ${title.toLowerCase()} ${number}</h1><table><thead><tr><th>Dato</th><th>Init.</th><th>Opgave</th><th class="num">Timer</th><th>Kommentar</th></tr></thead><tbody>${spec
          .map(
            (r) =>
              `<tr><td>${esc(r.date)}</td><td>${esc(r.initials)}</td><td>${esc(r.wbs)} ${esc(r.task)}</td><td class="num">${qty(r.hours)}</td><td>${esc(r.comment)}</td></tr>`,
          )
          .join("")}</tbody></table></section>`
      : ""
  }
  </body></html>`;
}

let browserPromise: Promise<import("playwright").Browser> | null = null;

/** Renders HTML to an A4 PDF with headless Chromium (one shared browser per process). */
export async function htmlToPdf(html: string): Promise<Buffer> {
  browserPromise ??= import("playwright").then((p) => p.chromium.launch());
  const browser = await browserPromise;
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  } finally {
    await page.close();
  }
}
