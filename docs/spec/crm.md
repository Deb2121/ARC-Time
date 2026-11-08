# Customers & light CRM (Kunder og CRM)

Release: customers + contacts — **MVP**. Opportunities & pipeline — **V3** (per brief milestone M4). Customer import — **V3**.

## 1. Purpose & roles
Register who we work for and who to invoice, and (later) track sales opportunities with a weighted forecast. [Brief]

| Role | Uses this module to |
|---|---|
| Project Manager | Create/edit customers and contacts, create opportunities, move stages |
| Finance | Maintain invoicing data (CVR, EAN, payment terms, currency, price list, invoice address) |
| Management | View pipeline and forecast |
| Employee | Read customer name/number when registering time |
| Admin | Configure opportunity stages, payment terms catalogue |

## 2. Screens / views
- **S1 Customer list** — number, name, CVR, city, status (active/inactive), # active projects, open WIP (V2). Filters: status, responsible, industry. [Assumed]
- **S2 Customer card** — tabs: *Basics* (name, number, CVR, address, country, industry, responsible employee),
  *Invoicing* (invoice address, EAN, invoice email, payment terms, currency, price list, VAT treatment, invoice language),
  *Contacts*, *Projects* (list with status and budget health), *Opportunities* (V3), *Invoices* (V2, with debtor balance),
  *Change log*. [Brief + Assumed]
- **S3 Contact** — name, title, email, phone, customer, primary-contact flag, invoice-recipient flag, active. [Brief + Assumed]
- **S4 Pipeline (V3)** — opportunities grouped by stage, with expected value, probability, weighted value, expected close
  date, owner; totals per stage and a weighted forecast per month for a chosen period. Editable grid mode to change stage
  and value inline. [Observed: weighted forecast, editable grid]
- **S5 Opportunity stages (admin, V3)** — ordered list; per stage: name, description of when to use it, default
  probability %, "probability locked" flag, active flag. [Observed]

## 3. Data
```
Customer(id, tenantId, number, name, cvr?, vatNo?, address1, address2, postalCode, city, countryCode='DK',
         industry?, responsibleEmployeeId?, invoiceAddress jsonb?, ean?, invoiceEmail?, paymentTermsId,
         currency='DKK', priceListId?, vatTreatment: domestic|eu_reverse_charge|export|exempt, language: da|en,
         status: active|inactive, externalRefs jsonb  -- accounting system ids)
Contact(id, tenantId, customerId, name, title?, email?, phone?, isPrimary, isInvoiceRecipient, active)
PaymentTerms(id, tenantId, name, kind: net|current_month_plus, days)
OpportunityStage(id, tenantId, name, description, sortOrder, defaultProbability 0..100, probabilityLocked, kind: open|won|lost, active)
Opportunity(id, tenantId, customerId, contactId?, ownerEmployeeId, title, stageId, expectedValueMinor, currency,
            probability, expectedCloseDate, projectId?, lostReason?, createdAt, closedAt?)
```

## 4. User actions & state transitions
- **Customer**: `active ⇄ inactive`. Inactive customers cannot get new projects; existing projects continue. [Assumed]
- **Opportunity**: moves freely between open stages (no enforced order) [Observed: transitions not gated]; to a `won`
  stage → offers "create project" pre-filled with customer, title and expected value as budget amount; to a `lost` stage →
  lost reason required. Reopening a closed opportunity is allowed and audited. [Assumed]
- **Merge customers** (Admin, V3): moves contacts, projects, opportunities; blocked if both have booked invoices in
  different currencies. [Assumed]

## 5. Business rules & calculations
- **R1 Customer number** [Assumed]: sequential per tenant, default start 10001, editable before first project; unique.
- **R2 CVR validation** [Assumed]: Danish customers: 8 digits; modulus-11 check with weights 2,7,6,5,4,3,2,1 (weighted
  sum mod 11 = 0). Warn (not block) on failure, because some valid legacy numbers fail.
- **R3 EAN validation** [Assumed]: 13 digits, GS1 check digit; required when the customer is flagged public sector
  (used for OIOUBL in V3). *Example*: `5798000000001`… check digit computed from first 12 digits with weights 1,3 alternating.
- **R4 Payment terms → due date** [Observed: due date from invoice date + terms; Assumed kinds]:
  - net 30: invoice 15 Nov 2026 → due 15 Dec 2026.
  - current month + 30 ("løbende måned + 30"): invoice 15 Nov → end of Nov (30 Nov) + 30 days → due 30 Dec 2026.
- **R5 Defaults flow to projects** [Brief]: new projects inherit customer currency and price list; changing the customer
  later does not change existing projects. [Assumed]
- **R6 Weighted value** (V3): `weighted = expectedValue × probability / 100`.
  *Example*: renovation consultancy 500 000 kr at 40 % → **200 000 kr** weighted. Forecast for a month = Σ weighted
  of open opportunities with expected close date in that month.
- **R7 Stage probability** (V3) [Observed]: when an opportunity enters a stage, probability is set to the stage default;
  if the stage is locked, the user cannot change it; otherwise they can override.
- **R8 VAT treatment default** [Assumed]: DK address → domestic 25 %; EU country with VAT no. → reverse charge (V3);
  non-EU → export (0 %).

## 6. Edge cases
- Same CVR on two customers (e.g. municipality departments with different EAN): allowed with a warning; EAN distinguishes. [Assumed]
- Customer without CVR (private person / foreign): allowed; CVR field hidden for non-DK.
- Deleting a customer with projects or invoices: refused; only deactivate. Customers with no references can be deleted (audited).
- GDPR: contacts are personal data; erasure anonymises contact name/email/phone but keeps the row if referenced by invoices. [Brief]
- Changing currency on a customer with booked invoices: refused. [Assumed]

## 7. Acceptance criteria
- **AC1** Given a valid CVR, When saving a DK customer, Then no warning; Given an invalid checksum, Then a warning is shown but save succeeds.
- **AC2** Given payment terms "løbende måned + 30" and invoice date 15-11-2026, Then due date is 30-12-2026.
- **AC3** Given a customer with price list "Offentlig 2026", When a project is created for it, Then the project's price list defaults to it.
- **AC4** Given an inactive customer, When creating a project, Then the customer is not selectable.
- **AC5** (V3) Given an opportunity of 500 000 kr in a stage with default 40 %, Then weighted value shows 200 000 kr.
- **AC6** (V3) Given an opportunity moved to "Tabt", When saving without a reason, Then it is refused.
- **AC7** Given a customer referenced by an invoice, When delete is attempted, Then it is refused.

## 8. Open points
- Does ARCnordic want a CRM pipeline at all, or is it handled elsewhere (e.g. HubSpot)? If elsewhere, CRM could be an integration instead.
- Which payment terms are standard (net 8/14/30, løbende måned + 30)?
- Many public-sector customers (municipalities, housing associations) → OIOUBL/EAN may need to move earlier than V3.
- Should the customer number series continue from the current accounting system's numbers?
