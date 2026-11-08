# Progress

## Done

- 2026-11-08 · **Phase 1** — research (read-only, paraphrased), brand study, spec overview + 15 module specs, decisions, open questions.
- 2026-11-08 · **M0 Foundation**
  - Toolchain installed: Node 26 LTS, pnpm 10 (Docker Desktop, Python, Git already present).
  - Monorepo (pnpm workspaces), Biome lint/format, TypeScript strict, Vitest, Playwright.
  - `packages/domain`: hours (0,25 step, `1,5`/`1.5`/`1:30`), money in øre, ISO weeks, Danish holidays (Easter-based, no Store bededag from 2024), norm patterns (1/2-week cycles, valid-from, holidays full/half/hours, employment proration), flex, fixed-price completion. 18 tests incl. all three §9 calculation examples.
  - `packages/db`: Postgres 17 (Docker), Drizzle schema (tenants, legal entities, departments, users, roles, sessions, audit log), row-level security per tenant with a non-owner runtime role, append-only audit log, SECURITY DEFINER login lookups, fictional seed (ARCnordic Demo ApS, 12 people). 5 RLS tests.
  - `apps/api`: Fastify, sessions (hashed tokens), CSRF tokens, dev login (impossible in production), Entra ID OIDC with PKCE (disabled until configured), RBAC people endpoints, audited role changes, rate limiting, helmet, OpenAPI docs, health/readiness. 12 integration tests.
  - `apps/web`: Next.js 16, ARCnordic-inspired design tokens, Open Sans + Jost (self-hosted), DA/EN i18n, login, app shell with role-based navigation, home, people list; security headers + CSP. 5 E2E tests incl. keyboard-only login.
  - CI workflow (lint, typecheck, migration drift check, tests, build, E2E).

## Next — M1 MVP core loop

1. Employees: norm-pattern assignment UI, holiday calendars, absence codes (admin).
2. Customers and projects with WBS (≤ 5 levels), budgets, members.
3. Week timesheet (keyboard-first), day view, copy last week, favourites, timer.
4. Submit / approve / reject, flex and absence, budget vs actual, CSV export.

## Blockers / waiting on product owner

- GitHub: repo not yet pushed (see question to owner).
- MVP-shaping defaults in use until answered: OQ-13 approval flow, OQ-16 vacation, OQ-17 flex caps, OQ-15 company days.
