# Accounting periods & revenue recognition (Regnskabsperioder og indtægtsførsel)

Release: V2 (M2) for periods, locking, WIP report and fixed-price recognition; journal export to accounting V2 (M3); per-employee reopen V2;
value-based completion and correction strategies V3. Tags: [Observed] / [Assumed] / [Brief].

## 1. Purpose & roles
Keep reported numbers stable once a month is done: lock registrations and invoices in closed months, and produce the month-end
figures (WIP, recognised revenue on fixed price, deferred revenue on retainers). [Brief] [Observed: periods exist to keep figures stable when booking back in time]

| Role | What they do |
|---|---|
| Finance | Creates/closes/reopens periods, runs pre-close checklist and month-end report, exports journal. [Brief] |
| Management | Reads month-end report. [Assumed] |
| Everyone else | Blocked from changes dated in closed periods; sees a lock icon. [Brief] |

## 2. Screens / views
1. **Period list** per legal entity: month, status, closed by/at, reopen history; next 24 months visible. [Observed: next two years shown]
2. **Pre-close checklist** for a selected period: counts + drill-down of (a) timesheets not submitted, (b) submitted not approved,
   (c) expenses not approved, (d) invoice drafts dated in period, (e) payment-plan items due but not invoiced, (f) fixed-price
   projects with completion override older than 60 days, (g) failed accounting syncs. Items are warnings, not blockers, except (d)
   drafts dated inside the period (must be booked, re-dated or deleted). [Assumed]
3. **Close dialog**: summary, checkbox "I understand registrations dated in this period will be locked", comment. [Assumed]
4. **Month-end report**: per project and totalled per customer/department/legal entity: WIP opening, movement, closing; recognised
   revenue (fixed price) this period and to date; deferred revenue (retainers); invoiced this period; cost; contribution margin.
   Export CSV/Excel. [Brief + Observed: WIP report shows registered vs invoiced and margin]
5. **Revenue recognition detail** (fixed price): per contract: price, budget hours, used hours, completion %, override, recognised to
   date, recognised this period. [Brief]

## 3. Data
- **AccountingPeriod**: id, tenantId, legalEntityId, startDate, endDate (calendar month), status (`open|closed`), closedBy/At, comment. [Brief]
- **PeriodReopen**: periodId, scope (`all|employee`), employeeId (nullable), reopenedBy/At, reason, reclosedAt. [Observed: reopen for one employee] [Assumed: structure]
- **RevenueRecognition**: contractId, periodId, completionPct, overridePct, overrideReason, recognisedToDate (øre), recognisedThisPeriod (øre), computedAt, frozen (bool at close). [Assumed]
- **MonthEndSnapshot**: periodId, projectId, wipClosing, deferredClosing, recognisedThisPeriod, invoicedThisPeriod, costThisPeriod (all øre), createdAt. Frozen at close so reports for closed months never change. [Assumed]
- Tenant setting: period creation `automatic monthly` (default) or `manual`. [Observed]

## 4. User actions & state transitions
`open → closed` (Finance). `closed → open` (Finance, mandatory reason, audited). Partial reopen: `closed` + active PeriodReopen(scope=employee) lets one employee register/edit in that month until re-closed. [Brief + Observed]

| Action | Effect |
|---|---|
| Close | Locks: time entries, absences, expenses, mileage dated in the period; invoices/credits with invoice date in the period. Freezes RevenueRecognition and MonthEndSnapshot. Auto-creates the next period if automatic mode and it doesn't exist. Emits `period.closed` (webhook, journal export). |
| Reopen (all) | Unlocks; snapshot marked `superseded`; on re-close a new snapshot is taken and the delta is shown. |
| Reopen (one employee) | Only that employee's own registrations unlock; approvals still apply. |

Periods must be closed in order: a period can be closed only if all earlier periods of that legal entity are closed; reopening an
earlier period does not reopen later ones (but re-close shows impact on later snapshots). [Assumed]

## 5. Business rules & calculations
- **R1 Lock rule**: any create/update/delete of a time entry, absence, expense or mileage with `date` in a closed period is refused
  for every role, including Finance and Admin; the only way is to reopen. Same for booking/crediting an invoice whose invoice date is in a closed period. [Brief]
- **R2 Status changes in closed periods**: approval of a submitted entry dated in a closed period is allowed (status change only, no value
  change) — configurable; default **allowed** so late approvals don't force reopen. Invoicing entries from closed months is allowed (invoice date is what matters). [Assumed]
- **R3 WIP (T&M)** at period end = Σ(hours × snapshot rate) of entries approved, billable, not invoiced (or invoiced on an invoice dated
  after period end), with date ≤ period end; plus billable expenses with markup on the same terms. [Brief]
  Example: on 31-03-2027 project P has 40 h approved not invoiced at 950 kr → WIP 38.000,00 kr. Invoice booked 05-04-2027 → March WIP still 38.000,00, April movement −38.000,00.
