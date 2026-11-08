# Absence, flex & vacation balances (Fravær, flex og feriesaldo)

Release: absence codes, absence registration, norm calculation, flex per week and balance, vacation balance (Danish rule),
balance accounts with manual adjustments = **MVP**. Flex caps/warnings, feriefridage, multi-day absence request dialog = **MVP**.
Overtime as a separate paid account (instead of flex) = **V2**. Automatic year-end transfer/payout handling = **V2**.

## 1. Purpose & roles
Give every employee a correct, explainable picture of expected hours (norm), flex balance and vacation balance, and give
line managers and payroll correct absence data. [Brief]

| Role | Use |
|---|---|
| Employee | Register absence (incl. future vacation), see own flex/vacation balances with drill-down. [Brief] |
| Line Manager | Approve absence where the code requires it; see team balances and absence calendar. [Brief + Observed] |
| Finance / payroll | Adjust, reset, move balances; year-end processing; export absence to payroll. [Observed] |
| Admin | Configure absence codes, norm patterns, holiday calendars, balance rules. [Brief] |

## 2. Screens / views
- **Absence section in the timesheet** (week/day view): rows per absence code; partial days in hours. [Assumed]
- **Register absence for a date range** dialog: code, from/to date, full/half day or hours per day; preview of the hours per
  day it will create (skipping weekends, holidays, non-working days of the norm pattern) and the balance after. [Observed: multi-day absence exists] [Assumed: preview]
- **My balances** card (employee dashboard): flex balance, vacation days left (by holiday year), feriefridage left,
  time-off-in-lieu; each clickable to a **posting list**. [Brief]
- **Flex drill-down**: per day: date, code (norm / project time / absence code), hours, sign (+/−), running balance, and
  period totals; shows "beregnet til og med <dato>". [Observed: postings popup with factor/positive/negative] 
- **Balance administration** (Finance/Admin): choose balance account + period (+ department, employee filter); table of
  employees with opening, deposits, withdrawals, closing; actions adjust / reset / move; bulk adjust; saved filters. [Observed]
- **Absence calendar** (team/department, month view): who is absent when, by code type; respects privacy — sickness shown as
  "Fravær" to non-managers. [Observed: absence & vacation calendars] [Assumed: privacy masking]

## 3. Data
**NormPattern** [Brief + Observed]: `id, name, cycleWeeks (1|2), days[cycle×7] hours numeric(4,2)`. Default "Fuld tid 37":
Mon–Thu 7.5, Fri 7.0, Sat–Sun 0. [Brief]
**EmployeeNorm** [Observed]: `employeeId, normPatternId, validFrom, cycleAnchorDate (for 2-week cycles), employmentFraction (derived)`. History kept; back- and forward-dated changes allowed. [Observed]
**HolidayCalendar / Holiday** [Observed]: defined canonically in organisation.md (built-in Danish list, optional company days); summary here for flex purposes. `calendarId, date, name, kind (full|half|hours), hours?`. One calendar per employee.
Danish calendar built in and generated per year (nytårsdag, skærtorsdag, langfredag, 2. påskedag, Kristi himmelfartsdag,
pinsedag (søndag), 2. pinsedag, juledag, 2. juledag; grundlovsdag 5 Jun and juleaftensdag 24 Dec as optional "half/full"
company days; store bededag not a holiday from 2024). [Brief + Assumed per Danish law]
**AbsenceCode** [Observed + Brief]: `code, name_da, name_en, type (vacation|sickness|child_sick|time_off_in_lieu|unpaid|paid_leave|other),
format (hours|full_day|half_or_full_day), countsTowardNorm bool, affectsFlex (derived, see R4), balanceAccountId?,
balanceEffect (withdraw|deposit|none), requiresApproval bool, deductsCapacity bool, showInCalendar bool,
showAsPrivate bool, salaryCode?, includeInPayrollExport bool, active bool`.
Default codes [Assumed]:

| Code | Counts toward norm | Balance | Approval | Payroll |
|---|---|---|---|---|
| FERIE Ferie | yes | Ferie (withdraw) | yes | yes |
| FFRI Feriefridag | yes | Feriefridage (withdraw) | yes | yes |
| SYG Sygdom | yes | — | no | yes |
| BSD Barns første sygedag | yes | — | no | yes |
| AFSP Afspadsering | yes | Flex (withdraw, see R7) | yes | no |
| ORLOV Barsel/orlov | yes | — | yes | yes |
| ULON Tjenestefri uden løn | yes (reduces pay, not flex) | — | yes | yes |
| KURSUS Kursus (internal) | yes | — | no | no |

**AbsenceEntry**: same lifecycle as TimeEntry (overview §4): `employeeId, date, code, hours, status, comment, approvedBy/At`. [Brief]
**BalanceAccount** [Observed]: `id, kind (flex|vacation|extra_days|toil|custom), unit (hours|days), yearRule`.
**BalancePosting** [Observed]: `accountId, employeeId, date, amount (+/−), source (opening|accrual|registration|norm|adjustment|reset|move|expiry|payout), automatic bool, reason, createdBy`. Automatic postings are immutable; corrected only by counter-postings. [Observed]

