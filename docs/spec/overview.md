# ARCnordic Tid — Functional specification overview

Status: Phase 1 draft, 2026-11-08. Tags: **[Observed]** = seen in public sources of the reference product (see
`docs/research/timelog-public-notes.md`); **[Assumed]** = our design decision; **[Brief]** = required by the product owner's brief.

## 1. Product in one paragraph
ARCnordic Tid is a multi-tenant PSA for firms that sell hours and projects (architects, engineers, consultants).
Employees register time, absence and expenses; managers approve; project managers steer budgets and staffing;
finance turns approved work into invoices, closes months and exports payroll; management follows KPIs.
Danish first (da-DK), English second; Europe/Copenhagen; ISO weeks; money in øre.

## 2. Module map
| # | Module | Spec file | Depends on |
|---|---|---|---|
| 1 | Organisation & people (tenants, legal entities, departments, employees, norm time, holiday calendars, roles) | `organisation.md` | — |
| 2 | Customers & light CRM | `crm.md` | 1 |
| 3 | Projects, tasks, contracts, templates, Gantt | `projects.md` | 1, 2, 9 |
| 4 | Time tracking | `time-tracking.md` | 1, 3 |
| 5 | Absence, flex & vacation balances | `absence-flex.md` | 1, 4 |
| 6 | Approval | `approval.md` | 4, 5, 7 |
| 7 | Expenses, mileage & allowances | `expenses.md` | 1, 3 |
| 8 | Resource planning | `resource-planning.md` | 1, 3, 5 |
| 9 | Price lists & rates | `rates.md` | 1, 2 |
| 10 | Invoicing | `invoicing.md` | 3, 4, 7, 9, 11 |
| 11 | Accounting periods & revenue recognition | `accounting-periods.md` | 1, 3, 10 |
| 12 | Payroll export | `payroll.md` | 5, 7 |
| 13 | Reporting & dashboards | `reporting.md` | all |
| 14 | Integrations & API | `integrations.md` | all |
| 15 | Administration, audit & GDPR | `administration.md` | all |

```
           ┌──────────── Organisation & people ─────────────┐
           │                                                │
   CRM ── Projects/Contracts ── Rates          Absence/Flex ┤
              │      │                             │        │
        Time tracking + Expenses ──► Approval ◄────┘        │
              │                         │                   │
     Resource planning           approved entries           │
                                   │         │              │
                              Invoicing   Payroll export ◄──┘
                                   │
                         Accounting periods / WIP / revenue
                                   │
                     Reporting · Integrations · Audit
```

## 3. Roles and permissions
Roles are additive; one user can hold several [Brief]. Data scope is role + relationship (manager-of, PM-of, project member) [Brief].
Server-side enforcement only [Brief]. "Approve on behalf of" is a separate right for substitutes [Observed].

Legend: ✔ full · ◐ scoped (see note) · R read-only · — none

| Capability | Employee | Project Manager | Line Manager | Finance | Management | Admin |
|---|---|---|---|---|---|---|
| Own time/absence/expenses: create, edit draft, submit | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| View others' time entries | — | ◐ own projects | ◐ own reports (direct + indirect) | ✔ | R | R¹ |
| Approve time | — | ◐ own projects (if PM step enabled) | ◐ own reports | ◐ correction only | — | — |
| Approve absence | — | — | ◐ own reports | — | — | — |
| Approve expenses | — | ◐ own projects | ◐ own reports | ✔ final step | — | — |
| Correct approved entries (audited) | — | — | — | ✔ | — | — |
| Projects: create / edit | — | ✔ own (create if right) | — | ✔ | R | ✔ |
| Budgets, allocations, payment plans | — | ◐ own projects | R own reports | ✔ | R | ✔ |
| Resource planner | R own | ✔ own projects | ✔ own dept | R | R | ✔ |
| Customers/CRM | R | ✔ | R | ✔ | R | ✔ |
| Price lists & rates | — | R (project rates: ◐ own) | — | ✔ | R | ✔ |
| Invoice drafts: create/edit | — | ◐ prepare, own projects² | — | ✔ | R | — |
| Book / credit invoices | — | — | — | ✔ | — | — |
| Accounting periods close/reopen | — | — | — | ✔ | — | — |
| Payroll export | — | — | — | ✔ | — | — |
| Reports | own | own projects | own dept | ✔ | ✔ (read) | ✔ |
| Administration & settings | — | — | — | ◐ finance settings | — | ✔ |
| Audit log | — | — | — | ✔ financial | R | ✔ |

