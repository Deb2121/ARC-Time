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