## 4. User actions & state transitions
- Register absence → `draft`; on submit of the period (or immediately for future vacation request, see R10) → `submitted`;
  codes with `requiresApproval` go to the line manager; codes without go through with the timesheet approval mode. [Brief + Observed]
- Change/delete of an approved absence by the employee creates a change request back to `submitted` that the manager
  must approve; until then the approved version stays in force. [Observed: changes/deletions surface to manager] [Assumed: mechanism]
- Finance: adjust (± amount with reason), reset (set balance to X at date, posts the difference), move (from account A to B,
  e.g. flex → afspadsering or vacation transfer). All audited. [Observed]
- Admin: change an employee's norm pattern from a date; flex for already approved weeks after that date is recalculated
  and the delta is shown in the posting list as "normændring". [Observed: valid-from with back-dating] [Assumed: recalculation visible]

## 5. Business rules & calculations

**R1 Norm per day** [Brief] — norm(d) = pattern hours for that weekday (and cycle week) × 1, set to 0 outside employment,
and reduced by holiday: full → 0; half → pattern/2; hours → pattern − holiday.hours (min 0). [Observed holiday kinds]

**R2 Norm per week** [Brief] — Σ norm(d) over the ISO week (Mon–Sun).
- Example A (no holiday): 7,5+7,5+7,5+7,5+7,0 = **37,0 h**.
- Example B (holiday Wednesday, e.g. 2. juledag on a Wednesday): 7,5+7,5+0+7,5+7,0 = **29,5 h**. [Brief §9]
- Example C (Grundlovsdag set as half day on a Friday): Fri 7,0/2 = 3,5 → week 33,5 h.

**R3 Registered hours** — registered(d) = Σ work entries + Σ absence entries whose code `countsTowardNorm`. Entries count
for flex in any status except rejected (flex is "provisional" until approved; the UI marks unapproved days). [Assumed]

**R4 Flex per week** [Brief] — flex(w) = registered(w) − norm(w).
- Example D: registered 37,5 vs norm 37 → **+0,5**. [Brief §9]
- Example E: Wednesday holiday week, worked 30 h → 30 − 29,5 = **+0,5**.
- Example F: Mon sick 7,5 (SYG counts), Tue–Fri work 29 h → 36,5 − 37 = **−0,5**.
- Example G: ULON 7,5 on Monday: counts toward norm (so no flex loss), and is exported to payroll as unpaid. [Assumed]

**R5 Flex balance** [Brief] — balance(t) = openingBalance + Σ flex(d) for d from flex start date up to the "computed to"
date. Setting: today / yesterday / last Sunday (default last Sunday, so a half-registered current week does not show a
false negative) [Observed]. Days after "computed to" are excluded entirely (both registration and norm).
- Example H: opening +4,0; weeks 44–46 flex +0,5, −1,0, +0,5 → balance **+4,0**.

**R6 Flex caps & warnings** [Brief] — Tenant settings: upper cap (e.g. +40 h), lower cap (e.g. −20 h), warning thresholds.
Exceeding a warning shows a notice to employee and manager; exceeding a cap shows a stronger warning in the approval inbox.
Caps never truncate the balance automatically (overflow handling is a payroll/HR decision — open point). [Assumed]

**R7 Time off in lieu (afspadsering)** [Brief] — AFSP counts toward norm (flex-neutral for the day) and withdraws the same
hours from the flex balance account. Net effect on flex balance = −hours.
- Example I: balance +10; Friday AFSP 7,0 h, no work → day flex 0 via R4, plus withdrawal 7,0 → balance **+3,0**.
  (Implementation: AFSP is the one code with `countsTowardNorm = true` and `balanceEffect = withdraw` on the flex account.)

**R8 Vacation (Danish samtidighedsferie, configurable rule)** [Brief + Assumed per ferieloven]
- Holiday year (ferieår) 1 Sep – 31 Aug. Accrual 2,08 days per full month of employment, posted automatically on the
  first day of the following month (configurable: accrual per month, or full 25 days granted up front). [Brief]
- Usage period (ferieafholdelsesperiode): 1 Sep of the year earned through 31 Dec of the following calendar year (16 months).
- Balance per holiday year bucket; usage draws from the oldest open bucket first (FIFO). [Assumed]
- Advance vacation (forskudsferie) allowed down to a configurable negative limit (default 0). [Assumed]
- Unused days after 31 Dec: tenant setting — transfer up to N days (default 5, requires recorded agreement) or flag for
  payout/feriefond; balance is not silently deleted. [Assumed]
- Mid-month start: accrual pro rata by calendar days (configurable: "only full months"). [Assumed]
- Example J: employee starts 1 Mar 2026. Accrued by 1 Sep 2026: Mar–Aug = 6 × 2,08 = **12,48 days** in bucket 2025/26,
  usable until 31 Dec 2026.

