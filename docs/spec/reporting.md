# Reporting & dashboards (Rapporter og dashboards)

Release: MVP — budget vs actual, timesheet status, hours reports, CSV export, employee home. V2 — KPI reports, role dashboards,
WIP/finance reports, Excel export, reporting API/OData. V3 — custom report builder/pivot, multi-entity consolidation. Tags: [Observed] / [Assumed] / [Brief].

## 1. Purpose & roles

Give each role the numbers it acts on, with consistent KPI definitions computed in one place, drill-down to source entries, and export. [Brief]
Data scope follows overview §3: employee = own; PM = own projects; line manager = own department/reports; Finance and Management = all (Management read-only). [Brief]
Implementation note: KPI formulas live in `packages/domain` (TS) as pure functions; heavy aggregation and exports run in Python workers (D-002) against pre-aggregated tables; both are tested against the same golden JSON fixtures. [Assumed]

## 2. Screens / views

### Home dashboards (role-based) [Brief]

- **Employee**: this week's hours vs norm per day, missing days, flex balance, vacation balance (days left this holiday year), week status (+ rejection reason), my allocations next 2 weeks, running timer.
- **Project Manager**: my projects: budget hours/amount, used, remaining, consumption %, traffic-light forecast, completion % (fixed price), invoiceable WIP, pending approvals; alerts (budget > 80/100 %, retainer thresholds).
- **Line Manager**: team submission/approval status this week, utilisation last 4 weeks, flex outside limits, absence next 14 days, pending approvals.
- **Finance**: WIP total and per project, invoices to create (count/value), drafts awaiting booking, overdue debtors, unapproved hours in open period, period-close checklist status.
- **Management**: utilisation, billable %, effective hourly rate, revenue, DB, DB-grad — month / YTD vs last year, 12-month trends, by department.

### Standard reports [Brief + Observed: report catalogue]

| Report                      | Release | Key columns                                                                    | Filters                                                           |
| --------------------------- | ------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Time entries (detail)       | MVP     | date, employee, project, task, hours, billable, status, comment, rate*, value* | period, dept, employee, customer, project, task, status, billable |
| Timesheet status            | MVP     | employee × week status                                                         | period, dept, manager                                             |
| Budget vs actual (project)  | MVP     | budget h/kr, actual h/kr (sales and cost value), remaining, consumption %, DB  | project, PM, customer, contract type, status                      |
| Hours per project/customer  | MVP     | billable / non-billable hours                                                  | period, dept, customer                                            |
| Absence & vacation overview | MVP     | absence per code, vacation balance                                             | period, dept, code                                                |
| Flex balances               | MVP     | opening, period flex, closing, limit breaches                                  | date, dept                                                        |
| Employee key figures        | V2      | norm, registered, billable, utilisation, billable %, effective rate            | period, dept, employee                                            |
| KPI overview                | V2      | all KPIs below with trend                                                      | period, dept, entity                                              |
| Contribution margin         | V2      | revenue, cost, DB, DB-grad                                                     | period, customer, project, contract type                          |
| WIP / month-end             | V2      | see accounting-periods.md                                                      | period, entity                                                    |
| Invoiced & write-down       | V2      | billable value, invoiced, write-down                                           | period, customer, PM                                              |
| Debtors / ageing            | V2      | ageing buckets                                                                 | date, customer                                                    |
| Utilisation forecast        | V2      | capacity, booked, free per week                                                | weeks, dept, competence                                           |
| Pivot / custom              | V3      | user-chosen dimensions/measures                                                | any                                                               |

\* value columns hidden for roles without financial rights.

Every report: drill-down from any aggregate to underlying entries; column chooser; saved filters (personal, default, "load automatically"); CSV export (MVP), Excel (V2). [Brief + Observed: saved/default filters]

## 3. Data

- Sources: TimeEntry, Absence, Expense, Invoice/InvoiceLine/InvoiceLineSource, Task budgets, Allocation, employee norm calendar. [Brief]
- **fact_hours_daily**: tenantId, date, employeeId, projectId, taskId, departmentId (as of date), billable, status, hours, salesValue, costValue — updated incrementally from outbox events, nightly full rebuild per tenant. [Assumed]
- **fact_norm_daily**: tenantId, date, employeeId, normHours, holidayHours, absenceHours (counting / non-counting), capacityHours. [Assumed]
- **SavedReport**: userId, reportKey, filters JSON, columns, isDefault. [Observed]

