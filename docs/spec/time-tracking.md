# Time tracking (Timeregistrering)

Release: week view, day view, favourites, copy last week, timer, validation, lifecycle, Finance correction = **MVP**.
Calendar import (Outlook / Microsoft Graph) = **V2**. PWA offline queue = **V3**.

## 1. Purpose & roles

Employees record the hours they work, per date and task, quickly and correctly, so that approval, flex, budgets,
invoicing and payroll all start from one trustworthy source. [Brief]

| Role                 | Use                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Employee (all users) | Register, edit and submit own time; use timer, favourites, copy last week. [Brief]               |
| Project Manager      | View entries on own projects; override billable flag on own projects (before invoicing). [Brief] |
| Line Manager         | View entries of own reports (read-only outside approval). [Brief]                                |
| Finance              | Correct approved (not invoiced, open period) entries with mandatory reason; full audit. [Brief]  |
| Management           | Read via reports only. [Assumed]                                                                 |
| Admin                | Configure settings (§5); no editing of other people's entries. [Assumed]                         |

## 2. Screens / views

### 2.1 Week view (primary) [Brief]

- Header: ISO week number and date range (e.g. "Uge 46 · 9.–15. nov. 2026"), previous/next week, "today", week picker. [Brief]
- Period status banner: open / submitted / partially approved / approved / rejected (with the rejection comment shown
  prominently) / locked (closed accounting period). [Observed: rejection comment shown in timesheet] [Assumed: banner]
- Grid:
  - Rows = one line per (project, task, billable variant). If the same task has both billable and non-billable hours in the
    week, two rows are shown, the non-billable marked with a "non-billable" badge. [Assumed]
  - Row label: project number + name, task path (truncated with full path in tooltip), customer name in muted text. [Assumed]
  - Columns = Mon…Sun (weekend columns visually subdued but editable), then row total. [Brief]
  - Cell = hours for that row and date (one TimeEntry per row/date; see R2). A small marker shows when a cell has a comment
    or an internal note; cell colour/icon shows status (draft, submitted, approved, rejected, invoiced, locked). [Assumed]
- Absence rows: absence codes registered in the same grid in a separate section below project rows (see absence-flex.md). [Assumed]
- Footer rows:
  - **Day total** (work + absence) per day and week total. [Brief]
  - **Norm** per day from the employee's norm pattern minus holidays; holiday name shown in the column header. [Brief]
  - **Difference** per day (total − norm), coloured neutral/positive/negative with sign, never by colour alone. [Assumed]
  - **Flex balance** "as of" the setting date (today / yesterday / last Sunday), see absence-flex.md R5. [Observed]
- Detail side panel for the focused cell: hours, comment, internal note, billable flag (if editable), status, history
  (who/when), rejection reason. [Assumed]
- Actions: Add row, Copy last week's rows, Submit week, (timer widget in top bar). [Brief]

### 2.2 Day view [Brief]

- List of the day's entries (project/task, hours, comment, billable, status), day total vs norm, quick-add form with
  project/task search, start/stop timer per line. Useful on narrow screens and for timer users. [Assumed]

### 2.3 Add-row search [Brief + Assumed]

- Type-ahead over projects/tasks the employee may register on: matches project number, project name, task name,
  customer name; results grouped by project; favourites and recently used first; closed/inactive excluded. [Assumed]
- Which tasks are offered follows the tenant's timesheet visibility setting: all allowed tasks / favourites only /
  tasks with hours / my allocations — plus always tasks already having hours in the period. [Observed]

### 2.4 Favourites [Brief]

- Star a project/task from the grid or search. Favourites are offered first in search and can be auto-added as rows
  each new week (personal setting, default on). [Assumed]
- If the tenant view setting is "favourites only" and the user has none, the grid shows an empty state explaining how to
  add favourites (avoids the confusing empty grid seen in the reference product). [Observed edge case → Assumed remedy]

### 2.5 Timer [Brief]

- Top-bar widget showing running task and elapsed time; start from any row, day view or search; stop; discard. [Assumed]

## 3. Data

**TimeEntry** [Brief]
`id, tenantId, employeeId, date, projectId, taskId, contractId (derived from task), hours numeric(6,2), billable bool,
comment text (customer-facing), internalNote text (never printed), extraField text|int (optional tenant-named field) [Observed],
status (draft|submitted|approved|rejected|invoiced), timesheetPeriodId, submittedAt, approvedBy, approvedAt,
rejectedBy, rejectedAt, rejectionComment, resolvedRate (øre, snapshot at final approval), costRate (øre, snapshot),
currency, invoiceLineId, source (manual|timer|copy|calendar|api|offline), externalRef (e.g. Graph event id),
createdAt/By, updatedAt/By, version (optimistic lock)`

**TimerSession** [Assumed]: `id, employeeId, projectId, taskId, startedAt, comment` — at most one per employee.