¹ Admin sees data for support purposes only; configurable per tenant [Assumed]. ² PM can mark draft "ready for booking"; only Finance books [Observed: separate ready-for-booking step].

## 4. Shared status models (canonical — all module specs use these names)
- **TimeEntry / Absence / Expense**: `draft → submitted → approved → invoiced`; `submitted → rejected → draft` (on edit); `submitted → draft` (employee reopens before any approval). Non-billable approved items stay `approved` (terminal for invoicing). [Brief + Observed reopen]
- **TimesheetPeriod** (per employee per week or month): `open → submitted → partially_approved → approved`; `submitted|partially_approved → rejected → open`; `approved → open` (reopen by approver, audited). [Observed + Assumed]
- **Project**: `planned → active → completed → archived`; time can be registered only when `active` [Assumed]. Optional tenant-defined *stages* are a separate, non-gating attribute [Observed].
- **Task**: `open → closed` (closed tasks accept no new time) [Assumed].
- **Invoice**: `draft → ready_for_booking (optional) → booked → (sent) → paid | partially_paid`; credit notes are separate invoices of type `credit` linked to the original [Assumed]. Booked invoices are immutable.
- **AccountingPeriod**: `open → closed`; `closed → open` (Finance, audited; optionally for one employee only [Observed]).
- **Opportunity**: tenant-defined ordered stages with default probability; terminal `won | lost` [Observed + Assumed].

## 5. Cross-cutting rules
- Hours: `numeric(6,2)`, entry step 0.25 h; input accepts `1,5`, `1.5` and `1:30` (converted) [Brief + Observed hh:mm option]. Display decimal by default; tenant may choose hh:mm display [Observed].
- Money: integer minor units (øre) + ISO currency; FX rate stored on the document; banker's rounding avoided — round half away from zero at line level, 2 decimals [Assumed].
- All dates are local dates in the tenant time zone (Europe/Copenhagen); weeks are ISO-8601 (Monday start) [Brief].
- Every change to financial data writes an audit record (who, when, before, after, reason) [Brief].
- All business calculations live in `packages/domain` as pure functions with worked-example tests [Brief].

