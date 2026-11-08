# Expenses, mileage & allowances (Udlæg, kørsel og godtgørelser)

Release: expenses with receipts, mileage with yearly rate table, approval steps, invoicing and payroll hand-off = **V2 (M3)**.
Per diem / travel allowances (diæter, rejsegodtgørelse) = **V3**. Receipt OCR = **V3** (optional). Company-card import = **V3**.

## 1. Purpose & roles
Capture out-of-pocket and project costs correctly so that employees get reimbursed, billable costs reach the invoice, and
VAT and tax-free allowances are handled within Danish rules. [Brief]

| Role | Use |
|---|---|
| Employee | Register expense/mileage, upload receipt, submit. [Brief] |
| Project Manager | Approve expenses on own projects (step 1 when enabled). [Brief + Observed: configurable steps] |
| Line Manager | Approve own reports' expenses (step when enabled). [Assumed] |
| Finance | Final approval, set billable/non-billable, VAT corrections, reimbursement export, payroll transfer. [Brief + Observed] |
| Admin | Expense types, VAT rules, mileage rate tables, vehicles, approval steps. [Brief + Observed] |

## 2. Screens / views
- **My expenses** list: date, type, project, amount, currency, DKK amount, billable, status, receipt icon; filters by status/period. [Assumed]
- **New expense** form: date, expense type, project/task (optional for internal costs), description, amount incl. VAT,
  currency, VAT amount (pre-filled from type, editable), payment method (own money / company card), billable (default from
  type + project), receipt upload (drag/drop, camera on mobile). [Brief + Observed payment method]
- **New mileage** form: date, from, to, via (free text), purpose, km (manual; route lookup V3), round trip toggle, vehicle
  (own car / company car — company car not reimbursable), project/task, billable. Shows rate applied and amount. [Brief + Observed vehicles]
- **Expense approval** list (approver / Finance): filters employee, type, payment method, status, period; per row approve,
  reject (comment), toggle billable; receipt preview side-by-side; bulk approve. [Observed]
- **Admin**: expense types, VAT codes, mileage rate table per year, vehicles, approval step configuration. [Observed]

## 3. Data
**ExpenseType** [Brief + Observed]: `code, name, defaultVatRate (e.g. 25 %, 0 %), vatDeductiblePct (100 | 75 | 25 | 0),
defaultBillable, defaultMarkupPct, glAccount, salaryCode (for reimbursement), requiresReceipt bool, active`.
**Expense** [Brief]: `id, tenantId, employeeId, date, typeId, projectId?, taskId?, description, amountInclVat (minor units),
currency, fxRate (to tenant/legal-entity currency, numeric(12,6)), fxDate, amountDkk, vatAmount, vatDeductible, netAmount,
paymentMethod (own|company_card), billable, markupPct, invoiceAmount (derived, see R4), receiptFileIds[], status, approvalSteps[],
invoiceLineId, payrollExportId, createdAt/By`.
**Mileage** [Brief]: `id, employeeId, date, from, to, via, purpose, km numeric(7,1), roundTrip, vehicleId, rateTableYear,
rateBand (high|low), ratePerKm (snapshot), amount, projectId?, taskId?, billable, invoiceRatePerKm?, status, approvalSteps[], invoiceLineId, payrollExportId`.
**MileageRateTable** [Brief + Observed]: `year, highRatePerKm, lowRatePerKm, thresholdKmPerYear (20 000), validFrom`.
**Receipt file**: object storage (EU), `sha256, mime, size, scannedAt, scanResult`. [Assumed]
**Approval step config** [Observed]: ordered list of step types (project_manager, line_manager, finance); Finance always last. [Brief]

## 4. User actions & state transitions
Same lifecycle as time (overview §4): `draft → submitted → approved → invoiced`; `submitted → rejected → draft`. [Brief]
- Expenses are submitted individually or as a batch ("expense report"), independent of the timesheet period. [Assumed]
- Each configured step must approve; any step can reject with comment → `rejected`. [Observed + Brief]
- After final (Finance) approval: billable items appear in invoice suggestions; reimbursable items (paymentMethod = own)
  are queued for the next payroll export (or reimbursement file). [Brief]
- Company-card items are never reimbursed; they are for project cost and billing only. [Assumed]
- Invoiced → re-opened to approved only via credit note "reopen entries". [Brief]

## 5. Business rules & calculations
All money in øre; all calculations in `packages/domain`. [Brief] Values below are examples; tax/VAT figures marked
"illustrative" must be verified against current SKAT rules before go-live.

**R1 VAT split** [Brief] — vatAmount defaults to amountInclVat × rate/(1+rate); vatDeductible = vatAmount × vatDeductiblePct;
cost to project = amountInclVat − vatDeductible.
- Example A (taxi, 25 %, fully deductible): 250,00 kr incl. → VAT 50,00, net 200,00, project cost **200,00**.
- Example B (hotel, 25 %, illustrative 75 % deductible): 1 250,00 kr → VAT 250,00, deductible 187,50, project cost **1 062,50**.
- Example C (business meal, illustrative 25 % of VAT deductible): 1 000,00 → VAT 200,00, deductible 50,00, cost **950,00**.
- Foreign VAT (e.g. German hotel) is not deductible in the Danish VAT return: vatDeductible = 0 by default. [Assumed]

**R2 Currency** [Brief] — Foreign-currency expenses store the original amount, currency and fxRate/fxDate (default: the
legal entity's daily rate source on the expense date, e.g. Danmarks Nationalbank; Finance may override with the card-statement
amount). Example: 100,00 EUR × 7,4600 = **746,00 kr**. [Assumed rate source]