**Favourite** [Assumed]: `employeeId, projectId, taskId?, sortOrder`.

**Settings (tenant)**: displayFormat (decimal|hhmm) [Observed]; timesheetVisibility [Observed]; allowCopyLastWeek
[Observed]; requireCommentAll [Observed]; extraField config (name, required: no|always|perTask, type text|int, useOnInvoice)
[Observed]; maxFutureDays (default 0 = no future dates except absence) [Brief + Assumed default]; timerRounding (default
nearest 0.25, min 0.25) [Assumed]; maxHoursPerDay = 24 (fixed) [Brief].

**Project/task settings**: billable default (project → task override) [Brief]; requireComment (project-level) [Brief].

## 4. User actions & state transitions

Lifecycle (canonical, overview §4): [Brief]

```
draft ──submit period──► submitted ──final approval──► approved ──booked on invoice──► invoiced
  ▲                         │  │                          │ (non-billable: terminal)
  │◄── employee reopens ────┘  └──reject──► rejected ──edit──► draft
  │      (before any approval)
```
| Action                   | Who                                        | Allowed when                                                          | Effect                                                                                                                        |
| ------------------------ | ------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Create/edit/delete entry | Employee (own)                             | entry draft or rejected; period not closed; project active, task open | saves; editing rejected → draft [Brief]                                                                                       |
| Submit period            | Employee                                   | see approval.md closing rules                                         | all draft entries in period → submitted [Brief]                                                                               |
| Reopen submitted period  | Employee                                   | no entry in the period approved yet                                   | submitted → draft [Observed]                                                                                                  |
| Override billable        | PM (own project), Finance                  | status ≠ invoiced; period open                                        | flag changed, audited [Brief]                                                                                                 |
| Correct approved entry   | Finance                                    | approved (not invoiced); period open                                  | edit hours/task/billable/comment with reason; audit before/after; rate re-snapshot if task/billable changed [Brief + Assumed] |
| Mark invoiced            | System (invoice booking)                   | approved & billable                                                   | approved → invoiced, invoiceLineId set [Brief]                                                                                |
| Un-invoice               | System (credit note with "reopen entries") | invoiced                                                              | invoiced → approved, invoiceLineId cleared [Brief]                                                                            |
| Start/stop timer         | Employee                                   | —                                                                     | stop creates/increments a draft entry for today [Assumed]                                                                     |
| Copy last week           | Employee                                   | setting on                                                            | see R9                                                                                                                        |

Approved entries are read-only for the employee [Brief]. An invoiced entry cannot be edited by anyone; correction is via
credit note (see invoicing.md) [Assumed].

## 5. Business rules & calculations

**R1 Hour input & step** [Brief + D-005] — Accepts `1,5`, `1.5`, `1:30` (= 1,5). Stored as numeric(6,2). Must be a
multiple of 0.25 and > 0 (entering 0 or clearing a cell deletes the draft entry). `1:20` → refused with message
"Brug kvarter (0,25 t)" [Assumed]. Display: decimal "1,50" in da-DK, "1.50" in en; hh:mm if tenant chose it. [Observed setting]

- Example: Mette types `7:45` Monday → stored 7.75, shown "7,75".

**R2 One entry per cell** [Assumed] — Uniqueness on (employee, date, task, billable). Typing in a cell that already has a
value replaces it. Multiple entries per cell (e.g. via timer or API) are shown summed; the cell then opens the detail panel
listing them rather than allowing inline overwrite.

**R3 Max 24 h per day** [Brief] — Σ hours (work + absence) per employee per date ≤ 24. Example: 16 h on project + 8,25 h →
refused ("Maks. 24 timer pr. dag").

**R4 Closed project / task** [Brief] — Entries allowed only when project status = active and task status = open, the date
falls within project start/end if set [Assumed], and the employee is allowed (project member, or project open to all) [Assumed].
Existing entries on a later-closed task stay valid but cannot be edited except by Finance. [Assumed]

**R5 Future dates** [Brief] — Work entries dated after today + `maxFutureDays` are refused (default 0). Absence may be
future-dated (planned vacation). [Assumed]

**R6 Required comment** [Brief + Observed] — Comment required if tenant `requireCommentAll` or the project's
`requireComment` is on, or the extra field is mandatory for that task. Checked at save. Example: project "1042 Ny
skole Ballerup" requires comment; Jonas enters 3 h without comment → refused, focus stays in cell, panel opens on the
comment field.

**R7 Period lock** [Brief] — If the date falls in a closed accounting period of the employee's legal entity, all create/
edit/delete is refused for everyone, including Finance, unless the period is reopened (globally or for that employee
[Observed]). Message: "Perioden er lukket".

**R8 Billable default** [Brief] — billable = task.billable if set, else project.billable; non-billable contracts force
false. PM/Finance can override per entry until invoiced. Example: project billable, task "Intern koordinering"
non-billable → entry defaults non-billable.

