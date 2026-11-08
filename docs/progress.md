# Progress

## Done

- 2026-11-08 · **Phase 1** — research (read-only, paraphrased), brand study, spec overview + 15 module specs, decisions, open questions.
- 2026-11-08 · **M0 Foundation** — monorepo, Postgres with row-level security, audit log, sessions/CSRF, dev login + Entra ID OIDC, RBAC, ARCnordic design system, DA/EN, CI. See `docs/demo/m0-foundation.md`.
- 2026-11-08 · **M1 MVP core loop** — see `docs/demo/m1-core-loop.md`
  - Business-rule defaults recorded as D-013 (owner delegated).
  - Domain: entry validation, week summary, anomalies, vacation accrual (samtidighedsferie), budget vs actual + health, default absence codes, company days.
  - Data: norm patterns + assignments, holiday calendars, absence codes, customers/contacts, projects/contracts/tasks (WBS ≤ 5), members, time entries (one per cell, task XOR absence), timesheet periods + events, favourites; RLS on every table. Seed: 6 customers, 10 projects, ~2.400 entries.
  - API: week view, cell upsert with shared validation, submit/reopen, task search, favourites, previous-week rows; approval inbox, approve (rate snapshot), reject (comment required), bulk approve, approver reopen (audited); projects (scoped), detail with rolled-up budget vs actual and fixed-price completion, create project/task, edit task; customers; flex/vacation balances; budget-vs-actual and time-entry reports with Danish CSV.
  - Web: keyboard-first week grid, task combobox with favourites, absence rows, copy last week, comment panel, timer, submit with below-norm warning; approval inbox; projects list + detail with WBS; customers; reports; home with week bars and balances.
  - Tests: 35 domain, 5 RLS, 28 API integration, 7 E2E — all green.
  - Bug found by E2E and fixed: CORS allowed only GET/POST, so saving cells from the browser failed; regression test added.

- 2026-11-08 · **M2 Money** — see `docs/demo/m2-money.md`
  - Domain: 5-step rate resolution with specificity and valid-from; invoice suggestion builder (4 groupings); exact write-down spreading; VAT totals per rate; due dates; period locking; fixed-price recognition delta; retainer deferral.
  - Data: price groups, task types, price lists + rates, project employee rates, payment plans, invoices/lines/line sources, gap-free number series, accounting periods, revenue recognitions, integration connections, outbox; DB triggers make booked invoices immutable.
  - Services (shared by API and seed): rate snapshot at approval, draft from suggestion (with reservation and T&M caps), line edit/write-down, free lines, booking (locked counter), credit notes (optionally re-open sources), month-end report, close/reopen in order with checklist.
  - API: invoicing basis, drafts (single/bulk), invoice editing, ready/book/credit, HTML + PDF (headless Chromium), periods + report, price lists, payment plans; closed months lock timesheet edits and approvals.
  - Integrations: adapter interface, e-conomic adapter (sandbox, disabled by default), transactional outbox worker.
  - Web: Fakturering (basis, drafts, booked), invoice editor, Regnskabsperioder with month-end report, Prislister, payment plan on projects.
  - Seed: price lists incl. a framework list, payment plans, 13 booked invoices and two closed months.
  - Tests: 51 domain, 5 RLS, 38 API, 4 integration, 8 E2E (incl. the brief's full flow) — all green, repeatable runs.
  - Bugs found by tests and fixed: wrapped Postgres errors not mapped (409), reopen of hours held by a draft invoice, deleting credited-back entries (now kept with 0 h), invoiced-to-date missing pre-go-live milestones, E2E races (parallel specs, delayed dialogs).
  - Quality gate: pre-commit hook runs lint + typecheck.

- 2026-11-08 · **Settings & conveniences** — admin screens for norm time, holiday calendars and absence codes; employee editing; create-project form; timesheet day view. GRASP refactor with JSDoc gate (`docs/architecture.md`).

- 2026-11-08 · **M3 Operations** — see `docs/demo/m3-operations.md`
  - Done: expenses and mileage (receipts, VAT split, approval, re-invoicing); resource planner (capacity heatmap, allocations, competence filter); role-based home dashboard (to-dos per role, team/company utilisation and billable share with a 12-week trend, invoiced revenue and effective rate for Finance/Management); weekly e-mail reminders (Monday 09:00, only when SMTP is configured, never sent twice); Outlook calendar import in "Min uge" (read-only, off by default, picked meetings become draft hours rounded to 0,25 h — D-020).
  - KPI formulas live in `packages/domain/src/kpi.ts` with the worked examples from `docs/spec/reporting.md`.
  - Python analytics service `apps/analytics` (D-021): KPI JSON, Excel workbook (Rapporter → "Nøgletal (Excel)"), Power BI datasets; read-only DB role; KPI formulas tested with the same examples as TypeScript; docs gate also checks Python docstrings.
  - Approval modes (D-022): project manager step before the line manager (tab "Mine projekter"), or no approval; chosen under Indstillinger → Godkendelse.
  - Test hygiene: the full-flow E2E now waits for the month to really close (it could pass without closing), and the M2 close test reopens a month it closed.

- 2026-11-08 · **M4 Payroll export** (D-023) — Løn page for Finance: monthly preview per employee and salary code with warnings, CSV file, lock; late changes become corrections next month; salary codes and absence mapping; payroll numbers on employees. Tested against spec AC1–AC4 and AC7 inside a rolled-back transaction.

## Next — M4 (prioritised with the product owner, 2026-11-08)

1. ~~Payroll export~~ (done as generic CSV; provider adapters later).
2. Data import (customers, projects, employees from CSV/Excel, with a dry-run preview).
3. Later, if needed: multi-entity and multi-currency, PWA, project templates, Gantt, CRM pipeline, API tokens.

## Waiting on product owner

- GitHub push: run `git push -u origin main` once in the terminal so Windows can store the GitHub login.
