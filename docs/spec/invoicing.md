# Invoicing (Fakturering)

Release: V2 (M2) unless stated. Multi-currency, reverse charge, EAN/OIOUBL, reminders: V3. Tags: [Observed] / [Assumed] / [Brief].

## 1. Purpose & roles

Turn approved, billable work and agreed contract amounts into correct, gap-free, immutable invoices, and keep a trace from every
invoice line back to its sources (time entries, expenses, payment-plan items, retainer fees). [Brief]

| Role            | What they do                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Finance         | Builds suggestions, edits drafts, books, credits, sends, follows debtors. Only role that books. [Brief]                                           |
| Project Manager | Reviews invoiceable content on own projects, prepares drafts, marks `ready_for_booking` (if enabled). [Observed: separate ready-for-booking step] |
| Management      | Read-only: invoices, write-down analytics. [Assumed]                                                                                              |
| Employee        | Sees whether own entries are invoiced (status only, no amounts). [Assumed]                                                                        |

## 2. Screens / views

1. **Invoiceable overview ("Til fakturering")** — one row per project (groupable by customer) for a chosen period and legal entity:
   approved billable not-invoiced hours and value, billable expenses, due payment-plan items, due retainer fees, unapproved
   billable hours (warning column), last invoice date. Filters: legal entity, customer, PM, contract type, period end date,
   "only with content". Row actions: create draft, open project. Bulk action: create drafts for selected / all. [Observed: invoices are created from a debtor/invoiceable list] [Assumed: columns]
2. **Invoice suggestion dialog** — per project (or customer): period (to-date), include toggles per source type, grouping option,
   multiple projects (same customer, same currency, same legal entity), preview of resulting lines and totals. [Brief]
3. **Invoice draft editor** — header (customer, invoice address, attention/contact, our reference, customer reference/PO, EAN (V3),
   invoice date, payment terms → due date, currency (locked if project-linked), VAT setting, heading, intro text, footer text,
   internal note (not printed)); line grid (inline edit of text, quantity, unit price, discount %, VAT %, amount); per-line source
   drill-down (list of underlying entries with registered vs invoiced value); write-down/up indicator; totals (net, VAT, gross);
   actions: preview PDF, include time-specification appendix, mark ready for booking, book, delete draft. [Observed: line editing, preview with specification, internal note, currency lock] [Assumed: layout of fields]
4. **Invoice list** — all invoices and credit notes; filters: status, legal entity, customer, project, date, due/overdue; columns:
   number, type, customer, dates, net, gross, currency, status, paid amount, accounting sync status. [Assumed]
5. **Invoice detail (booked)** — read-only, PDF, sources, sync log, payments (pulled from accounting), credit notes issued, actions:
   send/resend email, create credit note, download PDF/appendix. [Assumed]
6. **Debtor list** — open booked invoices per customer with ageing buckets (not due, 1–30, 31–60, 61–90, >90 days). [Brief: debtor list] [Assumed: buckets]
7. **Write-down analytics** — per project/customer/PM/period: billable value at snapshot rate vs invoiced value, write-down kr and %. [Brief]

## 3. Data

- **Invoice**: id, tenantId, legalEntityId, type (`invoice|credit`), seriesId, number (null until booked), customerId, billing
  address snapshot, contactId, currency, fxRate (to legal-entity currency, 6 dp), invoiceDate, paymentTermsDays, dueDate,
  vatMode (`standard|reverse_charge|exempt`), ean (V3), status, readyForBookingBy/At, bookedBy/At, sentAt, paidAmount (øre),
  creditedInvoiceId (for credits), templateId, headerText, footerText, internalNote, pdfFileId, appendixFileId, totals (net, vat, gross in øre). [Brief data model + Assumed]
- **InvoiceLine**: id, invoiceId, position, kind (`time|expense|milestone|retainer|product|text|heading|subtotal`), projectId,
  taskId, employeeId (if grouped per employee), description, quantity numeric(10,2), unit (`h|stk|km|kr`), unitPrice (øre),
  discountPct, vatPct, amount (øre), registeredAmount (øre; value of sources before edits), adjustmentReason. [Assumed]
