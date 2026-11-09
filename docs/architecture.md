# Architecture guide for developers

> **Kort på dansk:** Denne guide er til nye udviklere. Den forklarer, hvor koden ligger, hvilken rolle hver del har
> (efter GRASP-principperne), hvordan man tilføjer en ny funktion, og hvilke regler der gælder for dokumentation og
> kvalitet. Start her, læs derefter `docs/spec/overview.md` for forretningsreglerne.

ARCnordic Tid is a TypeScript monorepo: a Next.js web app talks to a Fastify REST API, which uses PostgreSQL with
row-level security. **All business rules live in one place** (`packages/domain`) as pure, tested functions.

## 1. Code map — where things live

| Folder                      | What it contains                                                                                                                                                                                                                  | Typical file                               | GRASP role                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `packages/domain/src`       | Business rules as **pure functions**: hours/money math, ISO weeks, Danish holidays, norm time, flex, vacation, entry validation, budgets, completion, rate resolution, invoice suggestions, period locking. No database, no HTTP. | `flex.ts`, `rates.ts`, `invoicing.ts`      | **Information Expert** — each module owns the knowledge needed for its calculation                             |
| `packages/db/src`           | Database schema (Drizzle), migrations, tenant scoping (`withTenant`), audit writer, and the **workflows shared by API and seed**: rate snapshots, invoicing (draft/book/credit), accounting periods.                              | `schema.ts`, `invoicing.ts`, `periods.ts`  | **Pure Fabrication** (services), **Indirection** (`withTenant`, RLS)                                           |
| `packages/db/drizzle`       | SQL migrations. Generated from `schema.ts`, plus hand-written ones for RLS, triggers and SECURITY DEFINER functions.                                                                                                              | `0001_rls.sql`                             | **Protected Variations** (tenant isolation enforced by the DB)                                                 |
| `packages/integrations/src` | Adapters to external systems behind one interface (e-conomic first). Disabled by default; sandbox only during development.                                                                                                        | `adapter.ts`, `economic.ts`, `calendar.ts` | **Polymorphism**, **Protected Variations**                                                                     |
| `apps/api/src/routes`       | HTTP endpoints. Each file lists its endpoints in the header. Validate input (Zod), check role, call **one** service, shape the response.                                                                                          | `timesheet.ts`                             | **Controller**                                                                                                 |
| `apps/api/src/services`     | API workflows and read models: timesheet, approval, invoices access, project setup, customers, reports, calendar/balances, people (who may see/approve whom), outbox delivery, invoice document.                                  | `timesheet.ts`, `approval.ts`              | **Pure Fabrication**, **Creator**, **Information Expert** (`people.ts` for the organisation)                   |
| `apps/api/src/auth`         | Sessions, CSRF, dev login, Entra ID OIDC, `requireRole`.                                                                                                                                                                          | `plugin.ts`                                | **Controller** (routes) + infrastructure                                                                       |
| `apps/analytics`            | Python analytics service (FastAPI, read-only DB role): KPI JSON, Excel export, Power BI datasets. Formulas mirror `packages/domain/src/kpi.ts`.                                                                                   | `arc_analytics/main.py`, `kpi.py`          | **Controller** (`main.py`), **Pure Fabrication** (`queries.py`, `excel.py`), **Information Expert** (`kpi.py`) |
| `apps/web/src/app`          | Next.js pages (one folder per screen).                                                                                                                                                                                            | `(app)/timesheet/page.tsx`                 | UI                                                                                                             |
| `apps/web/src/components`   | Reusable UI pieces (week grid, task picker, payment plan …).                                                                                                                                                                      | `timesheet/week-grid.tsx`                  | UI, **High Cohesion**                                                                                          |
| `apps/web/src/lib`          | API client and formatting (Danish numbers/dates).                                                                                                                                                                                 | `api.ts`, `format.ts`                      | **Pure Fabrication**                                                                                           |
| `apps/web/src/i18n`         | All UI texts, Danish (`da.ts`) and English (`en.ts`). No hard-coded text in components.                                                                                                                                           |                                            |                                                                                                                |
| `packages/ui/src`           | Design-system primitives (Button, TextField, Card, Badge, Wordmark).                                                                                                                                                              |                                            |                                                                                                                |
| `e2e`                       | Playwright end-to-end tests, incl. the full flow.                                                                                                                                                                                 | `full-flow.spec.ts`                        |                                                                                                                |
| `docs`                      | Spec, decisions, open questions, progress, demo scripts, this guide.                                                                                                                                                              |                                            |                                                                                                                |

