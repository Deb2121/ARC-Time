# ARCnordic Tid

Time tracking, projects, budgets, resource planning, approvals, invoicing, expenses, absence/flex, payroll export and
reporting for ARCnordic. Built in-house as a clean-room implementation.

Status: **M3 Operations done; M4 payroll export and data import done** — next: remaining M4 items as needed. See [`docs/progress.md`](docs/progress.md).

**Ny udvikler? Start med [`docs/architecture.md`](docs/architecture.md)** — kodekort, GRASP-roller og "sådan tilføjer du en funktion".

## Start på din egen PC (ingen hosting)

1. Start **Docker Desktop** og vent til den er klar.
2. Dobbeltklik på **`Start-ARCnordic-Tid.cmd`** i projektmappen — eller åbn mappen i **VS Code** og vælg
   _Terminal → Run Task… → Start ARCnordic Tid_ (eller `Ctrl+Shift+B`).
3. Browseren åbner **http://localhost:3000**. Log ind med fx `lv@demo.arcnordic.test` / `demo1234`.

Det starter **testudgaven** — præcis som brugerne ser systemet, uden udviklerværktøjer eller tekniske fejlbokse
(første start bygger appen, ca. et minut). Udviklere bruger _Run Task… → Start ARCnordic Tid (udvikler)_
(hot reload og Next.js-udviklerværktøjer). Stop med `Ctrl+C` i vinduet. Frisk demo-data: _Run Task… → Nulstil demo-data_. Tests: _Run Task… → Kør tests_.

## Run locally (developer details)

Requirements: Node.js ≥ 22, pnpm 10, Docker Desktop.

```powershell
pnpm install
pnpm db:up; pnpm db:migrate; pnpm db:seed
pnpm dev                 # web http://localhost:3000 · API http://localhost:4000 · API docs /api/docs
```

Demo users (fictional): `kh@demo.arcnordic.test` (admin), `jf@…` (finance), `al@…` (line manager), `lv@…` (employee) — password `demo1234`.
Walkthroughs: [`docs/demo/m0-foundation.md`](docs/demo/m0-foundation.md), [`docs/demo/m1-core-loop.md`](docs/demo/m1-core-loop.md), [`docs/demo/m2-money.md`](docs/demo/m2-money.md), [`docs/demo/m3-operations.md`](docs/demo/m3-operations.md).

Quality gate (run before every commit to main): `pnpm check` (lint + typecheck + tests). E2E: `pnpm e2e` with the dev stack running.

Optional local tweak: copy `.npmrc.example` to `.npmrc` to keep pnpm's package store outside the OneDrive folder.

## Layout

| Path                    | What                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `apps/web`              | Next.js frontend (Danish first, English second)                                            |
| `apps/api`              | Fastify REST API `/api/v1`, OpenAPI at `/api/docs`                                         |
| `packages/domain`       | All business rules as pure, tested functions (hours, money, norm, flex, holidays, budgets) |
| `packages/db`           | Drizzle schema, SQL migrations incl. row-level security, seed                              |
| `packages/integrations` | Adapters to external systems (e-conomic; sandbox only, disabled by default)                |
| `packages/ui`           | Design-system components (ARCnordic visual identity)                                       |
| `e2e`                   | Playwright end-to-end tests                                                                |
| `docs`                  | Spec, decisions, open questions, progress, demo scripts, research                          |