- **InvoiceLineSource**: invoiceLineId, sourceType (`time_entry|expense|mileage|payment_plan_item|retainer_period`), sourceId,
  quantity, registeredAmount, invoicedAmount (after proportional spread), writeAdjustment (= invoiced − registered). [Assumed]
- **NumberSeries**: id, legalEntityId, kind (`invoice|credit`), prefix, nextNumber, padding; one counter row per series. [Brief]
- **AccountingOutbox** (shared with integrations): eventType, payload, status, attempts. [Assumed]

## 4. User actions & state transitions

Invoice: `draft → ready_for_booking (optional) → booked → sent → partially_paid | paid`. `ready_for_booking → draft` (Finance or
creator sends back). Credit note is a separate invoice of type `credit` with the same lifecycle; booked documents are immutable. [Assumed, per overview §4]

| Action                       | Who                                       | From → To                                   | Effect                                                                                              |
| ---------------------------- | ----------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Create draft from suggestion | Finance, PM (own projects)                | — → draft                                   | Sources reserved: `reservedInvoiceLineId` set so the same source cannot be in two drafts. [Assumed] |
| Edit lines / header          | Finance, PM (own, while draft)            | draft                                       | Audit for amount changes.                                                                           |
| Mark ready for booking       | PM, Finance                               | draft → ready_for_booking                   | Only if tenant setting on. [Observed]                                                               |
| Book                         | Finance                                   | draft / ready_for_booking → booked          | Number allocated, sources → `invoiced`, PDF rendered, outbox event.                                 |
| Delete draft                 | Finance, creator                          | draft → (deleted)                           | Reservations released.                                                                              |
| Send                         | Finance                                   | booked → sent                               | Email with PDF (+appendix) to invoice contact; sending is optional (adapter may send). [Assumed]    |
| Register payment             | system (accounting sync) / Finance manual | sent/booked → partially_paid / paid         | [Brief: pull payment status]                                                                        |
| Create credit note           | Finance                                   | booked/sent/paid invoice → new credit draft | Full or partial; option "re-open sources".                                                          |

## 5. Business rules & calculations

- **R1 Invoiceable source** = item where status `approved`, billable = true, not `invoiced`, not reserved by another draft, date ≤
  suggestion to-date, belongs to the project(s) and legal entity, and item's accounting period does not matter (invoices may cover
  closed months; the invoice date must be in an open period). [Brief + Assumed]
- **R2 Line value for time** = Σ(hours × resolvedRate snapshot) of sources. Rate is the snapshot stored at approval (see `rates.md`). [Brief]
  Example: 7,5 h × 1.050,00 kr + 3,0 h × 850,00 kr = 7.875,00 + 2.550,00 = 10.425,00 kr.
- **R3 Expense value** = amount excl. VAT × (1 + markup %). Example: 400,00 kr parking + 10 % markup = 440,00 kr. Mileage lines: km × billing rate per km (project/customer price, not the tax-free reimbursement rate). [Brief + Assumed]
- **R4 Fixed-price milestones**: payment-plan items with dueDate ≤ to-date and status `due` become one line each at their amount. [Brief]
- **R5 Retainer fees**: retainer periods with a fee due in the window produce one line; overuse beyond the pool is T&M per contract setting. [Brief + Assumed]
- **R6 Grouping** (time sources): per task (one line per task, quantity = Σ hours, unit price = weighted average), per employee,
  per task + employee, or one summary line per project. Grouping never mixes different unit prices if "split by rate" is on
  (default on), so the printed unit price is exact. [Brief] [Assumed: split-by-rate]
- **R7 Write-down/up**: editing quantity, unit price, discount or amount of a source-backed line changes `amount`; difference
  vs `registeredAmount` is a write-down (negative) or write-up (positive) and requires a reason (free text + optional reason code).
  The difference is spread **proportionally to registeredAmount** across the line's sources; rounding remainder (øre) goes to the
  largest source so Σ invoicedAmount = line amount exactly. [Brief + Observed: changes spread across consolidated items] [Assumed: proportional]
  Example: line 10.425,00 kr from sources A 7.875,00 and B 2.550,00; Finance sets amount 9.000,00 (write-down 1.425,00).
  A: 7.875,00 × 9.000/10.425 = 6.798,56; B: 2.550,00 × 9.000/10.425 = 2.201,44; Σ = 9.000,00. ✓
