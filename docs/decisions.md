# Decisions log

Format: ID · date · decision · reason · status (proposed / accepted / superseded).

**D-001 · 2026-11-08 · Repository location** — Repo at `OneDrive - ARCnordic\Skrivebord\ARCnordic Time` as instructed.
Risk: OneDrive syncing `.git` and `node_modules` causes slowness/file locks. Mitigation: push to GitHub as source of truth;
exclude `node_modules`/build folders from sync or move the working copy to a non-synced path before M0 coding. · accepted (risk open, see OQ-01)

**D-002 · 2026-11-08 · Languages: TypeScript core, Python analytics service** — Product owner delegated the choice.
Decision: the whole transactional system is **one language, TypeScript**: `apps/web` (Next.js), `apps/api` (Fastify),
`packages/domain` (business rules), `packages/db` (schema/migrations). Reason: shared validation schemas and the same rule
functions run in browser and server (instant timesheet validation, one tested money/flex module), one toolchain for the
code that changes most, no duplicated business logic. **Python 3.12** is used where it is genuinely stronger and has a clean
boundary: `services/analytics` (FastAPI) from M3 — read-only reporting API/OData for Power BI, heavy KPI aggregation,
Excel exports, CSV import validation, payroll export files. It talks to Postgres with a read-only role and to the shared
Postgres job table; it never writes financial data directly (writes go through the TS API so rules + audit stay in one place).
Rejected: FastAPI as main backend (would split business rules from the frontend and require a generated client for every
change); two backends sharing rules (duplication). · accepted

**D-003 · 2026-11-08 · Contracts are child objects of projects** — A project has 1..n contracts; each task is linked to
exactly one contract. "Hybrid" = several contracts on one project. Matches observed reference behaviour and covers the
brief's "contract type per task/phase" without a special hybrid type. · accepted

**D-004 · 2026-11-08 · Fixed-price completion** — Default method = hours used ÷ budget hours, capped at 100 %, PM override
with reason (brief). Value-based method and the correction strategies for budget changes (observed) are V3 options; default
correction = spread over the remaining budget. · accepted

**D-005 · 2026-11-08 · Hour input formats** — Accept `1,5`, `1.5`, `1:30`; store decimal hours numeric(6,2), 0.25 step
enforced in UI and API. Display format is a tenant setting (decimal default). · accepted

**D-006 · 2026-11-08 · Approval granularity** — Submission per period (week default, month optional) as briefed; the
reference product also allows per-day submission — not adopted for MVP (simpler state model). · accepted

**D-007 · 2026-11-08 · Visual identity** — Inspired by arcnordic.dk: brand red `#CA0538` used sparingly on neutral
surfaces, Open Sans + a geometric heading font (candidate Jost). Status colours deliberately distinct from brand red.
See `docs/research/brand.md`. · proposed (awaiting official brand guide, OQ-11)

**D-008 · 2026-11-08 · Retainers as a contract type** — Retainer/prepaid = contract with recurring periods holding a pool
(hours or money), alert thresholds 80/100 %, rollover rule none / carry remaining / carry capped. · accepted

**D-009 · 2026-11-08 · Toolchain** — Installed Node.js 26 LTS + pnpm 10 (winget/npm). Docker Desktop 29.9 present.
Python 3.12, Git 2.56 present. GitHub CLI download failed (network); not required — Git Credential Manager handles GitHub login. · accepted

**D-010 · 2026-11-08 · Product name in code** — Package scope `@arc-tid/*`, display name "ARCnordic Tid".
The reference product is never named in product code or UI; only in `docs/research/`. · accepted

**D-011 · 2026-11-08 · Backend stack details** — Fastify (not NestJS: less framework, plain functions, easy to test) +
Zod schemas shared with the web app + `fastify-type-provider-zod` / OpenAPI generation; Drizzle ORM + SQL migrations
(SQL-first, explicit row-level-security policies); job queue = pg-boss on Postgres (no Redis to run); Vitest for unit/
integration tests; Playwright for E2E; Biome for lint + format (one fast tool instead of ESLint + Prettier). · accepted

**D-012 · 2026-11-08 · Multi-tenancy enforcement** — Every tenant table has `tenant_id` + Postgres RLS policy
`tenant_id = current_setting('app.tenant_id')::uuid`. The API connects as a non-owner role without BYPASSRLS and sets
`app.tenant_id` per transaction (`SET LOCAL`). Migrations run as the owner role. · accepted

