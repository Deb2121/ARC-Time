# Demo script — M3 Operations

Fictional data only. Password for all demo users: `demo1234`. Start the app with **Start-ARCnordic-Tid.cmd** (or the
VS Code task "Start ARCnordic Tid"). It starts the database, web (:3000), API (:4000) and the Python analytics
service (:8000). The first start installs the Python packages, which takes about a minute. For clean data, use the
"Nulstil demo-data" task first.

## 1. Home dashboard (≈3 min)

1. As **Jonas Friis** `jf@demo.arcnordic.test` (Finance), open **Forside**.
   - **Det venter på dig** lists timesheets and expenses to approve, invoices ready to book and October not yet
     closed. Each line links to where the task is done.
   - **Nøgletal for virksomheden** shows utilisation and billable share (last 4 complete weeks), invoiced revenue last
     month with the effective hourly rate, and a 12-week utilisation trend. The latest week is in brand red.
2. As **Anne Lund** `al@…` (line manager), the key figures are for her team only, without revenue.
3. As **Laura Vinther** `lv@…` (employee), there are only personal to-dos and no key figures.

## 2. Expenses and mileage (≈3 min) — as Laura

1. Open **Udlæg og kørsel** and register a taxi receipt. Attach a PDF or photo. VAT is split automatically. Make it
   billable on a project.
2. Register mileage (km × the year's rate, high rate up to 20.000 km), then **Indsend**.
3. As **Anne**: **Godkendelse → Udlæg og kørsel**. Open the receipt, then approve it, or reject it with a comment.
4. As **Jonas**: the billable expense appears in **Fakturering** as an "Udlæg" line on the project's next invoice.

## 3. Resource planning (≈2 min) — as Anne

1. Open **Ressourceplan**. The heatmap shows booked hours against capacity per person and week (norm time minus
   holidays and absence). The colour shows how full each week is, and overbooked weeks stand out.
2. Expand a person to see their bookings per project. Change hours in a cell.
3. Type `DGNB` or `Revit` in the competence filter to see who has that competence and when.

## 4. Approval modes (≈4 min)

1. As **Karen Holm** `kh@…` (Admin), go to **Indstillinger → Godkendelse** and choose _Projektleder godkender sine
   projekter først, derefter nærmeste leder_.
2. As **Emil Krogh** `ek@…`, submit this week in **Min uge**.
3. As **Peter Dahl** `pd@…` (project manager of 26002), open **Godkendelse → Mine projekter**.
   - Emil's hours on 26002 are listed per week. Expand them to see each entry.
   - Click **Afvis** with a comment. Only the 26002 hours go back to Emil, and the comment starts with "26002:".
4. As **Emil**, correct a 26002 cell and submit again. Only 26002 returns to Peter. Approvals already given on other
   projects remain.
5. As **Anne** (Emil's line manager), the inbox shows "Venter på projektleder: n". Anne can still approve the week.
   Steps still open are then recorded in the audit log as approved on behalf.
6. Set the mode back to _Nærmeste leder godkender ugen_. The mode _Ingen godkendelse_ approves a week automatically
   when it is submitted (still with rate snapshots and an audit row).

## 5. Outlook calendar (≈1 min) — as Laura

In **Min uge**, click **Fra min kalender**. Locally it explains that calendar import is not switched on.

With a **test** Entra tenant configured (`ENTRA_*` plus `GRAPH_CALENDAR_ENABLED=true`), signing in with Microsoft
lets ARCnordic Tid read (only read) the week's meetings. Tick meetings, choose a task and click **Registrér**. Each
meeting becomes draft hours rounded to 0,25 h, with the meeting subject as comment. All-day and "free" events are
not shown.

## 6. Reminders (no demo locally)

On Mondays from 09:00, people who have not submitted last week get an e-mail, and so do line managers with weeks
waiting. Nothing is sent unless `SMTP_HOST` is set. To see the e-mails, run Mailpit (`localhost:1025`, inbox at
`localhost:8025`). Each reminder is sent only once.

## 7. Key figures in Excel and Power BI (≈2 min) — as Jonas

1. **Rapporter → Nøgletal (Excel)** for a period. The workbook has the sheets _Projekter_ (hours, billable share,
   cost, invoiced, effective rate, contribution margin), _Medarbejdere_ and _Om_ (definitions).
2. Flat datasets for Power BI or Excel Power Query are at `http://localhost:8000/v1/datasets/time_entries?from=…&to=…`
   (also `projects`, `employees`, `invoices`). Open them in a signed-in browser. API tokens for scheduled refresh
   come later (spec R10).
3. Only Finance, Management and Admin get data. The service uses a read-only database role.

## Verified automatically

- Domain: KPI formulas with the spec's worked examples (also in Python), and calendar splitting/rounding.
- API: dashboard per role, reminders sent once, calendar import (fake calendar), the full project-manager flow
  incl. AC3, and mode _none_.
- Python: KPI parity, access control (401/403), Excel sheets, datasets, period validation.
- E2E: dashboard, expenses with receipt, resource planner, calendar panel, approval-mode switch and the
  project-manager tab. All tests clean up after themselves and can be repeated on the dev database.