**R3 Reimbursement** [Brief] — Own-money expenses reimburse amountDkk incl. VAT (the employee paid the gross). Mileage
reimburses `amount` tax-free within the statutory rate. [Assumed per Danish practice]

**R4 Billable amount & markup** [Brief] — Invoice base = netAmount (excl. VAT) unless the type is set to "bill non-deductible
VAT as cost"; invoiceAmount = base × (1 + markupPct). VAT on the invoice is applied by invoicing rules, not copied.
- Example D: taxi net 200,00, markup 10 % → invoice line **220,00** excl. VAT.

**R5 Mileage** [Brief] — amount = km × rate for the band. Band = high until the employee's cumulative reimbursed km in the
calendar year reaches the threshold (20 000 km), then low; a trip crossing the threshold is split. Rates are a yearly table
maintained by Admin.
- Illustrative table (to verify): 2026 high **3,81 kr/km**, low **2,23 kr/km**.
- Example E: 120 km round trip at high rate → 120 × 3,81 = **457,20 kr**.
- Example F: employee at 19 950 km makes a 100 km trip → 50 × 3,81 + 50 × 2,23 = 190,50 + 111,50 = **302,00 kr**.
- Billable mileage may use a separate customer rate per km (price list), default = reimbursement rate. [Assumed]

**R6 Receipts** [Brief] — Allowed types: JPEG, PNG, HEIC (converted to JPEG), PDF; max 10 MB per file, max 5 files per
expense; malware scan before the file is available (quarantined until clean); stored in EU object storage, served via
short-lived signed URLs; original kept unaltered with SHA-256 for bookkeeping evidence; retention 5 years after end of the
financial year (Danish bookkeeping act) even if the person's data is erased. [Brief + Assumed limits]
- Receipt required if the type says so, or amount > tenant threshold (default: always). [Assumed]

**R7 Validation** [Brief] — Same period-lock and project/task rules as time (time-tracking R4, R7); date not in the future;
amount > 0 (negative only via Finance correction); currency ISO 4217; km > 0 and ≤ 2 000 per trip (warning above 500). [Assumed limits]

**R8 Allowances (V3)** [Brief] — Per diem by travel days/hours with breakfast/lunch/dinner reductions, rates per year
(Danish standard rates), domestic/foreign; generated as allowance lines from a travel record. Spec detailed in V3.

**R9 Payroll hand-off** [Brief] — Approved own-money expenses and mileage are exported with salary codes from the type
(reimbursement) and mileage (tax-free allowance) in the next pay period (see payroll.md). Exported items get payrollExportId
and are not exported again. [Brief + Observed: export once]

## 6. Edge cases
- Expense on a fixed-price project: billable only if the contract treats expenses as separately billable; otherwise cost only. [Observed: fixed price may include or exclude expenses]
- Duplicate receipt (same SHA-256 already used): warning on upload, Finance sees a duplicate flag. [Assumed]
- Mileage table missing for the year: submit blocked with message to Admin. [Assumed]
- Changing a mileage table after approval does not alter approved amounts (rate snapshot). [Assumed]
- Partial credit-card refund: entered as a negative expense by Finance, linked to the original. [Assumed]
- Employee leaves with unreimbursed approved expenses: included in final payroll export. [Assumed]

## 7. Acceptance criteria
- **AC1** Given a taxi type 25 % fully deductible, When an expense of 250,00 kr is saved, Then VAT = 50,00, net = 200,00. [Brief]
- **AC2** Given an approved billable taxi expense net 200,00 with markup 10 %, When an invoice suggestion is built, Then it contains a line of 220,00 excl. VAT. [Brief]
- **AC3** Given an expense of 100,00 EUR with fxRate 7,46, Then amountDkk = 746,00 and fxRate and date are stored on the expense. [Brief]
- **AC4** Given mileage high rate 3,81 and an employee at 19 950 km this year, When 100 km is submitted, Then the amount = 302,00 kr split over both bands. [Brief + illustrative]
- **AC5** Given a 12 MB PDF or an .exe file, When uploaded, Then it is refused with a clear message. [Assumed]
- **AC6** Given a file that fails the malware scan, Then it is quarantined and not downloadable. [Assumed]
- **AC7** Given approval steps PM → Finance, When the PM approves, Then the item is still submitted; When Finance approves, Then it is approved and appears in invoicing (if billable) and payroll queue (if own money). [Brief + Observed]
- **AC8** Given an invoiced expense, When it is included in a new invoice suggestion, Then it never appears. [Brief §9]
- **AC9** Given an expense dated in a closed accounting period, When anyone edits it, Then it is refused. [Brief §9]
- **AC10** Given an approved own-money expense exported to payroll in November, Then the December export does not contain it. [Brief]
- **AC11** Given a company-card expense, Then it is never included in reimbursement/payroll exports. [Assumed]

## 8. Open points
1. Approval steps for ARCnordic expenses: PM → Finance, line manager → Finance, or Finance only?
2. Default markup on billable expenses (0 %? 10 %?) and on mileage (customer km rate)?
3. Is a receipt required for every expense, or only above an amount?
4. Do employees use company cards, and should card transactions be imported (V3)?
5. Should reimbursement go via payroll (proposed) or a separate bank payment file?
6. Exact VAT deductibility rules per expense type and current mileage rates to be confirmed by Finance/accountant.
7. Are per diems (diæter) used at ARCnordic at all (affects whether V3 allowances are needed)?