**D-013 · 2026-11-08 · Business-rule defaults (owner delegated: "just make something")** — All are tenant settings
and can be changed later without code changes. · accepted

| Topic                  | Default                                                                                                                                          | Answers |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| Approval flow          | Line manager approves the whole week; PM step available but off                                                                                  | OQ-13   |
| Period                 | ISO week                                                                                                                                         | OQ-13   |
| Closing rule           | Warn (not block) when a week is below norm                                                                                                       | OQ-14   |
| Company days           | Grundlovsdag half day; 24 Dec and 31 Dec full days off (company calendar, on top of statutory)                                                   | OQ-15   |
| Vacation               | 25 days/year accrued 2,08 days/month (samtidighedsferie, holiday year 1 Sep–31 Aug), unit = days; 5 feriefridage granted 1 Jan per calendar year | OQ-16   |
| Flex                   | No hard cap; warning outside ±37 h; overtime goes to flex (no paid overtime)                                                                     | OQ-17   |
| Opening balances       | Entered by admin per employee at go-live (import tool in M4)                                                                                     | OQ-18   |
| Time format / timer    | Decimal display; timer rounds to nearest 0,25 h (min 0,25); no future-dated work, future absence allowed                                         | OQ-19   |
| Approver edits         | Approvers reject with comment; they cannot edit hours                                                                                            | OQ-20   |
| Sickness privacy       | Colleagues and PMs see "Fravær"; reason visible to the employee, line manager, finance, admin                                                    | OQ-21   |
| No manager (e.g. CEO)  | Approved by any admin other than the person themselves                                                                                           | OQ-22   |
| Fixed price completion | All hours on the contract's tasks count                                                                                                          | OQ-26   |
| Payment terms          | Netto 30 dage                                                                                                                                    | OQ-31   |

**D-014 · 2026-11-08 · Contract hourly rate in the rate order** — A contract's own hourly rate is treated as the
catch-all line (no price group, no task type) of the project price list, i.e. step 2 of the brief's resolution order.
Specific lines on a project price list still win over it; customer and standard lists apply only when neither exists.
Keeps simple projects simple (one rate on the contract) without a separate price list per project. · accepted

**D-015 · 2026-11-08 · Invoice numbering and immutability** — Numbers are assigned only at booking, inside the booking
transaction, from a per-legal-entity counter row locked with `SELECT … FOR UPDATE`; a failed booking rolls back the
counter too, so there are never gaps or reuse. Credit notes share the series. Booked invoices and their lines are
protected by database triggers (not only API checks). · accepted

**D-016 · 2026-11-08 · PDF rendering** — Invoices are rendered from an HTML template by headless Chromium (Playwright's
browser, already used for E2E) in the API process for M2; moves to the Python/worker side with the job queue in M3. · accepted

**D-017 · 2026-11-08 · Run locally, no hosting for now** — Product owner: "don't host anything — start it in VS Code
on localhost". The app runs on the owner's PC via `Start-ARCnordic-Tid.cmd` / VS Code task (Docker for Postgres,
Node for API + web). Azure deployment (brief §6) is deferred until the owner asks for it; nothing is published or
exposed outside localhost. · accepted

**D-018 · 2026-11-08 · Code structure (GRASP) and documentation rules** — Owner requirement: clear GRASP structure
and documentation so new developers can take over. Route files are thin Controllers; workflows live in services
(Pure Fabrication); rules in `packages/domain` (Information Expert); external systems behind adapters
(Polymorphism / Protected Variations); services throw `AppError` instead of depending on HTTP code (Low Coupling).
Every file has a header and every export a JSDoc, enforced by `scripts/check-docs.mjs` in `pnpm check` and the
pre-commit hook. Guide: `docs/architecture.md`. · accepted