## 6. Glossary (Danish ↔ English)
| Dansk | English | Meaning in ARCnordic Tid |
|---|---|---|
| Normtid | Norm hours / expected hours | Hours an employee is expected to work per day/week from their norm pattern, minus holidays |
| Flex / flekssaldo | Flex / flex balance | Registered (work + counting absence) − norm; accumulated balance |
| Fakturerbar | Billable | Can be invoiced to the customer |
| Ikke-fakturerbar / intern tid | Non-billable / internal time | Cannot be invoiced |
| Timeregistrering | Time entry | One registration of hours on a date/task |
| Timeseddel | Timesheet | An employee's entries for a period (week/month) |
| Godkendelse | Approval | Manager/PM acceptance of submitted entries |
| Afvisning | Rejection | Return to employee with mandatory comment |
| Fravær / fraværskode | Absence / absence code | Vacation, sickness, etc. |
| Ferie / feriedage / feriefridage | Vacation / vacation days / extra days off | Danish holiday entitlements |
| Afspadsering | Time off in lieu | Using flex/overtime balance as time off |
| Barns første sygedag | Child's first sick day | Absence code |
| Helligdag | Public holiday | Reduces norm hours |
| Sagsnummer / projekt | Project number / project | |
| Opgave / aktivitet | Task / activity | Node in the WBS |
| Opgavestruktur (WBS) | Work breakdown structure | Task tree, max 5 levels |
| Kontrakt / aftale | Contract | Commercial terms attached to a project |
| Regning (løbende) / medgået tid | Time & material (T&M) | Billed by hours used |
| Fastpris | Fixed price | Agreed price, billed by payment plan |
| Rammeaftale / forudbetalt / klippekort | Retainer / prepaid | Pool of hours/money per period |
| Betalingsplan / rate | Payment plan / milestone payment | Scheduled fixed-price invoicing |
| Budget | Budget | Planned hours and amount |
| Forbrug | Consumption / actuals | Used hours/amount |
| Færdiggørelsesgrad | Percentage of completion | Used ÷ budget hours (capped) |
| Indtægtsførsel / omsætningsrealisering | Revenue recognition | Booking earned revenue |
| Igangværende arbejde (IGV / WIP) | Work in progress (WIP) | Approved, not yet invoiced value |
| Periodeafgrænsning / forudbetalt omsætning | Deferred revenue | Invoiced but not yet earned |
| Dækningsbidrag (DB) | Contribution margin | Revenue − direct cost |
| DB-grad | Margin % | DB ÷ revenue |
| Kostpris / kostprisgruppe | Cost rate / cost-price group | Internal hourly cost |
| Timepris / salgspris | Hourly rate / sales rate | Price per hour to customer |
| Prisliste | Price list | Set of rates |
| Nedskrivning / opskrivning | Write-down / write-up | Reduce/increase invoiced value vs registered value |
| Fakturaforslag | Invoice suggestion | Proposed invoice from invoiceable items |
| Fakturakladde | Invoice draft | Editable invoice before booking |
| Bogføre | Book / post | Finalise invoice; assigns number |
| Kreditnota | Credit note | Reverses (part of) an invoice |
| Rykker | Reminder | Payment reminder |
| Debitor | Debtor / customer account | |
| Regnskabsperiode | Accounting period | Month that can be closed |
| Lukke periode | Close period | Lock entries/invoices in a period |
| Udlæg | Expense (out-of-pocket) | Employee-paid cost to reimburse |
| Kørsel / kilometergodtgørelse | Mileage / mileage allowance | km × statutory rate |
| Diæter / rejsegodtgørelse | Per diem / travel allowance | |
| Lønart / lønkode | Salary code | Payroll mapping code |
| Lønperiode | Pay period | |
| Udnyttelsesgrad / belægningsgrad | Utilisation | Billable hours ÷ norm hours |
| Faktureringsgrad | Billable % | Billable ÷ total registered hours |
| Effektiv timepris | Effective hourly rate | Invoiced amount ÷ hours |
| Kapacitet | Capacity | Norm − absence |
| Ressourceplan / allokering | Resource plan / allocation | Planned hours per person/task/period |
| Kompetence | Competency / skill | |
| Juridisk enhed / selskab | Legal entity | Company that employs/invoices |
| Afdeling | Department | |
| Nærmeste leder | Line manager | |
| Projektleder | Project manager | |
| CVR-nummer | Danish company reg. no. | |
| EAN-nummer / OIOUBL | Public-sector e-invoice address / format | |
| Moms / omvendt betalingspligt | VAT / reverse charge | |

## 7. Release cut
**MVP (M0 + M1)** — the core loop:
organisation & employees (norm patterns, Danish holidays, roles); customers (no pipeline); projects with WBS ≤ 5 levels,
budgets (hours + amount, project/task), members; contract types T&M and fixed price (data only, no invoicing yet);
week timesheet (keyboard-first), day view, copy last week, favourites, timer; absence codes, flex, vacation balance;
submit/approve/reject (line manager; PM step optional); budget-vs-actual with contribution margin; CSV export; audit log;
dev login + Entra ID SSO.

**V2 (M2 + M3)** — money & operations:
price lists + rate resolution with snapshot; invoice suggestions, drafts, booking, numbering, PDF, credit notes;
fixed-price completion & payment plans; retainers; accounting periods & locking; WIP / month-end report; e-conomic adapter;
expenses, mileage, receipts; resource planner + heatmap; dashboards & KPI reports; reminders; Outlook calendar import;
Gantt; reporting API/OData.

**V3 (M4)** — scale & polish:
multiple legal entities with cross-entity staffing; multi-currency; Dinero, Business Central adapters; payroll export
(CSV, then Danløn/DataLøn/Zenegy APIs); PWA offline; project templates with change propagation; CRM pipeline;
rate indexation; OIOUBL/EAN; data import tools; reverse charge; drag-to-reassign in planner.

Note: the brief's milestone list puts templates and CRM pipeline in M4 and Gantt in V2 — kept as-is.
