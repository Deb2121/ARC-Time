# Approval (Godkendelse)

Release: submit/approve/reject of time and absence, tenant approval modes, approver inbox with breakdown and anomalies,
bulk approve, reopen, close-on-behalf, substitutes, closing rules = **MVP**. Expense approval steps = **V2** (with expenses).
Email/Teams reminders and "request submission" notifications = **V2** (MVP: in-app notification only).

## 1. Purpose & roles
Turn submitted time, absence and expenses into approved, trustworthy data — fast for approvers, transparent for employees. [Brief]

| Role | Use |
|---|---|
| Employee | Submit period, reopen before approval, fix rejected entries, resubmit. [Brief + Observed] |
| Project Manager | Approve/reject entries on own projects (when PM step enabled). [Brief + Observed] |
| Line Manager | Approve/reject whole period of own reports; approve absence. [Brief] |
| Substitute | Approve on behalf of another approver (role right "approve on behalf"). [Observed] |
| Finance | No approval of time; final step for expenses; may reopen approved periods (audited). [Assumed] |
| Admin | Configure approval mode, period length, closing rules, anomaly thresholds. [Brief] |

## 2. Screens / views
- **Submit dialog** (from timesheet): period summary (total, norm, flex, billable %), optional comment for approver,
  closing-rule warnings (R7), confirm. [Observed: optional comment] 
- **Approver inbox** (Godkendelser) — two tabs [Observed: employee list and project list]:
  - *Medarbejdere*: one row per employee × period: status (not submitted / submitted / partially approved / approved /
    rejected — icon + text), total hours, norm, flex for period, billable %, anomaly flags, submitted at. Filters: legal entity,
    department, period (default: last full week; personal setting), status, "approving for" (own / on behalf of X) [Observed].
    Tick boxes for bulk approve; bulk reject requires one comment applied to all. [Brief]
  - *Projekter* (PM step): one row per project with hours awaiting approval, by employee. [Observed]
- **Employee period detail**: totals (work, absence per code, total, norm, flex period and balance), breakdown per project
  (hours, billable/non-billable split, budget remaining on that task), daily grid with entries and comments, anomalies
  highlighted, history/comments log. Actions: approve period, reject period (comment), approve/reject single entries,
  toggle billable per entry if allowed, reopen, next employee (auto-advance after approve). [Brief + Observed]
- **Absence requests** list for line managers: code, dates, hours/days, balance after, overlapping team absence. [Observed + Assumed]
- **Timesheet status overview** (manager/Finance): employees × weeks matrix with status; action "send reminder". [Observed]

## 3. Data
**TimesheetPeriod** [Brief]: `employeeId, periodStart, periodEnd, periodType (week|month), status (open|submitted|partially_approved|approved|rejected),
submittedAt, submittedBy (self or on-behalf), submitComment`.
**ApprovalStep** [Assumed]: `timesheetPeriodId, stepType (project_manager|line_manager), projectId?, approverId, status (pending|approved|rejected), decidedBy, decidedAt, onBehalfOf?, comment`.
**ApprovalEvent** (log) [Observed: comments & actions log]: `periodId, entryId?, action (submit|reopen|approve|reject|close_on_behalf|request_submission|reopen_by_approver|billable_change), actorId, onBehalfOf?, comment, at`.
**Tenant settings**: approvalMode (none | line_manager | pm_then_line_manager) [Observed]; periodType (week|month) [Brief];
closingRule (none | warn_below_norm | block_below_norm | warn_zero_week | block_zero_week) [Observed]; anomaly thresholds
(dayOverNorm default +3 h, dayUnderNorm default −3 h) [Assumed]; allowApproverBillableToggle [Observed];
absenceApproval = line manager [Brief].
**Employee**: lineManagerId (= approver) [Observed: approver on employee card].

## 4. User actions & state transitions
TimesheetPeriod (overview §4):
```
open ──submit──► submitted ──all steps approved──► approved
  ▲                │    └──some steps approved──► partially_approved ──rest approved──► approved
  │                │                                    │
  │◄──employee reopen (no step approved yet)            │
  │◄─────────── reject (any step) ──► rejected ◄────────┘
  │                                       │ employee edits → entries draft
  └───────────── resubmit ◄───────────────┘
approved ──reopen by approver/Finance (audited)──► open
```
Entry statuses follow the period: submit → entries `submitted`; final approval → `approved` (+ rate snapshot); reject →
affected entries `rejected` (period reject = all entries; entry reject = only those). [Brief]

Mode behaviour:
- **none**: submit → approved immediately (still snapshots rates, still logged). [Observed]
- **line_manager**: one step per period. [Observed + Brief]
- **pm_then_line_manager**: one PM step per project with entries in the period (entries on projects where the employee is
  the PM, or with no PM, skip to the line manager); the line manager step opens when all PM steps are decided; line manager
  can also approve early, which approves outstanding PM steps "on behalf" (logged). [Observed + Assumed]
- Absence entries are always approved by the line manager (step type line_manager), regardless of mode. [Brief]
- Approver = employee themselves (e.g. CEO without manager): approval goes to users with the "approve on behalf" right or
  Admin-designated fallback approver; self-approval is not allowed. [Assumed]

## 5. Business rules & calculations
**R1 Submit scope** [Brief] — Submitting covers all entries in the period in status draft; days in a closed accounting period
are skipped. Submitting an empty period is allowed unless blocked by R7. [Assumed]

**R2 Reject needs comment** [Brief + Observed] — Rejecting a period or an entry requires a non-empty comment (min 3 chars).
The comment is shown in the employee's timesheet banner and on the entries.

