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

## Deferred from the MVP list (planned next)

- Day view of the timesheet (week view covers the flow; day view is a convenience) → early M2.
- Admin screens for norm patterns, holiday calendars and absence codes (data and API exist; editing via seed/SQL for now) → M2.
- Project manager approval step (mode exists in tenant settings, UI and per-entry approval not yet) → M3 with reminders.
- Create-project form in the UI (API exists) → M2.

## Next — M2 Money

Price lists and 5-step rate resolution, T&M invoice suggestions, invoice drafts/booking with gap-free numbering, PDF,
credit notes, fixed-price payment plans, accounting periods and locking, e-conomic adapter (sandbox).

## Waiting on product owner

- GitHub push: run `git push -u origin main` once in the terminal so Windows can store the GitHub login.
