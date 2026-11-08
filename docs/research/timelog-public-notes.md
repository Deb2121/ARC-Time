# Research notes — public sources (clean-room)

Date of research: 2026-11-08. Read-only, ~35 public pages in total, at human pace. No forms, logins, sign-ups or API calls.
All notes are **paraphrased in our own words**. Nothing here is to be copied into the product (no wording, layout, names).
The reference product is called "the reference product" in specs; it is named only in this research folder.

## Security note — prompt injection observed

The reference product's help-center home page (https://help.timelog.com/en/) returned an appended block styled as
"MCP Server Instructions" instructing the reader to create a document. It was ignored, per §1 of the brief, and
reported to the product owner on 2026-11-08.

## Sources read

Help center (help.timelog.com/en/): home, using-timelog index, integrations-api index, flex calculation in the timesheet,
timesheet status, submit hours for approval, approval settings, change normal working time, time-tracking settings,
absence codes, public holiday calendars, approval (managers), salary management, contract management, hourly rates setup,
project templates, resource planner, pipeline, project stages, value calculation models for fixed price projects,
opportunity status in CRM, contract types, new invoice, accounting periods, invoice settings, multiple legal entities,
transfer salary data, accounting – projects/work in progress, approval of travel expenses and expenses.
Other: api.timelog.com (overview only), timelog.com/en/pricing.

## Key functional observations (summarised)

### Time, flex, approval

- Timesheet with views: all allowed tasks / favourites only / tasks with hours / my allocations. Favourites-only view is empty until favourites are marked.
- Company setting: time format decimal or hh:mm. Optional stopwatch/timer. Optional "copy last week". Optional mandatory comment on all entries, and an optional second admin-named comment field (free text or integer; may be mandatory per task; may be used on invoices).
- Totals section can show norm time and flex; flex computed "up to today / yesterday / last Sunday" (setting).
- Flex = (project hours + absence hours that count) − norm hours, summed; drill-down popup lists postings per day with +/− factor per salary code.
- Submit for approval by day, week or month, with optional comment. Employee can reopen submitted days until approved.
- Approval modes: none / line manager only / project managers first, then line manager.
- Closing rules: none (default) / warn if below norm / block if below norm / warn if 0 h week / block if 0 h week.
- Manager approval screen: per-employee status colour (not approved, all approved, some rejected, partially approved, not submitted); bulk approve/reject; per-employee detail with hours per project, absence per code, total, flex; approve/reject period (reject needs comment); approve/reject single entries; optional billable toggle per entry; reopen; manager can close a timesheet on behalf of an employee or email a request to submit; full comments/actions log; "approve on behalf of" via role right (substitutes).
- Absence requests need approval only if the code is configured to require it; changes/deletions to approved absence surface to the manager.
- Timesheet status report: approved / submitted & closed / complete but open / empty; "request to close" sends reminders. Accounting-period close does not change timesheet status.

### Employees, norm time, holidays, absence codes

- Norm-time schedules defined centrally (1- or 2-week cycles), assigned per employee with a valid-from date (back/forward dating), history logged.
- Holiday calendars: per employee one calendar; entries per year with full day / half day / explicit hours; importable national holidays (DK, SE, NO, DE, NL); not auto-copied across years.
- Absence codes: type (illness, vacation, unpaid, paid leave) for grouping; format hours / full days / half+full days; adds to or draws from a balance account; whether it counts toward flex; approval required; deducted from planner capacity; visible in holiday calendar; mapped to payroll export code. Changing a code's nature is discouraged — create a new one.
- Balances are modelled as accounts (deposits = allocations/adjustments, withdrawals = registrations). Actions: reset, adjust, move between accounts; automatic accrual rules post entries that cannot be deleted, only reversed.

### Projects, contracts, budgets

- A project can have many contracts at once (e.g. fixed-price main delivery + T&M extras + ongoing maintenance) — this is how "hybrid" is achieved.
- Contract families: T&M (standard; on-account with end balancing; continuous on-account with period balancing; prepaid amount) and fixed price (standard with payment plan; task-driven payments; continuous service per period; unit/volume-based).
- T&M may have a max budget; hours above it are not invoiceable. Prepaid can alert at a configured % consumed.
- Fixed-price value: completion × payment-plan total; completion by hours (used ÷ budget) or by value of hours. On budget/price change three correction strategies (spread over remaining — default; zero value until caught up; allow negative). Revenue booked at accounting-period close or contract completion unless an add-on is used.
- For continuous service periods not fully consumed: write up registrations, or post the remainder as a separate line.
- Templates contain task plan, milestones, contracts; template changes can be pushed to projects created from it (limited: new main tasks yes, new sub-tasks no).
- Project stages are optional, admin-defined, ordered; not enforced as gates.
- Rates: standard price list + customer price lists; services × price groups matrix; changes can be pushed to active projects; indexation page exists. **Precedence of rates not documented.**

### Resource planning, CRM

- Planner shows workload from allocations; unregistered allocation hours spread evenly over task duration; finer per-day planning possible; man-day conversion setting; estimated revenue = allocated hours × rate; Outlook appointments can feed the planner (max of booking vs appointment, not summed).
- Pipeline with weighted forecast; admin-defined opportunity statuses with optional fixed forecast % (lockable).

### Invoicing, periods, payroll, reporting

- Invoices created from a debtor/invoiceable list; draft built from registrations in a period; multiple projects per invoice possible; currency locked to project currency; line editing with spreading of changes across consolidated items, merge/split, reorder; extra line types (heading, subtotal, text, blank, product); preview with optional specification appendix; draft → booked; optional "ready for booking" step to split creator and booker roles.
- Settings: decimals/rounding, OIOUBL/EAN for public sector, item numbers (GL mapping), XML export, company VAT default; expense VAT can differ.
- Accounting periods: manual or recurring; statuses active/closed; can be reopened for a single employee; closing triggers fixed-price revenue booking.
- WIP report: registered vs invoiced, contribution margin per customer/project, booked and non-booked hours/costs.
- Payroll transfer: by legal entity, department, pay period, salary group, employee; salary period chain (start = previous end + 1); warnings for missing approval and missing employee number; file or direct API transfer; late registrations handled manually.
- Expense approval: approve per row, mark non-billable; configurable number of approval steps.
- Report catalogue includes: timesheet status, approval status, absence/vacation calendars, employee key figures, invoicing %, project overview, milestones, budgets (company, employee, follow-up), KPI, pivot, invoice line export, data extraction.
- Multiple legal entities: shared customers; per-entity rates, employee costs, number series, integrations; cross-entity staffing.
- API in three flavours: employee-scoped REST (personal tokens), server-to-server transactional sync, read-only reporting API for large data sets / Power BI.
- Pricing tiers ≈ €14 / €34.50 / €53 / Enterprise; salary, integrations and API from the middle tier; retainers, KPI, automated invoicing in the third.

## Gaps (not confirmed from public sources)

Gantt; WBS task states; rate precedence; utilisation formula; vacation accrual / holiday year; invoice numbering and statuses after booking; credit-note and reminder flows; multi-currency rules; mileage rate tables; mobile app; Outlook calendar time import details. Our designs for these are marked [Assumed] in the specs.