**R9 Copy last week** [Brief + Observed] — Copies the _rows_ (project/task/billable combos) from the previous ISO week that
are still registrable; hours are not copied by default. Option "include hours" copies hours as draft entries only into
empty cells, skipping holidays and days with absence, and never copying comments' internal notes [Assumed]. Rows whose
task is closed are skipped with a notice listing them.

**R10 Timer** [Brief + Assumed] — One running timer per user (starting another stops the first). On stop, elapsed time is
rounded to the nearest 0.25 h, minimum 0.25 h (tenant setting: nearest / always up) and added to that day's draft entry
for the task; the user can edit before it is saved. Timers crossing midnight are split at local midnight (Europe/Copenhagen).
Timers running > 12 h prompt "Glemte du at stoppe?" and are not auto-saved. Example: 09:02–10:10 = 1 h 8 min → 1,00 h
(nearest); with "always up" → 1,25 h.

**R11 Totals & norm** [Brief] — Row total = Σ week cells; day total = Σ work + absence; norm per day from absence-flex.md R2;
difference = day total − norm. Example week: Mon 7,5, Tue 8, Wed 7,5, Thu 7,5, Fri 7 = 37,5 vs norm 37 → difference +0,5.

**R12 Rate snapshot** [Brief] — resolvedRate and costRate are set when the entry becomes approved (final approval step),
using rates.md resolution order; never recomputed except by a Finance correction. [Brief]

**R13 Concurrency** [Assumed] — Optimistic locking via version; on conflict the cell shows the server value and asks.

**R14 Audit** [Brief] — Any change to an entry in status submitted or later, and any billable override, writes an audit record
(user, time, before, after, reason). Draft edits by the owner are not audited field-by-field (event "created/deleted" only). [Assumed]

## 6. Keyboard & accessibility model (week view) [Brief: WCAG 2.1 AA, keyboard only]

Grid follows the WAI-ARIA **grid** pattern (`role="grid"`, one tab stop into the grid, roving tabindex). [Assumed]

| Key                       | Behaviour                                                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tab / Shift+Tab           | Move between page regions (toolbar → grid → footer actions). Inside the grid in _edit mode_, Tab moves to next/previous cell in the row, wrapping to next row's Monday. [Assumed] |
| Arrow keys                | Navigation mode: move focus one cell. In edit mode, ←/→ move the caret; ↑/↓ commit and move up/down.                                                                              |
| Enter                     | Navigation mode: start editing. Edit mode: commit and move down (same day, next row) — spreadsheet-like.                                                                          |
| F2                        | Edit without clearing. Typing a digit starts edit replacing the value.                                                                                                            |
| Esc                       | Cancel edit (restore previous value); second Esc leaves the grid.                                                                                                                 |
| Delete / Backspace        | Clear cell (deletes draft entry), with undo toast.                                                                                                                                |
| Ctrl+Z                    | Undo last cell change (session).                                                                                                                                                  |
| Alt+C (Ctrl+Option+C mac) | Open comment for focused cell.                                                                                                                                                    |
| Alt+N                     | Add row (opens search).                                                                                                                                                           |
| Alt+← / Alt+→             | Previous / next week.                                                                                                                                                             |
| Alt+T                     | Start/stop timer on focused row.                                                                                                                                                  |
| Alt+S                     | Submit week (opens confirmation dialog).                                                                                                                                          |
| ?                         | Shortcut help dialog.                                                                                                                                                             |

- Shortcuts avoid single-key bindings in edit mode and are documented and remappable later (WCAG 2.1.4). [Assumed]
- Each cell has an accessible name: "Mandag 9. november, 1042 Ny skole Ballerup, Projektering, 7,5 timer, kladde". [Assumed]
- Validation errors are announced via `aria-live="polite"` and linked to the cell with `aria-describedby`; focus stays. [Assumed]
- Status shown by icon + text, never colour alone; contrast ≥ 4.5:1; focus ring ≥ 3:1 and visible on all cells. [Assumed]
- Works at 200 % zoom and 320 px width (switches to day view below 640 px). [Assumed]

## 7. Calendar import (V2) [Brief]

- Microsoft Graph, delegated scope `Calendars.Read` only (read-only), user-initiated per week. [Brief]
- Shows the user's events for the week: subject, time, duration (rounded per R10), suggested project/task (by previous mapping
  of the same subject/organizer/category, or a project number in the subject, e.g. "1042") [Assumed]. User ticks events and
  confirms project/task; selected events become draft entries with source = calendar and externalRef = event id; re-import
  does not duplicate (matched on externalRef). Private events show only "Privat aftale" and are unticked. [Assumed]
- Nothing is written back to Outlook. [Brief]

## 8. Offline PWA (V3) [Brief]

