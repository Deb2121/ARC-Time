# Decisions log

Format: ID · date · decision · reason · status (proposed / accepted / superseded).

**D-001 · 2026-11-08 · Repository location** — Repo at `OneDrive - ARCnordic\Skrivebord\ARCnordic Time` as instructed.
Risk: OneDrive syncing `.git` and `node_modules` causes slowness/file locks. Mitigation: push to GitHub as source of truth;
exclude `node_modules`/build folders from sync or move the working copy to a non-synced path before M0 coding. · accepted (risk open, see OQ-01)

**D-002 · 2026-11-08 · Languages: TypeScript + Python** — Product owner wants Python and TypeScript as main languages.
Proposal: TypeScript for `apps/web` (Next.js), `apps/api` and `packages/domain` (shared validation schemas and business
rules usable in browser and server); Python for `workers/` (reporting/KPI aggregation, OData/Power BI endpoint, Excel
export, CSV import, payroll export files, PDF rendering). Both share Postgres and the job queue (pg-boss-compatible table
or Redis). Alternative: FastAPI backend with generated TS client. · proposed (OQ-02)

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

**D-009 · 2026-11-08 · Toolchain** — Node.js and pnpm are not installed on the dev machine (Python 3.12 and Git are).
M0 will require Node 22 LTS, pnpm 9, Docker Desktop (for Postgres/Redis). · open (OQ-12)

**D-010 · 2026-11-08 · Product name in code** — Package scope `@arc-tid/*`, display name "ARCnordic Tid".
The reference product is never named in product code or UI; only in `docs/research/`. · accepted
