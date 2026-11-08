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