## 2. How a request flows (example: saving a timesheet cell)

```
Browser  WeekGrid (apps/web/src/components/timesheet/week-grid.tsx)
   │  validates instantly with parseHours/isOnStep from @arc-tid/domain
   ▼  PUT /api/v1/timesheet/entries
Controller  routes/timesheet.ts         – Zod validation, then saveCell()
   ▼
Service     services/timesheet.ts       – gathers inputs (membership, period, closed months, other hours)
   │                                      calls validateEntry() and persists in one transaction
   ▼
Expert      packages/domain/timesheet.ts – validateEntry(): 24 h/day, 0,25 step, future work, locks, comment
   ▼
Database    withTenant() → RLS policy on time_entries (only this tenant's rows are visible)
```

The browser and the API use **the same domain function**, so a value the UI accepts is never refused by the server
for a different reason (and vice versa).

## 3. GRASP in this codebase

| Principle                | Where you see it                                                                                                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Information Expert**   | Calculations live with the data they need: `flex.ts` (flex), `norm.ts` (norm hours), `rates.ts` (rate order), `invoicing.ts` (suggestion lines, write-down spreading), `people.ts` (who may see/approve whom), `access.ts` (`AccessPolicy`: who may do what). |
| **Creator**              | The object that owns another creates it: `ensurePeriod` (a week creates its timesheet period), `createProject` (a project creates its first contract and PM membership), `createDraftFromSuggestion` (an invoice creates its lines and line sources).         |
| **Controller**           | Route files only: validate → authorize → delegate → respond. No SQL workflows or business rules.                                                                                                                                                              |
| **Low Coupling**         | Services throw `AppError` (`services/errors.ts`) — they do not depend on HTTP/auth code. Domain has no dependencies at all. External systems are reached only through adapters.                                                                               |
| **High Cohesion**        | One responsibility per module: `project-setup.ts` changes projects, `projects.ts` only reads/aggregates them; `invoices.ts` (access/read models) vs `packages/db/invoicing.ts` (workflows).                                                                   |
| **Polymorphism**         | `AccountingAdapter` interface — e-conomic today, Dinero/Business Central later, without touching callers.                                                                                                                                                     |
| **Pure Fabrication**     | Services that exist for good structure, not because the business has such a thing: outbox, audit writer, rate snapshot, report/CSV builder.                                                                                                                   |
| **Indirection**          | `withTenant()` between code and database; the transactional outbox between booking and the accounting system.                                                                                                                                                 |
| **Protected Variations** | Row-level security, immutability triggers on booked invoices, adapter interface, i18n keys, design tokens.                                                                                                                                                    |

## 4. Adding a new feature — checklist

1. **Spec first**: add/adjust the rules in `docs/spec/<module>.md` (mark `[Assumed]` decisions) and, if it is a real
   decision, add it to `docs/decisions.md`.
2. **Domain rule** (if there is a calculation): pure function in `packages/domain/src/<topic>.ts` with JSDoc and a
   test with a worked Danish example in a `*.test.ts` file. Export it from `index.ts`.
3. **Schema**: change `packages/db/src/schema.ts`, run `pnpm --filter @arc-tid/db generate`. A new tenant table needs
   RLS: create a custom migration (`drizzle-kit generate --custom`) and paste `packages/db/drizzle-rls-template.sql`.
   The RLS test fails if you forget.
4. **Service**: workflow in `apps/api/src/services/<topic>.ts` (or `packages/db/src` if the seed must use it too).
   Audit every change to financial data with `writeAudit`. Throw `AppError(status, code)`.
5. **Controller**: endpoint in `apps/api/src/routes/<topic>.ts`, list it in the file header, register the route
   module in `app.ts` if new.
