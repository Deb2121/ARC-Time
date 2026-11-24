# Sagsøkonomi, faktureringsplan og debitorliste

Module on top of cases, phases, time entries, approval and invoices (decision D-029). Requested by Finance:

> "Faktura debitorliste. Skal kunne se om der er noget der er medgået / fast honorar. I de faste honorarer laver du en
> plan for hvornår man kan fakturere. Der skal kunne ses hvor mange timer folk har brugt. I den [?] skal man kunne se
> forbrugte pengebeløb."

The unclear part of the last sentence is OQ-43.

Code: rules in `packages/domain/src/case-finance.ts`, `billing-plan.ts`, `receivables.ts` (pure, unit-tested);
data access in `apps/api/src/services/case-finance.ts`, `receivables.ts`; screens `/case-finance`,
`/case-finance/[id]`, `/debtors` and the Faktureringsplan card on the project page.

## 1. Honorarform per case

The data model already has the fee type per **contract** (a case can have several), so no new `feeType` column:

| Contract type   | Honorarform  | Fee                                |
| --------------- | ------------ | ---------------------------------- |
| `time_material` | Medgået tid  | none                               |
| `fixed_price`   | Fast honorar | `contracts.price`                  |
| `retainer`      | Fast honorar | the sum of its fee schedule (plan) |

A case is **fast honorar** if it has a fixed-price or retainer contract, otherwise **medgået tid**. The currency is
the case's currency.

**Ekstraarbejde:** a phase on a fixed-fee case can be flagged as extra work (`tasks.extra_work`). The phase (and its
sub-phases) then links to the case's time & material contract ("Ekstraarbejde efter regning", created if missing).
Its hours go to the medgået tid invoice suggestion and are not counted against the fee. This can't be changed once
hours on the phase are on an invoice.

## 2. Faktureringsplan (fixed fee)

`payment_plan_items` is extended with `sequence`, `task_id` (phase link) and `percentage_bp`. `contracts.plan_active`
tells whether the plan is saved as active.

- **Shares:** percentages of the fee or fixed amounts. With percentages only, the last instalment takes the rounding
  difference so the plan adds up to the fee to the øre.
- **Validation:** a fixed-price plan can be saved as a draft at any time, but as **active** only when the instalments
  add up to exactly 100 % of the fee (checked in øre). A retainer's plan is its fee schedule, so it has no 100 % rule.
- **Status** is computed, not stored: _afventer_ (the previous instalment is not invoiced), _planlagt_ (next in line,
  date not reached), _klar_ (next in line and the date has passed — or the linked phase is closed, or the PM marked
  it ready), _faktureret_ (the invoice holding it is booked).
- **Fakturér rate** creates an invoice draft with one milestone line and reserves the instalment. Booking the
  invoice sets it to faktureret. Deleting the draft releases it. A credit note that re-opens sources makes it klar
  again.
- The ordinary invoice suggestion (Fakturering) includes only klar instalments of active plans. Plans not activated
  yet keep the earlier rule (marked ready, or planned and due).
- **Templates:** Dispositionsforslag, Projektforslag, Myndighedsprojekt, Udbudsprojekt, Udførelsesprojekt, Tilsyn.
- **A conto** (setting `tenants.aconto_enabled`, off by default): the PM enters % complete per phase. The suggestion
  is phase budget amount × % − already invoiced a conto on the phase (drafts included). The invoice line carries
  `aconto_task_id`.

## 3. Hours and money per case

For both fee types:

- **timer**: total, per phase and per employee (all non-rejected entries).
- **forbrugt** = Σ billable hours × sales rate. The rate is the snapshot taken at approval, otherwise the current
  estimate (contract rate, then the employee's rate).
- **kostpris** = Σ hours × cost rate.
- **faktureret** = Σ booked invoice lines (time, expense, milestone, product) for the case, net excl. VAT, with
  credit notes deducted. Instalments marked invoiced without an invoice line count as invoiced before go-live.

Medgået tid only:

- **ikke faktureret** = Σ approved, not yet invoiced medgået tid hours × rate. An entry on a draft still counts; it
  drops when the invoice is booked.

Fast honorar only:

- **resthonorar** = fee − invoiced against the fee (instalments / a conto).
- **forbrugt %** = forbrugt excluding ekstraarbejde ÷ fee.
- **Fee warning** at the warning threshold (default 75 %, "76 % af honorar forbrugt") and an alert above the alert
  threshold (default 100 %). Both are set per tenant by Finance.

## 4. Sagsoversigt

Columns: case no. + name + honorarform + status · customer + project manager · timer · forbrugt · faktureret · ikke
faktureret · honorar/rest (with % or warning) · næste rate (date + amount). Every value can be sorted on. At normal
laptop width related values share a cell, each still sortable from the header.

- **Status** (most urgent first): Honorar overskredet → Overskridelsesrisiko → Rate klar → Kan faktureres → Ajour.
- **Totals row:** the sum of the rows shown (filters applied).
- **Cards:** active cases, can be invoiced now (ikke faktureret + klar instalments), instalments ready, cases at
  risk.
- **Filters:** honorarform, project manager, customer, status.
- **Excel export:** CSV for Danish Excel with the same filters and a totals row.
- **Second tab "Rater klar til fakturering":** every klar instalment across cases, with Fakturér rate.

## 5. Debitorliste

All booked invoices (not credit notes).

- **Columns:** invoice no., invoice date, customer, case, due date, amount incl. VAT, paid, outstanding, status,
  reminders.
- **Status:** Åben, Forfalden X dage, Delvist betalt (also shows the overdue days), Betalt, and Krediteret (fully
  credited, nothing paid).
- **Ageing cards:** Udestående i alt, Ikke forfaldent, 1–30, 31–60, 61–90, over 90 days.
- **Filters:** only unpaid (default), only overdue, all; customer; case; project manager. Sorting and Excel export
  as above.
- **Registrér betaling:** full or partial, with date (not in the future, not above the outstanding amount). Manual
  payments can be removed to correct mistakes.
- **Registrér rykker:** 1st, 2nd, 3rd in order, only on overdue unpaid invoices. Generating the letters is phase 2.
- **e-conomic:** payment status is read through the integration adapter (`invoiceBalance`: gross − remainder) for
  synced invoices and recorded as "economic" payments. The integration is off unless sandbox tokens are configured;
  then manual registration is the fallback.

## 6. Access (D-029)

| Who                  | Sagsoversigt / case page | Debitorliste        | Plan, ekstraarbejde, % | Payments, reminders, thresholds |
| -------------------- | ------------------------ | ------------------- | ---------------------- | ------------------------------- |
| Finance              | all cases                | all invoices        | ✓                      | ✓                               |
| Management           | all cases                | all invoices        | –                      | –                               |
| Project manager      | own cases (as PM)        | own cases' invoices | own cases              | –                               |
| Employee, Admin only | –                        | –                   | –                      | –                               |

Finance also gets two Admin rights: people import and the full audit log. GDPR and system settings stay with Admin.
