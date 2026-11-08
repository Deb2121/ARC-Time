# Demo script — M1 core loop

Fictional data only ("ARCnordic Demo ApS"): 12 people, 6 customers, 10 projects (fixed price, T&M, T&M with cap,
retainer, hybrid fixed + T&M, internal), ~13 weeks of time entries. Password for all demo users: `demo1234`.

## Start (clean data)

```powershell
pnpm db:reset; pnpm db:migrate; pnpm db:seed
pnpm dev     # http://localhost:3000
```

## Walkthrough (≈10 min)

1. **Laura Vinther** `lv@demo.arcnordic.test` (architect)
   - **Forside**: this week as bars per day, flex balance (up to last Sunday), vacation left with earned/used/planned for the holiday year.
   - **Min uge**: rows sorted by project/task, norm per day, totals, difference per day, flex this week, flex balance.
   - Click a cell, type `1,5` (or `1.5` / `1:30`), press **Tab** → saved. Try `1,1` → "Brug kvarter". **Esc** reverts.
   - ↑/↓ moves between rows; **Enter** saves and moves down — the whole grid works without a mouse.
   - Search "behov" in **Tilføj opgave** → ↓ → Enter adds the row. ☆ marks a favourite (listed first next time).
   - **Tilføj fravær** → Ferie; future vacation is allowed, future work is refused.
   - Project 26002 is marked ✎ = comment required: entering hours opens the comment panel first.
   - Select a cell → **Start timer**; later **Stop og registrér** adds the time (rounded to nearest quarter) to today.
   - **Indsend uge** → if under norm, a confirmation shows the shortfall (warn, not block — D-013). The week locks; **Træk tilbage** is possible until approved.
2. **Anne Lund** `al@…` (line manager)
   - **Godkendelse** (defaults to last week): per person norm, registered, billable %, flex this week, anomaly flags (days > ±2 h from norm), split per project.
   - **Se uge** opens Laura's week read-only. **Afvis** requires a reason (shown to Laura). **Godkend** or bulk-approve selected.
   - Approval stores the rate snapshot on each entry (contract rate, else the employee's default rate) and is audited.
3. **Projekter** (Anne): budget hours, used %, value, margin %, health. Open **26001 Lyngparken**: WBS with sub-levels,
   budget vs actual per task (bar turns amber at 90 %, deep orange over 100 %), fixed-price completion and recognised revenue,
   members. **+ Underopgave** adds tasks — a 6th level is refused (WBS max 5).
4. **Rapporter**: budget vs actual for all visible projects with totals and **Hent CSV** (Danish Excel: `;` and decimal comma);
   time entries for any date range as CSV.
5. **Peter Dahl** `pd@…` (project manager, not Laura's line manager) cannot open Laura's timesheet — enforced by the API.

## Verified automatically

| Check                                                                           | Where                                                       |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| §9 flex +0,5; Wednesday holiday 29,5 h; fixed price 49 % / 117.600 kr           | `packages/domain` tests                                     |
| §9 editing in a closed/locked period is refused                                 | `packages/domain/src/m1.test.ts`, `apps/api/src/m1.test.ts` |
| §9 employee cannot read another employee's entries unless manager/finance       | `apps/api/src/m1.test.ts`                                   |
| Validation: 24 h/day, 0,25 step, future work, non-member task, required comment | domain + API tests                                          |
| Register → submit → approve (rate snapshot) → reopen                            | API test + `e2e/m1-core-loop.spec.ts`                       |
| WBS max 5 levels, CSV format                                                    | API tests                                                   |