**D-019 · 2026-11-08 · Expenses: approval, VAT, mileage rates, receipts** — One approval step: the employee's line
manager (Finance/Admin may approve anyone's, never their own). VAT is split from the VAT-inclusive amount per
expense type, with a deductible share (restaurant/representation 25 %). Mileage uses a yearly rate table (high rate
up to 20.000 km per person per year, low rate above); the seeded rates are illustrative and must be verified by
Finance. Billable expenses need a project and are re-invoiced at net + markup, once (reserved like hours).
Receipts ≤ 10 MB, type checked by content (PDF/JPEG/PNG/WebP), stored locally under data/uploads (D-017);
malware scanning and company-card import are V2. · accepted

**D-020 · 2026-11-08 · Dashboard, reminders and Outlook calendar import** — The home page shows a role-based to-do
list and, for line managers/Finance/Management/Admin, utilisation and billable share (last 4 complete weeks, plus a
12-week trend) using the KPI definitions in `packages/domain/src/kpi.ts`; revenue and effective rate only for
company scope. Weekly reminders run Monday from 09:00 (Copenhagen) and only when SMTP is configured; each is sent
once (reminder_log). Outlook import is read-only (`Calendars.Read`), off unless Entra sign-in and
GRAPH_CALENDAR_ENABLED are set; the delegated access token is stored AES-256-GCM encrypted (key derived from
SESSION_SECRET), no refresh tokens are kept, so the user reconnects by signing in with Microsoft again. Picked
meetings become draft hours on one chosen task through the normal timesheet rules; per-subject mapping rules are V2.
· accepted

**D-021 · 2026-11-08 · Python analytics service** — `apps/analytics` (FastAPI) serves KPI JSON, a KPI Excel workbook
and flat datasets for Power BI / Power Query. It connects as the read-only role `arc_analytics` (SELECT on reporting
tables only, row-level security applies, every query in a read-only transaction with app.tenant_id set) and
identifies the caller from the normal sign-in cookie via auth_get_session(); only Finance, Management and Admin get
data. KPI formulas live in `arc_analytics/kpi.py`, mirror `packages/domain/src/kpi.ts` and are tested with the same
worked examples. Norm-based utilisation stays in the TypeScript dashboard (single norm-calendar implementation).
Power BI service refresh needs API tokens (spec R10), which come later; until then the datasets work from a
signed-in browser or Excel. `pnpm dev` starts it via dev.mjs (creates .venv on first run, skipped if Python is
missing). · accepted

**D-022 · 2026-11-08 · Approval modes** — Admin chooses per tenant (Indstillinger → Godkendelse): _line manager_
(default, D-013), _project manager first, then line manager_, or _none_. In the PM mode each project with submitted
hours is one PM step (projects without a manager, or managed by the employee, skip to the line manager; absence is
always the line manager's). A PM approval makes the week "partially approved"; a PM reject sends only that project's
hours back, with the comment prefixed by the project number; edited entries lose their PM stamp, so after
resubmission only they return to the PM (spec R3/AC3). The line manager may approve before all PM steps are done
("on behalf", recorded in the audit log). Mode _none_ approves at submission with the same rate snapshots, event and
audit row. The employee can withdraw a week only while no step is approved. · accepted

**D-023 · 2026-11-08 · Payroll export, first version** — Monthly pay periods from the go-live month (no pay groups yet),
generic CSV per spec R9 (UTF-8 BOM, `;`, decimal comma). Exported: approved absence on its mapped salary code (days =
hours ÷ that day's norm), approved mileage (km + reimbursement) and approved expenses as reimbursement — all expenses
count as paid by the employee until company cards exist (V2). Employees without a payroll number are left out with a
warning. Re-exporting an unlocked month replaces its file; locking is final, and later changes to a locked month are
delivered as delta lines with `original_period` in the next export. Finance only. Overtime, per diem, pay groups and
provider APIs (Danløn/DataLøn/Zenegy) are later, behind adapters, sandbox only. Seed salary/provider codes are
illustrative — Finance must replace them with the real payroll system's codes. · accepted

**D-024 · 2026-11-08 · Data import** — Customers, projects and employees can be imported from CSV saved in Excel
(`;`, `,` or tab; UTF-8 or Windows-1252; Danish or English column names; Danish numbers and dates). Every import is
a dry run first (create / update / errors per row); the import itself is all rows or none and refused while any row
has an error. Matching: customers and projects by number (old numbers are kept), employees by e-mail. Imported
employees have no password and sign in with Microsoft; they get the employee role plus any listed roles, the
full-time norm unless another pattern is named, and departments are created when missing. New projects get one task
"Generelt" so hours can be registered at once. Customers/projects: Admin or Finance; employees: Admin. Max 2.000
rows per file. Time entries and invoices are not imported (opening balances for flex and vacation are). · accepted

**D-025 · 2026-11-09 · Access policy and segregation of duties** — The role matrix (docs/spec/overview.md §3) lives
in one class, `AccessPolicy` (packages/domain/src/access.ts); routes call `requireCapability`, the web reads the
capabilities from `/me`. Deliberate choice after review: **Admin configures but does not transact** — only Finance
books and credits invoices, closes/reopens accounting periods, exports payroll, prepares invoices for all projects
and approves anyone's expenses; Admin keeps settings, people, price lists and payroll _setup_. People without a line
manager are approved by Finance (not Admin). Project managers create projects only with the extra right
`create_projects` (spec "create if right", granted per person in Medarbejdere). Sickness privacy (OQ-21): the reason
behind sensitive absence codes is shown only to the employee, their line manager (direct or indirect) and Finance;
everyone else sees "Fravær" without comment — in the week view, the time-entry report and the analytics datasets.
The audit log has a read screen (Revisionsspor): Finance sees financial entities, Management and Admin everything.
· accepted

**D-026 · 2026-11-09 · GDPR** — Data-subject export as one JSON file (spec says ZIP of JSON+CSV; JSON is enough for
now). Erasure = pseudonymisation of former employees (inactive, not PM on active projects, no reports): profile
identifiers replaced, comments cleared, non-bookkeeping data deleted; bookkeeping data kept 5 years after the fiscal
year (assumed calendar year, OQ-39). Deactivating an employee signs them out at once (R8). A nightly sweep removes
expired sessions/tokens and logs older than 13 months and _reports_ bookkeeping data past retention; deleting
accounting records is left to a deliberate Finance action after confirming with the accountant. Processing
inventory: docs/gdpr/processing-inventory.md. · accepted

**D-027 · 2026-11-09 · Operations** — Local daily backups (pg_dump, 14 kept) before migrations, VS Code tasks for
backup/restore, restore verified. Hosting proposal for go-live (Azure EU: Container Apps + managed Postgres with
point-in-time restore + Key Vault + Blob for receipts), M365 mail, and steps to move the working copy out of OneDrive
are in docs/operations.md; they need owner decisions. · proposed

**D-028 · 2026-11-09 · Power BI / Excel access with personal tokens** — The analytics datasets were only reachable
with the browser sign-in, which Power BI cannot use. Finance, Management and Admin now create personal, read-only
tokens (Rapporter → Power BI og Excel); Power BI sends them as `Authorization: Bearer arct_…`. Only the SHA-256 hash
is stored, the token is shown once, expires after a year, can be revoked, stops working when the person is
deactivated, and creation/revocation is audited. A token sees exactly what its owner may see (incl. sickness
masking). Two flat KPI datasets were added (project_kpis, employee_kpis) in BI units (hours/kroner as decimals,
shares as fractions). Scheduled refresh in the Power BI service needs the analytics service hosted on HTTPS
(D-027); until then Power BI Desktop refreshes locally. Guide: docs/guides/power-bi.html (the PDF was removed 2026-11-17 and can be printed from it again). · accepted

**D-029 · 2026-11-10 · Sagsøkonomi, faktureringsplan og debitorliste; Finance gets more Admin rights** — Module for
Finance on top of the existing model (spec: docs/spec/case-finance.md). Honorarform comes from the case's contracts
(time & material = medgået tid; fixed price and retainer = fast honorar), so there is no separate `feeType` column.
Ekstraarbejde = a phase moved to the case's time & material contract. The payment plan is extended (sequence, phase
link, percentage, active flag). Instalment status (afventer/planlagt/klar/faktureret) is computed from the rules,
not stored, and the invoice suggestion now takes only klar instalments of active plans. New tables
`invoice_payments` and `invoice_reminders`. Fee thresholds and the a conto switch are tenant settings edited by
Finance. Excel export is CSV for Danish Excel, like the other reports. Access: Finance and Management see all
cases and invoices, project managers only cases they manage, employees nothing. Finance additionally gets people
import and the full audit log (owner's request: "finance should have access to almost everything as admin"). GDPR
and system settings stay with Admin. This relaxes the segregation of duties in D-025 for those two rights. · proposed
(branch feature/sagsokonomi)

**D-030 · 2026-11-15 · Demo: Karen Holm is Admin and Finance** — The owner's request: Karen runs the finances and must
reach the whole system (projects, budgets, customers, invoicing, periods, payroll). She now holds Management, Admin,
Finance and Line manager in the demo seed. The matrix in D-025 is unchanged: each transaction still requires the
Finance role, and a pure Admin still cannot book or close; a person may simply hold both roles, which suits a small
firm. Nobody approves their own week, so Karen's timesheets are still approved by another Finance person (Jonas
Friis). Roles are changed per person in Medarbejdere. · accepted (branch feature/sagsokonomi)

**D-031 · 2026-11-15 · Comments on hours are optional** — The owner's decision: writing a comment on registered hours
is voluntary everywhere. The per-project "Kræv kommentar på timer" setting and the `comment_required` rule are removed
(migration 0028 drops `projects.comment_required`). Comments can still be written on any cell and are printed on the
invoice's time specification. Rejecting a week or a project-manager decision still needs a reason (unchanged).
· accepted (branch feature/sagsokonomi)

**D-032 · 2026-11-16 · One set of budget warning thresholds; DB-grad instead of DB** — The project list said
"På sporet" (warning from a fixed 90 %) while Sagsøkonomi said "Overskridelsesrisiko" (Finance's 75 %) for the same
case. Budget health in Projekter, the project page and Rapporter now uses the fee thresholds Finance sets under
Sagsøkonomi (default warning 75 %, over above 100 %), so both screens agree. The project list also shows
"N faser over budget" when a phase (top-level task, rolled up) is over its own budget, and the status dot explains
itself on hover ("75 % af budgettet er brugt. Advarsel fra 75 %."). At the owner's request the contribution margin in
kroner (DB) is no longer shown on screens or in the budget CSV; only DB-grad is. · accepted (branch feature/sagsokonomi)

**D-033 · 2026-11-16 · Readable Excel exports next to CSV** — CSV opened in Excel was hard to read (narrow columns,
`#######` dates, WBS "3.2" treated as a number or date, English statuses). Every report (time entries, budget and
forbrug, sagsoversigt, debitorliste, løn) now has "Hent som Excel (.xlsx)" next to "Hent som CSV". One shared module,
`apps/api/src/services/export.ts` (ExcelJS 4.4), turns a report's column description into both files: widths from the
longest value (8–60, comments wrap), real dates, hours/amounts as numbers (`#,##0.00`), codes as text, a bold frozen
header with autofilter, a SUBTOTAL totals row and Danish values (status, Ja/Nej). CSV stays for import: UTF-8 with
BOM, `;`, decimal comma without thousands separator, dd-mm-åååå. Exception: the payroll CSV is the payroll system's
import file and keeps its fixed format (ISO dates); the Excel version is a readable copy built from that same file.
File names: `ARCtime_<rapport>_<periode>.xlsx`. · accepted (branch feature/sagsokonomi)

**D-034 · 2026-11-17 · Finance feedback, step 1: Medgået tid/Fastpris, re-invoicing choice, company car** — From the
finance employee's review. (1) New cases are created as **Medgået tid** (was shown as "Regning") or **Fastpris** only;
the `retainer` type stays in the schema so existing Rammeaftale cases keep working, but is no longer offered.
(2) **Viderefaktureres til kunden** (Ja/Nej) must be chosen actively when a case with a customer is created; an
internal case is always Nej (`billable_needs_customer`). Nej makes the case's tasks non-billable: the hours count
in kostpris (cost) but have no billable value (forbrugt 0) and never reach the invoicing basis. Expenses on a re-invoiced case are pre-ticked "viderefaktureres".
(3) Mileage has a **vehicle**: own car = tax-free allowance at the state rate (20.000 km threshold) through payroll;
company car = no allowance and nothing in the payroll file, but the trip keeps the value km × high rate so it can be
re-invoiced and counted in the case cost (the customer km price is an open question for Finance). (4) Min uge gets an
"Udlæg/kørsel" row: per-day sum and a "+" that opens the expense form with the date filled in. Expenses keep their own
approval flow. Migration 0029 sets existing mileage to own car and renames contracts called "Regning". · accepted
(branch feature/sagsokonomi)

**D-035 · 2026-11-17 · One practical guide replaces the earlier guide PDFs** — On the owner's request all guide PDFs
(testguide, økonomiguide, brugervejledning, Power BI) were deleted, and the two exercise guides were replaced by one
guide, `docs/guides/arctime-i-praksis.html` → `ARCtime-i-praksis.pdf`: three cases (medgået tid, fastpris with
instalments, a case that is not re-invoiced), hours and own/company-car mileage from Min uge, approval, invoicing,
payment, reminder, payroll and month-end, with explanations. All numbers were checked by running the whole flow on a
fresh copy of the demo database. Figures that depend on the generated demo hours are given as increases, not totals.
`brugervejledning.html` and `power-bi.html` remain as sources. · accepted (branch feature/sagsokonomi)

**D-036 · 2026-11-17 · Customer km price 4,50 kr and Medgået tid med loft** — Finance's answers (open-questions.md §H).
(1) Re-invoiced mileage is charged at the **customer km price** (`mileage_rates.customer_rate`, 4,50 kr/km in the
seed), for own and company car alike, independent of the employee's allowance. The amount is stored on the expense
(`bill_amount` = km × customer price) when it is saved, and the invoicing basis and the invoice line use it (+ markup);
ordinary expenses keep using the net amount. Migration 0030 fills it for existing mileage. (2) New cases offer three fee
forms: Medgået tid, **Medgået tid med loft** (time_material with `max_hours`; the existing invoicing cap stops at the
cap, the rest is free) and Fastpris. A cap on a fixed-price case is refused (`cap_needs_time_material`). · accepted
(branch feature/sagsokonomi)

**D-037 · 2026-11-17 · Leave accounts (løntidskonti) for ferie and feriefridage** — Finance's answers (open-questions.md
§H). New page **Ferie og fridage** (`/leave`) shows two accounts per employee laid out like TimeLog's: date, text,
days, factor, positive, negative and a running balance. (1) **Ferie** accrues 2,08 days at the end of every month that
has ended; a part month (start or end of employment) accrues pro rata 2,08 × employed calendar days ÷ 30, capped at
2,08 — TimeLog's rule, checked against the real account: 1,11 + 7 × 2,08 − 11 = 4,67 (domain test). (2)
**Feriefridage** accrue monthly at an individual rate per employee (`users.extra_holiday_per_month`, e.g. 0,50; 0 =
none), set by Finance/Admin on the page. (3) Accrual postings are **derived** from the rules (not stored), so a month
can never be posted twice and re-running is harmless. (4) Leave (absence codes FERIE / FERIEFRI) is drawn when the week
is **approved**, as days = hours ÷ the day's norm; registered but unapproved leave shows as "afventer", and a warning
appears if it would make the balance negative (forskudsferie). (5) Manual postings (correction, carry-over, payout,
lapse) are stored in `leave_adjustments`, refused in a closed month and audited. The account runs from the go-live
date with the opening balance (users.vacation_opening / extra_holiday_opening). The home page shows the same balance.
Visibility: self, line manager, Finance/Admin/Management. Not yet: the year-end list with Overfør/Udbetal/Bortfalder
as one action, ferie requested as a period, and the payroll program's real codes. · accepted (branch feature/sagsokonomi)

**D-038 · 2026-11-19 · Member price on a case (dropdown or manual price)** — Finance feedback 2026-11-17 ("flere
timepriser … dropdown med standardpriser eller manuel pris"). On the case page, under Projektdeltagere, the project
manager, Finance or Admin sets a person's own hourly price on the case: the case's hourly rate (default), a person-level
line of the customer's price list or the standard price list valid today (e.g. "Partner · Standardprisliste 2026",
1.350 kr), or a price typed in by hand. It is step 1 of the rate resolution (rates.md R1, `project_employee_rates`),
which already existed without a screen. One price per person per case (unique index, `label` = where it came from,
null = manual; migration 0032). It applies to every hour not yet approved — Forbrugt and Sagsøkonomi now use it in
the estimate before approval — while approved hours keep their snapshot (R3). A label is only kept if it matches a
current list line at that price. Every change is audited (action member_rate: member, timepris, prisgrundlag before →
after). Prices are sent only to those who may change them; team members do not see colleagues' prices. Not on a case
that is not invoiced (rate_not_billable). · accepted (branch feature/sagsokonomi)

**D-039 · 2026-11-19 · Rate plan generator and sub-consultants' invoices** — Finance's Excel sheet for Baltoppen
(2026-11-13) and the answer "underrådgivere skal registreres". (1) **Rate plan generator** (case page → Faktureringsplan
→ "Rateplan-generator", fixed price only): fee per phase = own fee + its share of "honorardele til fordeling" (split
over chosen phases in proportion to their own fee); sub-consultants either fixed per phase or a total split by the
phases' shares; ARCnordic's part is the rest; each phase is cut into instalments from a start month by a pattern of
weights one month apart (1-1-1, 2-1, 1-2-2-2-2-1); phases may overlap (rate 5 and 6 in March 2027), numbering is by
date then phase order. All splits use the largest remainder method so everything adds up to the øre (the sheet's
floats give 4.789.999,999…); the domain test rebuilds Baltoppen to within 1 øre per figure. Input is stored per
contract (fee_plans, migration 0033), exported to Excel with a control row, and written to the billing plan only on
"Brug som kladde" — as a DRAFT with exact amounts, refused while the plan is active or has invoiced/reserved
instalments, so nothing running or invoiced is replaced; activation keeps the billing plan's own 100 % rule, and a
total that differs from the contract price is shown as a warning. (2) **Sub-consultants' invoices**
(subconsultant_invoices): registered on the case (optionally a phase) by Finance or the project manager, compared
with the sub-consultant's fee in the rate plan (budget / registered / rest). "Videresendes" puts the invoice in the
invoicing basis and on the customer's draft at amount + markup (default 0 %, set per invoice until Finance decides);
reserved while on a draft, released when the draft or line is deleted, marked invoiced on booking, re-opened by a
credit note with re-open — the same life cycle as expenses. Not on a case that is not invoiced (rebill_not_billable);
a warning on fixed price (the sub-consultant is normally in the instalments). Changes are audited. Additive only: two
new tables, no existing rows changed. · accepted (branch feature/sagsokonomi)

**D-040 · 2026-11-19 · Only Admin creates cases; Finance approves every week** — The owner's decision. (1) Cases are
created by **Admin only**: not Finance and not project managers — the per-person right `create_projects` (D-025) no
longer grants it (stored rights are left in place but ignored, and the checkbox is gone from Medarbejdere). The web
shows "+ Nyt projekt" only to Admin. (2) New approval mode **"finance"** (Indstillinger → Godkendelse, next to none /
line_manager / pm_then_line_manager): every submitted week goes straight to Finance, who approves or rejects it (with
a required comment); line managers and project managers no longer approve hours and their week inbox is empty;
nobody approves their own week. Implemented as a separate rule for weeks (`canApproveTimesheet` /
`timesheetApproveeIds` in services/approval.ts), so expenses and leave planning keep their own rule (line manager or
Finance). The demo tenant uses "finance" (seed; the running demo is switched in Indstillinger, audited); other modes
are unchanged. This tightens D-013 and D-025. · accepted (branch feature/sagsokonomi)

**D-041 · 2026-11-19 · Afslut fase, Afslut sag, sub-consultants in kostpris** — The owner asked for the case's end of
life to be visible and controlled by people, not only by dates. (1) **Afslut fase** (project manager, Finance, Admin —
in Opgavestruktur and Sagsøkonomi, with one confirmation): closes the phase and every task under it, so no more hours
and it leaves Min uge (the existing task_closed rule), and its instalment becomes klar at once (the billing plan's
"phase done" rule, which had no button before). Refused while someone has draft/rejected hours on the phase
(phase_has_open_hours) so nobody is stuck with hours they cannot correct. **Genåbn fase** reverses it. (2) **Afslut
sag** (Admin only, like creating a case, D-040): a checklist of what is still open — hours not approved, approved
time-and-material hours not invoiced, instalments not invoiced, expenses not approved/invoiced, sub-consultant
invoices to re-invoice, draft invoices; completion is refused (case_not_done) until it is empty. Unpaid invoices are
shown but do not block (they stay on the Debitorliste). The case gets status completed and an end date; it leaves
Min uge (existing project_inactive rule) and shows "Afsluttet"; all history is kept. **Genåbn sag** sets it active.
(3) Sub-consultants' registered invoices are added to the case's **kostpris** in Sagsøkonomi and shown as "heraf
underrådgivere" (domain caseFinance externalCost). The Projekter page's DB-grad stays hours-based. All audited; no
schema change. · accepted (branch feature/sagsokonomi)