- **R8 Free lines**: `text`, `heading`, `blank`, `subtotal` (sum of lines since previous subtotal/heading) carry no value or a
  computed one; `product` lines carry quantity × price and a project link for reporting ("miscellaneous" revenue). [Observed]
- **R9 Multiple projects per invoice**: allowed when same customer, legal entity and currency; lines grouped under a heading per project. [Observed + Brief]
- **R10 Bulk one-click**: for a legal entity + to-date, create one draft per project (or per customer if the customer's setting is
  "collective invoice") with any invoiceable content, using each project's default grouping. Runs as a background job; report lists
  created drafts and skipped projects with reasons (e.g. customer missing address, currency mismatch). [Brief + Observed OCI exists]
- **R11 Numbering**: drafts have no number. At booking, inside one DB transaction: lock the series row (`SELECT … FOR UPDATE`), take
  `nextNumber`, increment, write invoice number + status + source updates, insert outbox event, commit. If anything fails the
  transaction rolls back including the counter, so no gap and no reuse. Number unique per (legalEntityId, seriesId). Separate series for credit notes optional (default: same series). [Brief]
- **R12 Booking validations**: invoice date in an open accounting period; customer has address (and EAN if public sector, V3);
  ≥ 1 value line; total ≠ 0 (credit notes negative); every source still `approved` and reserved by this draft; currency/fx present. [Brief + Assumed]
- **R13 On booking**: sources → status `invoiced`, `invoiceLineId` set; payment-plan items → `invoiced`; retainer period fee → `invoiced`;
  PDF rendered from template (Python worker, D-002) and stored; outbox event `invoice.booked` for accounting adapter & webhooks. [Brief]
- **R14 Due date** = invoiceDate + paymentTermsDays (customer default, overridable on draft); "løbende måned + N" supported
  (end of month + N days). Example: invoice date 15-03-2027, "lb. md. + 30" → due 30-04-2027. [Observed: terms drive due date] [Assumed: lb. md.]
- **R15 VAT**: default 25 % on all lines (Danish customers); line VAT may differ (e.g. 0 % for exempt expense types). Reverse charge
  (EU B2B with valid VAT no.): VAT 0 % + mandatory text "Omvendt betalingspligt" (V3). VAT computed per line, rounded to øre, summed. [Brief]
  Example: net 9.000,00 → VAT 2.250,00 → gross 11.250,00 kr.
- **R16 Rounding**: line amount = round(quantity × unitPrice × (1 − discount), 2 dp, half away from zero). Totals are sums of rounded lines. [Assumed, overview §5]
- **R17 Multi-currency (V3)**: invoice currency = project currency; fxRate (to legal-entity currency) captured at booking from the
  tenant's rate table (manual or ECB feed); stored and never recalculated. Reports in entity currency use stored fxRate. [Brief]
- **R18 Credit notes**: full (copies all value lines negated) or partial (choose lines/quantities/amounts). Option "re-open sources"
  (only for full credit of a line): sources revert `invoiced → approved`, `invoiceLineId` cleared (history retained in
  InvoiceLineSource), so they reappear in suggestions. Without re-open, sources stay invoiced and the credit is a pure write-down. [Brief]
  Credited amount per invoice can never exceed the invoice gross minus earlier credits.
- **R19 Write-down analytics**: billable value (Σ hours × snapshot rate of invoiced sources) vs invoiced value (Σ invoicedAmount, net of
  credits). Write-down % = (billable − invoiced) ÷ billable. Example: billable 100.000 kr, invoiced 92.000 kr → 8 % write-down. [Brief]
- **R20 Locking**: a booked invoice cannot be edited or deleted; correction only by credit note. Invoices dated in a closed period cannot be booked or credited with that date. [Brief]

## 6. Edge cases