- **R4 Fixed-price completion** = min(usedHours ÷ budgetHours, 100 %) unless PM override (0–100 %, reason required). Used hours = approved hours on the contract's tasks with date ≤ period end (submitted optional setting). [Brief]
- **R5 Recognised to date** = contractPrice × completion. **Recognised this period** = recognised to date − recognised to date at previous period close. [Brief]
  Example (brief §9): price 240.000 kr, 98 of 200 h → 49 % → 117.600,00 kr recognised to date. If February closed at 30 % (72.000,00 kr), March recognises 45.600,00 kr.
- **R6 Fixed-price WIP/deferral** = recognised to date − invoiced to date: positive → WIP (contract asset); negative → deferred revenue (prepayment). Example: recognised 117.600, invoiced (payment plan) 120.000 → deferred 2.400,00 kr. [Assumed]
- **R7 Budget/price change**: recognition recomputes from the new completion on the next close; a decrease in recognised-to-date produces a negative period recognition (default) — the reference's alternative correction strategies are V3 options. [Observed: three correction strategies] [Assumed: default here per D-004]
- **R8 Retainers**: earned = min(used value, period pool) for consumption-based retainers; for flat-fee retainers earned = period fee pro rata over the period. Deferred revenue = invoiced − earned (≥ 0). Example: retainer 50.000 kr/quarter invoiced 1 Jan; by 31 Jan 18.000 kr used → deferred 32.000,00 kr. [Brief]
- **R9 T&M revenue** recognised at invoicing (invoice date). [Brief]
- **R10 Contract completion**: when a fixed-price contract is set completed, completion forces 100 % at the next close (remaining revenue recognised). [Observed: completion triggers booking]
- **R11 Journal export (V2)**: at close, one journal per legal entity: Dr WIP / Cr revenue adjustment for movements, Dr revenue / Cr deferred for deferrals; accounts mapped in settings; sent through accounting adapter or CSV. [Assumed]
- **R12 Time zone**: period boundaries are local dates Europe/Copenhagen; entries are date-only, so no time-of-day ambiguity. [Brief]

## 6. Edge cases
- Employee leaves; their unsubmitted March hours block nothing but appear in checklist. [Assumed]
- Reopening February after March is closed: allowed; March snapshot is shown with "affected by reopen" badge until re-close of Feb; March stays closed. [Assumed]
- Fixed-price with 0 budget hours → completion only by override; checklist flags it. [Assumed]
- Used hours exceed budget (e.g. 230 of 200) → completion capped 100 %, project flagged over budget. [Brief]
- Credit note in April for a March invoice → affects April; March frozen. [Assumed]
- Deleting a closed period: never possible. [Assumed]
- A legal entity created mid-year: first period = month of first registration or chosen start month. [Assumed]

## 7. Acceptance criteria
- **AC1** Given March 2027 is closed for entity A, When an employee, Finance or Admin edits/creates/deletes an entry dated 15-03-2027, Then the API returns 423/409 "Perioden er lukket" and nothing changes. [Brief §9]
- **AC2** Given period closed, When Finance reopens with reason, Then the edit is allowed and the audit log has reopen + edit. [Brief]
- **AC3** Given March reopened for employee X only, When employee Y edits a March entry, Then refused; X allowed. [Observed]
- **AC4** Given fixed price 240.000 kr, budget 200 h, 98 h approved by 31-03-2027, When March closes, Then completion 49 % and recognised to date 117.600,00 kr. [Brief §9]
- **AC5** Given Feb closed at 72.000,00 recognised, Then March "recognised this period" = 45.600,00. [Brief]
- **AC6** Given PM override 60 % with reason, Then recognised to date = 144.000,00 and the report shows the override and reason. [Brief]
- **AC7** Given 40 h approved, billable, not invoiced at 950 kr by 31-03, When the month-end report is run, Then WIP closing = 38.000,00. [Brief]
- **AC8** Given automatic mode, When March closes, Then April exists (open). [Observed]
- **AC9** Given February open, When closing March, Then refused "Luk tidligere perioder først". [Assumed]
- **AC10** Given March closed, Then re-running the March month-end report returns identical figures (snapshot). [Assumed]
- **AC11** Given an invoice draft dated 31-03, When closing March, Then close is blocked with the draft listed. [Assumed]

## 8. Open points
- Close order: does ARCnordic close the month around the 5th working day? Who closes (one named Finance person)?
- Should late approvals in closed periods be allowed (R2 default yes)?
- Should fixed-price used hours count submitted (not yet approved) hours?
- Retainer accounting: flat fee vs consumption-based, which does ARCnordic use?
- Journal export accounts (WIP, deferred revenue, revenue) — provide chart of accounts mapping from e-conomic.