**R9 Part-time conversion** [Brief] — Vacation is kept in days; a vacation *day* on a given date withdraws 1 day and
registers hours = norm(d) for that date. Hour-based tenants can choose unit = hours: accrual per month = 2,08 × average daily norm.
- Example K: 30 h/week over 5 days → 6 h/day; accrual 2,08 × 6 = **12,48 h/month**; one vacation day on Friday with a
  pattern Fri = 4 h withdraws 1 day / 4 h.

**R10 Absence format** [Observed] — full_day: hours = norm(d) and only on days with norm > 0; half_or_full_day: norm(d) or
norm(d)/2; hours: free, step 0,25. Absence on a holiday or weekend with norm 0 is refused for day-based codes. [Assumed]
Example: FERIE 22–26 Dec 2025 with 25 & 26 Dec holidays → only 22, 23, 24 (if 24 not a company day off) are drawn: 3 days.

**R11 Feriefridage** [Brief: optional] — Optional account, default 5 days per calendar year granted 1 Jan (configurable year
and amount), no carry-over by default. [Assumed]

**R12 Employment start/end** [Brief] — norm = 0 before start and after end date; flex and accrual only within employment;
on leaving, the system shows final flex and vacation balances for payroll settlement. [Assumed]

**R13 Explainability** [Assumed] — Every balance figure can be drilled down to postings that sum to it exactly.

## 6. Edge cases
- Norm pattern change mid-week: per-day lookup handles it (norm(d) uses pattern valid on d). [Assumed]
- 2-week cycle: cycle week determined from cycleAnchorDate (ISO week parity relative to anchor). [Observed: 2-week schedules] [Assumed: anchor]
- Holiday calendar not maintained for next year: system auto-generates Danish holidays; custom calendars warn admins in Nov. [Observed: "update around new year"]
- Absence approved, then employee works that day anyway: both count; flex goes up; manager notified of change request. [Assumed]
- Sickness during vacation (ferie → syg): employee changes code; manager approves; vacation day re-credited. [Assumed]
- Negative flex at employment end: flagged for payroll; no automatic deduction. [Assumed]
- Back-dated opening balance change: recalculates all balances from the flex start date; audited. [Assumed]
- Leap years / 53-week ISO years: weeks computed by ISO calendar, no special casing in flex. [Assumed]

## 7. Acceptance criteria
- **AC1** Given norm "Fuld tid 37" and no holidays in week 46/2026, When 37,5 h are registered, Then week flex = +0,5. [Brief §9]
- **AC2** Given a public holiday on a Wednesday, When the norm for that week is calculated, Then it equals 29,5 h. [Brief §9]
- **AC3** Given opening balance +4,0 and weekly flex +0,5, −1,0, +0,5, Then the flex balance = +4,0 and the drill-down postings sum to it. [Brief]
- **AC4** Given setting "computed to last Sunday", When the employee views the balance on Wednesday with only Mon–Tue registered, Then the current week is excluded. [Observed]
- **AC5** Given flex balance +10, When AFSP 7,0 h is approved for a day with no work, Then the balance is +3,0. [Brief]
- **AC6** Given code SYG counts toward norm, When Monday is SYG 7,5 and Tue–Fri work total 29, Then week flex = −0,5. [Brief]
- **AC7** Given employment start 2026-03-01 and monthly accrual, Then on 2026-09-01 the 2025/26 vacation bucket = 12,48 days. [Brief]
- **AC8** Given a 30 h/5-day employee in hour mode, Then monthly accrual = 12,48 h. [Brief]
- **AC9** Given FERIE is day-based, When the user requests 22–26 Dec with 25/26 Dec holidays, Then only the working days are created and the balance preview shows the right count. [Observed + Assumed]
- **AC10** Given an automatic accrual posting, When Finance tries to delete it, Then it is refused; a counter-posting adjustment with reason is allowed and audited. [Observed]
- **AC11** Given a flex upper warning of +30 h, When a week's approval would bring the balance to +32, Then the approver sees a warning flag. [Brief]
- **AC12** Given an employee ending 2026-11-11 (Wednesday), Then norm for Thu–Fri that week is 0 and flex is computed only to the 11th. [Brief]
- **AC13** Given a norm change from 37 to 30 h effective a past date, When saved, Then flex is recalculated from that date and the posting list shows the delta. [Observed + Assumed]

## 8. Open points
1. Does ARCnordic grant vacation monthly (2,08/month) or upfront? Hours or days as unit?
2. Are 5 feriefridage granted, and on which year (calendar year or 1 May–30 Apr)?
3. Are 24 Dec, 31 Dec and Grundlovsdag company days off (full/half)?
4. Flex caps: what limits, and what happens to hours above the cap (lost, paid as overtime, warning only)?
5. Is overtime paid (separate account with factors 50 %/100 %) or does everything go to flex?
6. Flex start/opening balances at go-live: imported from the current system per employee?
7. Should flex count unapproved hours provisionally (proposed) or only approved hours?
8. Sickness visibility: should colleagues see "Syg" or a neutral "Fravær" in the team calendar (proposed: neutral)?