- Source edited by Finance (correction) while reserved in a draft → draft line flagged "source changed", value recomputed on open; booking blocked until Finance confirms. [Assumed]
- Entry rejected/reopened after being put in a draft: not possible — approved entries are read-only except Finance correction (above). [Brief]
- Project currency changed after drafts exist → blocked while drafts or invoiceable sources exist. [Assumed]
- Two Finance users book simultaneously in the same series → serialised by the row lock; both get consecutive numbers. [Brief]
- Booking crashes after commit but before PDF render → PDF job retried from outbox; invoice is booked without PDF until done; "send" disabled until PDF exists. [Assumed]
- Accounting push fails → invoice stays booked; sync status `failed` with retry; never re-numbered. [Assumed]
- Customer merged/renamed after booking → invoice keeps address snapshot. [Assumed]
- Zero-hour or zero-rate entries: included as lines with 0 value only if "show non-valued hours" is set on the draft. [Assumed]
- Credit note of an invoice whose sources were later re-invoiced → re-open option disabled for those lines. [Assumed]
- Draft containing items from several months: allowed; WIP drops at booking date. [Assumed]

## 7. Acceptance criteria

- **AC1** Given entry E (approved, billable) was invoiced on invoice 1001, When a new suggestion is built for the same project and any period, Then E is not included. [Brief §9]
- **AC2** Given E is reserved in an unbooked draft D1, When another user builds a suggestion, Then E is not included and the overview shows it as "in draft". [Assumed]
- **AC3** Given series next number 1042, When two invoices are booked concurrently, Then they receive 1042 and 1043 and the next is 1044. [Brief §9]
- **AC4** Given series next number 1042, When booking fails after the number was taken (e.g. validation error raised inside the transaction or DB error), Then the transaction rolls back, the next successful booking gets 1042, and no invoice ever has 1042 twice. [Brief §9]
- **AC5** Given a draft, Then it has no invoice number, and deleting it does not affect the series. [Brief]
- **AC6** Given a line of 10.425,00 kr from sources 7.875,00 and 2.550,00, When Finance changes the amount to 9.000,00 with reason "Aftalt rabat", Then sources get 6.798,56 and 2.201,44, the write-down 1.425,00 is reported, and the audit log records old → new and the reason. [Brief]
- **AC7** Given a write-down without reason, When saving, Then it is refused with "Angiv årsag til nedskrivning". [Brief]
- **AC8** Given a booked invoice, When anyone tries to change a line, Then the API returns 409 and nothing changes. [Brief]
- **AC9** Given a full credit note with "re-open sources", When booked, Then the sources return to `approved` without invoiceLineId and appear in the next suggestion. [Brief]
- **AC10** Given invoice date in a closed accounting period, When booking, Then booking is refused. [Brief]
- **AC11** Given fixed-price payment item 60.000 kr due 31-03-2027, When a suggestion to 31-03-2027 is built, Then one line of 60.000 kr appears; after booking the item is `invoiced` and never suggested again. [Brief]
- **AC12** Given bulk invoicing for March for entity A, When it runs, Then one draft per project with content is created, projects without content are skipped, and a summary lists both. [Brief]
- **AC13** Given an employee user, When calling GET /invoices, Then 403. Given a PM, Then only drafts/invoices of own projects, without booking rights. [Brief]
- **AC14** Net 9.000,00 kr at 25 % VAT → VAT 2.250,00, gross 11.250,00. [Brief]
- **AC15** E2E: register → submit → approve → suggestion → book → number assigned, PDF available, sources invoiced. [Brief §9]

## 8. Open points

- Does ARCnordic want PM "ready for booking" step on by default?
- Continue an existing invoice number series (starting number) from today's system? Separate series for credit notes?
- Payment terms default (e.g. netto 30 / lb. md. + 30)?
- Should invoices be emailed from ARCnordic Tid, or only sent via the accounting system?
- Customer-level "collective invoice" (one invoice across projects) needed?
- Write-down reason codes: fixed list wanted (e.g. goodwill, estimate exceeded, internal error)?
- Reminders (rykker) and fees: handle in ARCnordic Tid or leave to accounting system? (proposal: accounting system)