- Installable PWA; entries made offline are queued locally (IndexedDB) with client-generated ids and synced in order;
  server re-validates; rejected items stay in an "Afventer rettelse" list. Only draft creation/edit offline; no submit. [Assumed]

## 9. Performance [Brief]

- Week view (grid + totals + norm + flex) for one user loads < 300 ms p95 server time; single cell save < 150 ms p95. [Brief + Assumed]
- Achieved by one composite endpoint per week and indexed (tenantId, employeeId, date). [Assumed]

## 10. Edge cases

- Employment starts/ends mid-week: dates outside employment are disabled; norm 0 there. [Assumed]
- Holiday with entries: allowed (counts as overtime/flex plus). [Assumed]
- Project moved to another contract after approval: snapshot rates stay; entry's contractId is not changed retroactively. [Assumed]
- Task deleted: only possible if no entries; otherwise close it. [Assumed]
- DST change days: hours are durations, unaffected; timer uses UTC internally. [Assumed]
- Week straddling two months or two accounting periods: each day checked separately against its period. [Assumed]
- Week submitted while some days are in a closed period: those entries are already locked; submit covers the rest. [Assumed]
- Employee changes legal entity mid-month: period lock follows the entity at the entry date. [Assumed]
- Billable override after rate snapshot: rate re-resolved for the new billable state (Finance/PM action audited). [Assumed]

## 11. Acceptance criteria

- **AC1** Given norm Mon–Thu 7,5 / Fri 7,0, When the employee enters 7,5 / 8 / 7,5 / 7,5 / 7 in week 46, Then week total shows 37,5, norm 37 and difference +0,5. [Brief]
- **AC2** Given a cell, When the user types `1:30` and presses Enter, Then 1,50 is saved and focus moves to the same day in the next row. [D-005]
- **AC3** Given an entry, When the user types `1,1`, Then the save is refused with a quarter-hour message and the value is not stored. [Brief]
- **AC4** Given 20 h already on Tuesday, When 4,25 h more is entered that day, Then it is refused (max 24 h). [Brief]
- **AC5** Given project status completed, When the employee tries to add a row for it, Then it is not offered in search and the API rejects a direct POST with 422. [Brief]
- **AC6** Given maxFutureDays = 0, When a work entry is saved for tomorrow, Then it is refused; an absence entry for tomorrow is accepted. [Brief + Assumed]
- **AC7** Given project requires comments, When an entry is saved without comment, Then it is refused and focus moves to the comment field. [Brief]
- **AC8** Given October 2026 is closed for the employee's legal entity, When anyone (including Finance) edits an entry dated 2026-10-15, Then the change is refused with "Perioden er lukket" and nothing is written. [Brief §9]
- **AC9** Given an approved entry, When the employee tries to edit it, Then the UI shows it read-only and the API returns 403. [Brief]
- **AC10** Given an approved, not invoiced entry in an open period, When Finance changes 8 h to 7,5 h with reason "Dobbeltregistrering", Then the change is saved and the audit log shows user, time, 8 → 7,5 and the reason. [Brief]
- **AC11** Given an invoiced entry, When anyone tries to edit it, Then it is refused and the user is pointed to credit notes. [Assumed]
- **AC12** Given a timer started 09:02 and stopped 10:10 with rounding "nearest", Then a draft of 1,00 h is created for that task today. [Assumed]
- **AC13** Given a running timer on task A, When the user starts a timer on task B, Then A is stopped and saved first. [Assumed]
- **AC14** Given last week had rows A, B (B's task now closed), When "Copy last week" is used, Then row A is added, B is skipped with a notice, and no hours are copied. [Brief + Assumed]
- **AC15** Given project billable and task non-billable, When an entry is created, Then billable = false; When the PM overrides to true, Then the change is audited. [Brief]
- **AC16** Using only the keyboard, a user can add a row, fill a full week, add a comment and submit (Playwright + axe check, no violations at AA). [Brief]
- **AC17** Given 52 weeks of history and 15 rows, the week endpoint responds < 300 ms p95 in the performance test. [Brief]
- **AC18 (V2)** Given 6 Outlook events, When the user imports and ticks 4, Then 4 draft entries are created; re-importing creates none of them again. [Brief + Assumed]

## 12. Open points

1. Timer rounding: nearest quarter (proposed) or always round up? Is minimum 0,25 h acceptable for billing?
2. Should future-dated work hours be allowed at all (e.g. for people who pre-register a known day off-site)? Default proposed: no.
3. Weekend columns: shown always (proposed) or hidden by personal setting?
4. Do we need the tenant-named extra field (e.g. units/km/drawing number) in MVP, or V2?
5. Display format for ARCnordic: decimal (1,50) or hh:mm (1:30)?
6. Should PMs be allowed to override billable on submitted (not yet approved) entries, or only after approval?