## 4. User actions

Open → filter → run → drill down → export; save filter, set default. Dashboards fixed per role in V2; widget customisation V3. [Observed: widgets exist] [Assumed: release]

## 5. Business rules & KPI definitions

Period = selected range; hours = approved unless "include submitted" ticked. [Brief]

- **R1 Norm hours** = Σ daily norm − public holidays. Capacity = norm − absence hours.
- **R2 Utilisation (udnyttelsesgrad)** = billable hours ÷ norm hours. Example: 120 ÷ 148 (4 × 37) = 81,1 %. Variant "of capacity" = billable ÷ (norm − absence) in employee key figures. [Brief] [Assumed: variant]
- **R3 Billable % (faktureringsgrad)** = billable ÷ total registered work hours (excl. absence). 120 ÷ 150 = 80,0 %. [Brief]
- **R4 Effective hourly rate** = invoiced net (after credits, entity currency) ÷ hours of the invoiced sources. 114.000 kr ÷ 120 h = 950,00 kr/h. [Brief]
- **R5 Budget consumption** = used ÷ budget, hours and amount separately. 310 of 400 h = 77,5 %. [Brief]
- **R6 DB** = revenue − direct cost; **DB-grad** = DB ÷ revenue. Revenue: T&M invoiced (+ WIP if "incl. WIP"), fixed price recognised, retainer earned. Cost = Σ hours × cost-rate snapshot + expense cost. Example: 117.600 − 98 h × 450 (44.100) = 73.500,00 kr; DB-grad 62,5 % (same example as projects.md R9). [Brief]
- **R7 WIP**: accounting-periods.md R3/R6; live for open periods, snapshot for closed. [Brief]
- **R8 Overdue debtors** = Σ open amount of booked invoices with dueDate < today; buckets 1–30/31–60/61–90/>90. [Brief]
- **R9 Flex balance** = opening + Σ weekly flex up to date; breach if outside tenant limits. [Brief]
- **R10 Department attribution** as of the entry date, not current department. [Assumed]
- **R11 Currency**: convert with stored document FX to reporting currency. [Assumed]
- **R12 Rounding**: % 1 decimal; money whole kr on dashboards, øre in exports. [Assumed]
- **R13 Performance**: ≤ 3 s over 1M entries via fact tables, indexes (tenantId, date) and (tenantId, projectId, date), monthly partitions; detail reports paged; exports > 50.000 rows as background jobs. Week view p95 < 300 ms served from OLTP. [Brief + Assumed]
- **R14 Freshness**: facts ≤ 1 min behind; "opdateret hh:mm" footer. [Assumed]

## 6. Edge cases

- Norm 0 in period → utilisation "–". [Assumed]
- Credit notes reduce invoiced amount in the credit's period. [Assumed]
- Finance corrections update facts by event; closed periods use snapshots. [Assumed]
- 0-rate hours count in hour KPIs, not value KPIs. [Assumed]
- PM who is also an employee: no duplicate rows across scopes. [Assumed]

## 7. Acceptance criteria

- **AC1** 120 billable h, norm 148 h → utilisation 81,1 %. [Brief]
- **AC2** 120 billable of 150 work h → billable % 80,0 %. [Brief]
- **AC3** Revenue 117.600, cost 44.100 → DB 73.500, DB-grad 62,5 %. [Brief]
- **AC4** Given an employee, When filtering the time-entry report on another employee, Then only own entries are returned (server-enforced). [Brief §9]
- **AC5** Given a PM, Then budget vs actual lists only own projects. [Brief]
- **AC6** Drill-down entries sum exactly to the clicked cell. [Brief]
- **AC7** 1M entries, utilisation per department over 12 months → p95 < 3 s. [Brief]
- **AC8** CSV: decimal comma, da-DK or ISO dates (setting), UTF-8 with BOM, totals match screen. [Assumed]
- **AC9** March closed → March WIP equals the month-end snapshot. [Assumed]

## 8. Open points

- Which KPIs and targets does management use (e.g. utilisation target per role)?
- Utilisation: billable ÷ norm (default) or ÷ capacity?
- Include WIP in T&M revenue for DB by default?
- Power BI in use (priority of OData endpoint)?
