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
