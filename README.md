# ARCnordic Tid

Time tracking, projects, budgets, resource planning, approvals, invoicing, expenses, absence/flex, payroll export and
reporting for ARCnordic. Built in-house as a clean-room implementation.

Status: **M0 Foundation done** â€” next: M1 (core loop: timesheet, approval, flex, budgets). See [`docs/progress.md`](docs/progress.md).

## Run locally

Requirements: Node.js â‰¥ 22, pnpm 10, Docker Desktop.

```powershell
pnpm install
pnpm db:up; pnpm db:migrate; pnpm db:seed
pnpm dev                 # web http://localhost:3000 Â· API http://localhost:4000 Â· API docs /api/docs
```
Demo users (fictional): `kh@demo.arcnordic.test` (admin), `jf@â€¦` (finance), `al@â€¦` (line manager), `lv@â€¦` (employee) â€” password `demo1234`.
Walkthrough: [`docs/demo/m0-foundation.md`](docs/demo/m0-foundation.md).

Quality gate (run before every commit to main): `pnpm check` (lint + typecheck + tests). E2E: `pnpm exec playwright test` with the dev stack running.

Optional local tweak: copy `.npmrc.example` to `.npmrc` to keep pnpm's package store outside the OneDrive folder.

## Layout

| Path              | What                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `apps/web`        | Next.js frontend (Danish first, English second)                                               |
| `apps/api`        | Fastify REST API `/api/v1`, OpenAPI at `/api/docs`                                            |
| `packages/domain` | All business rules as pure, tested functions (hours, money, norm, flex, holidays, completion) |
| `packages/db`     | Drizzle schema, SQL migrations incl. row-level security, seed                                 |
| `packages/ui`     | Design-system components (ARCnordic visual identity)                                          |
| `e2e`             | Playwright end-to-end tests                                                                   |
| `docs`            | Spec, decisions, open questions, progress, demo scripts, research                             |