**R3 Partial approval** [Brief] — In pm_then_line_manager mode, a PM can approve the entries of project A and reject an entry
on project B; the period becomes partially_approved/rejected accordingly; after correction only the rejected entries return
to the step that rejected them. [Observed]

**R4 Inbox metrics** [Brief]
- total = Σ work + counting absence; norm per absence-flex.md R2; period flex = total − norm.
- billable % = billable hours ÷ work hours (absence excluded). Example: 30 billable of 36 work hours → **83 %**.
- per-project breakdown: hours, billable hours, task budget remaining (budget − approved − submitted).

**R5 Anomaly flags** [Brief + Assumed]
- Day over: day total > norm(d) + 3 h (e.g. 11 h on a 7,5 day) → "Mange timer".
- Day under: norm(d) > 0 and day total < norm(d) − 3 h (e.g. 4 h on a 7,5 day, no absence) → "Få timer".
- Missing day: norm(d) > 0 and 0 h registered → "Manglende dag".
- Weekend/holiday work, hours on a task over budget, flex balance beyond warning (absence-flex R6), entry comment missing
  where required (legacy data). Thresholds are tenant settings.

**R6 Rate snapshot** [Brief] — When an entry becomes approved (final step), resolvedRate and costRate are frozen via rates.md.
Re-approval after reopen re-snapshots only if the entry changed. [Assumed]

**R7 Closing rules** [Observed] — warn_below_norm: submit shows "Du har registreret 34 af 37 timer" and can continue;
block_below_norm: submit refused until total ≥ norm; zero-week variants analogous. Absence counts toward the total.

**R8 Reopen** — Employee may reopen while no step is approved [Observed]. Approver may reopen an approved period if no
entry in it is invoiced and the dates are in open accounting periods; entries return to submitted (not draft) so the employee
can't silently change approved hours — the approver rejects specific entries if a change is needed. [Assumed]

**R9 Close on behalf / request submission** [Observed] — Line manager can submit for an employee (logged as on-behalf) and
send a submission request (in-app in MVP; email/Teams V2).

**R10 Substitutes** [Observed] — A user with the right "approve on behalf" for approver X (all, or a date range, or a
department) sees X's queue under "approving for X"; decisions are logged with onBehalfOf = X. [Observed + Assumed scoping]

**R11 Bulk approve** [Brief] — Only periods in status submitted/partially_approved where the current user holds the open step;
rows with anomalies require an explicit "include flagged" confirmation. [Assumed]

**R12 Reminders (V2)** [Brief] — Daily job: employees with unsubmitted past periods (Monday 09:00 for the previous week,
configurable); approvers with items pending > N days. Channels: email, Teams (Graph). Users can't opt out of mandatory reminders; quiet hours respected. [Assumed]

## 6. Edge cases
- Employee changes manager mid-period: the approver is the line manager at time of submit; pending steps can be reassigned by Admin. [Assumed]
- PM leaves the project: pending PM steps move to the new PM. [Assumed]
- Entry moved to another project by Finance after PM approval: audit; no re-approval needed. [Assumed]
- Month periods with weeks spanning months: period type month uses calendar month boundaries; weekly flex still ISO-week based. [Assumed]
- Approver is on vacation and no substitute: escalate to the approver's manager after N days (V2). [Assumed]
- Absence request for future dates submitted ahead of its timesheet period: approved independently; the timesheet later shows it as approved. [Assumed]

## 7. Acceptance criteria
- **AC1** Given mode line_manager, When Anna submits week 46 and her manager approves, Then the period and all entries are approved and each entry has resolvedRate and costRate set. [Brief]
- **AC2** Given a submitted period, When the manager rejects without comment, Then it is refused; with comment "Mangler kommentar på 1042", Then entries are rejected and Anna sees the comment in her timesheet. [Brief]
- **AC3** Given mode pm_then_line_manager and entries on projects A (PM Bo) and B (PM Cecilie), When Bo approves A and Cecilie rejects one entry on B, Then the period is partially approved; after Anna fixes and resubmits, only the B entry returns to Cecilie. [Observed]
- **AC4** Given a submitted period with no approval yet, When Anna reopens it, Then entries return to draft; once any step is approved, reopen is not offered. [Observed]
- **AC5** Given closing rule block_below_norm and 34 of 37 h, When Anna submits, Then submit is refused with the shortfall shown. [Observed]
- **AC6** Given an approved period containing an invoiced entry, When the manager tries to reopen, Then it is refused. [Assumed]
- **AC7** Given a day with 11 h and norm 7,5, Then the inbox row shows the "Mange timer" flag. [Brief]
- **AC8** Given 10 submitted periods, 2 flagged, When the manager bulk-approves, Then 8 are approved and the 2 flagged need explicit confirmation. [Assumed]
- **AC9** Given Bo has "approve on behalf" for Dorte, When Bo approves Dorte's report, Then the log shows actor Bo on behalf of Dorte. [Observed]
- **AC10** Given FERIE requires approval, When an employee requests 3 days, Then it appears in the line manager's absence list (not the PM's) and the vacation balance shows the pending effect. [Brief]
- **AC11** An employee calling the approval API for their own period gets 403. [Assumed]
- **AC12** A PM cannot see entries of the same employee on projects the PM does not manage (API 403/filtered). [Brief]

## 8. Open points
1. Which approval mode does ARCnordic want: line manager only, or PM first then line manager?
2. Week or month periods?
3. Closing rule: warn or block when below norm?
4. Should approvers be able to edit hours directly (proposed: no — reject with comment instead)?
5. Anomaly thresholds (±3 h proposed) and whether weekend work should be flagged.
6. Who approves the CEO / people without a manager?