6. **Tests**: API integration test in `apps/api/src/*.test.ts` including a permission check; E2E if it is a user flow.
7. **UI**: page in `apps/web/src/app/(app)/…`, texts in both `i18n/da.ts` and `i18n/en.ts`, reuse components and
   design tokens. Keep it simple: one clear primary action per screen.
8. **Docs**: update `docs/progress.md`; a demo script in `docs/demo/` per milestone.
9. `pnpm check` must pass (lint, docs, typecheck, tests). The pre-commit hook runs lint + docs + typecheck.

## 5. Documentation rules (enforced by `pnpm docs:check`)

- Every source file starts with a header comment: **what the module is for**, its GRASP role where meaningful, and
  the spec/decision reference.
- Every exported function, class and exported arrow-function constant has a JSDoc block directly above it:
  **what it does**, **units** (øre, centi-hours, basis points, `LocalDate` = `"YYYY-MM-DD"`), **side effects**
  (writes, audit, outbox) and an `@example` where it helps.
- Route files list their endpoints in the header.
- Comments explain _why_, not _what the next line does_.

## 6. Units and conventions (the most common source of bugs)

| Thing                      | Representation                                                   | Example                      |
| -------------------------- | ---------------------------------------------------------------- | ---------------------------- |
| Money                      | integer **øre** (`Minor`)                                        | 117.600,00 kr = `11_760_000` |
| Hours in the domain        | integer **centi-hours**                                          | 7,5 h = `750`                |
| Hours in the DB / API JSON | `numeric(6,2)` / decimal number                                  | `7.5`                        |
| Percentages                | **basis points**                                                 | 49 % = `4900`                |
| Dates                      | `LocalDate` string in Europe/Copenhagen                          | `"2026-11-08"`               |
| Weeks                      | ISO-8601, Monday start                                           | `startOfIsoWeek()`           |
| Rounding                   | half away from zero (`divRound`)                                 |                              |
| Tenant                     | every table has `tenant_id`; always query through `withTenant()` |                              |

### Object-oriented parts

The core is deliberately **functional** (pure functions over plain data are the easiest to test and to mirror in
Python). Objects are used where they model a thing with behaviour and identity, or a replaceable collaborator:

| Class / interface                                                                             | Why it is an object                                                                                                                                                      |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AccessPolicy` (`packages/domain/src/access.ts`)                                              | Encapsulates one person's roles + rights; methods `can`, `capabilities`, `seesAbsenceReason`, `canReadAudit`. The matrix is private data — callers never see role lists. |
| `AccountingAdapter`, `CalendarSource` (interfaces) + `EconomicAdapter`, `GraphCalendarSource` | Polymorphism / Protected Variations: swap systems without touching callers; tests pass fakes.                                                                            |
| `AppError`, `InvoiceError`, `PeriodError`, `IntegrationError`                                 | Error types carry HTTP status / retryable flag; the error handler maps them in one place.                                                                                |
| `CalendarProvider`, `Mailer` (interfaces)                                                     | Injected collaborators (`buildApp(config, db, deps)`), so tests never call Microsoft or send mail.                                                                       |
| Python `Caller` dataclass                                                                     | Immutable value object for the signed-in person in the analytics service.                                                                                                |

Rule of thumb: add a class when there is state that must stay consistent with its behaviour, or when callers should
depend on an interface rather than a concrete system. Otherwise write a documented pure function.

## 7. Security model in one paragraph

Sessions are opaque random tokens (only their hash is stored) with a per-session CSRF token required on every
mutating request. Roles are additive (employee, project manager, line manager, finance, management, admin) and
checked **server-side** through `AccessPolicy` (`requireCapability` in routes; the web only mirrors the capability
list from `/me`, D-025) — Admin configures, Finance transacts; data visibility rules live in `services/people.ts` and
`services/projects.ts`. Tenant isolation is enforced by PostgreSQL row-level security with a non-owner runtime role.
Booked invoices are immutable via database triggers. Financial changes are written to an append-only audit log.

## 8. Running and testing

See `README.md`. In short: `Start-ARCnordic-Tid.cmd` (or VS Code task "Start ARCnordic Tid") starts everything;
`pnpm check` runs the quality gate; `pnpm e2e` runs browser tests against the running app.
