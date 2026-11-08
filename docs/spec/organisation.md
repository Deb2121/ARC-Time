# Organisation & people (Organisation og medarbejdere)

Release: tenants, one legal entity, departments, employees, norm patterns, Danish holiday calendar, roles — **MVP**.
Cost-rate history, competencies — **MVP** (data) / used by planner in **V2**. Multiple legal entities with cross-entity staffing — **V3**.

## 1. Purpose & roles

Holds the company structure and everything the other modules need to know about a person: who they report to, how many
hours they are expected to work, which days are holidays, what they cost and what they are allowed to do. [Brief]

| Role         | Uses this module to                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| Admin        | Create tenants' structure, legal entities, departments, employees, norm patterns, holiday calendars, role assignment |
| Line Manager | View their reports' cards; change norm pattern/manager if granted the right [Observed: manager with card access]     |
| Finance      | Maintain cost rates and default sales rates                                                                          |
| Employee     | View own card (norm, holidays, competencies), edit own competencies [Assumed]                                        |
| Management   | Read structure                                                                                                       |

## 2. Screens / views

- **S1 Organisation tree** — legal entities → departments (unlimited depth, ≥ 2 levels required by brief) with headcount and
  department manager per node; drag to move a department (Admin). [Brief + Assumed]
- **S2 Employee list** — searchable/filterable by department, manager, role, status (active / future start / ended),
  competency. Columns: initials, name, department, manager, weekly norm, roles. [Assumed]
- **S3 Employee card** — tabs:
  - _Basics_: name, initials (unique per tenant), email (login identity), employee number (payroll), legal entity,
    department, line manager, approver override, employment start/end. [Brief + Observed approver on card]
  - _Work time_: current norm pattern + history list (pattern, valid from, changed by, changed at). Action "Change norm
    pattern" with valid-from date (past or future allowed). [Observed]
  - _Holiday calendar_: assigned calendar (one per employee). [Observed]
  - _Rates_: default hourly sales rate and cost rate, each with valid-from history. [Brief + Assumed history]
  - _Roles & rights_: assigned roles, "approve on behalf of" right. [Brief + Observed]
  - _Competencies_: list of competency + level (1–5). [Brief + Assumed level]
  - _Change log_: audit entries for this employee. [Brief]
- **S4 Norm patterns (admin)** — list of named patterns, 1- or 2-week cycles, hours per weekday, weekly total, number of
  employees using it. [Observed]
- **S5 Holiday calendars (admin)** — calendars per year with entries (name, date, duration type, hours); actions: create,
  copy, generate Danish holidays for year N, add special day, delete. [Observed + Brief built-in DK]

## 3. Data

```
Tenant(id, name, locale='da-DK', timeZone='Europe/Copenhagen', settings jsonb)
LegalEntity(id, tenantId, name, cvr, address, currency='DKK', invoiceSeriesId, active)
Department(id, tenantId, legalEntityId, parentId?, name, code, managerEmployeeId?)
Employee(id, tenantId, legalEntityId, departmentId, managerId?, approverId?, initials, firstName, lastName, email,
         employeeNo?, employmentStart, employmentEnd?, holidayCalendarId, status: active|ended, userId?)
NormPattern(id, tenantId, name, cycleWeeks: 1|2, days: numeric(4,2)[7*cycleWeeks]  -- Mon..Sun per week)
EmployeeNormAssignment(id, employeeId, normPatternId, validFrom, cycleAnchorDate, createdBy, createdAt)
HolidayCalendar(id, tenantId, name, country='DK')
HolidayEntry(id, calendarId, date, name, kind: full|half|hours, hours?)
EmployeeRate(id, employeeId, kind: sale|cost, amountMinor, currency, validFrom)
CostPriceGroup(id, tenantId, name, amountMinor, validFrom)   -- optional; employee cost may reference a group
Competency(id, tenantId, name, category);  EmployeeCompetency(employeeId, competencyId, level 1..5)
Role enum: employee | project_manager | line_manager | finance | management | admin
UserRole(userId, role, legalEntityId?)  -- legalEntityId scoping V3
```

## 4. User actions & state transitions

- **Employee status**: `future` (start > today) → `active` → `ended` (end date passed). Derived from dates, not set by hand. [Assumed]
- **Create employee** (Admin): requires name, unique initials, unique email, department, start date, norm pattern,
  holiday calendar. Default norm pattern = tenant default ("Fuld tid 37 t"). [Assumed]
- **Change norm pattern**: insert a new `EmployeeNormAssignment` row; never update old rows. Backdated change triggers
  recalculation of flex for affected weeks and a warning listing already-approved weeks it affects. [Observed + Assumed]
- **Change manager**: effective immediately; pending approvals move to the new manager. [Assumed]
- **End employment**: set end date; after it, no time can be registered; user login disabled the day after; data retained. [Assumed]

## 5. Business rules & calculations

- **R1 Default norm pattern** [Brief]: Mon–Thu 7.50 h, Fri 7.00 h, Sat–Sun 0 → 37.00 h/week.
- **R2 Norm hours for a date** [Brief + Assumed]:
  `norm(d) = 0` if d outside employment; else `patternHours(d) − holidayReduction(d)`, floored at 0.
  - `patternHours(d)`: from the assignment with the latest `validFrom ≤ d`; for 2-week cycles the week index is
    `floor((isoWeekStart(d) − isoWeekStart(cycleAnchorDate)) / 7) mod 2`. [Observed 2-week + Assumed anchor]
  - `holidayReduction(d)`: full → patternHours(d); half → patternHours(d)/2; hours → min(hours, patternHours(d))
    where `hours` is the number of hours _off_. [Observed full/half/hours; Assumed "hours off" semantics]
- **R3 Weekly norm** = Σ norm(d) for Mon–Sun of the ISO week.
  _Example (Brief §9)_: Week 18 2026 with a holiday on Wednesday → 7.5 + 7.5 + 0 + 7.5 + 7.0 = **29.5 h**.
- **R4 Employment proration** [Assumed]: Anna starts Wednesday 4 Nov 2026 on the default pattern → week 45 norm =
  Wed 7.5 + Thu 7.5 + Fri 7.0 = **22.0 h**. Ending Tuesday → Mon 7.5 + Tue 7.5 = 15.0 h.
- **R5 Pattern change mid-week** [Assumed]: Bo moves from 37 h to a 30 h pattern (Mon–Thu 7.5, Fri 0) valid from Thursday
  → Mon–Wed 22.5 (old) + Thu 7.5 (new) + Fri 0 (new) = **30.0 h** that week.
- **R6 Danish public holidays** [Brief + Assumed algorithm]: generated per year from Easter Sunday (Gregorian
  computus, "anonymous" algorithm):
  | Holiday                                                                                                                  | Date              | Default kind              |
  | ------------------------------------------------------------------------------------------------------------------------ | ----------------- | ------------------------- |
  | Nytårsdag                                                                                                                | 1 Jan             | full                      |
  | Skærtorsdag                                                                                                              | Easter − 3        | full                      |
  | Langfredag                                                                                                               | Easter − 2        | full                      |
  | Påskedag                                                                                                                 | Easter (Sun)      | full (no effect, weekend) |
  | 2. påskedag                                                                                                              | Easter + 1        | full                      |
  | Kristi himmelfartsdag                                                                                                    | Easter + 39       | full                      |
  | Pinsedag                                                                                                                 | Easter + 49 (Sun) | full (no effect)          |
  | 2. pinsedag                                                                                                              | Easter + 50       | full                      |
  | Juledag                                                                                                                  | 25 Dec            | full                      |
  | 2. juledag                                                                                                               | 26 Dec            | full                      |
  | Store bededag (Easter + 26) is **not** generated for years ≥ 2024 (abolished by law); it is generated for years ≤ 2023   |
  | so historical data stays correct.                                                                                        |
  | Optional company days, off by default and toggled per calendar: Grundlovsdag 5 Jun (half or full), Juleaftensdag 24 Dec, |
  | Nytårsaftensdag 31 Dec, fredag efter Kristi himmelfart. _Example_: Easter 2027 = 28 Mar → Skærtorsdag 25 Mar,            |
  | Kristi himmelfart 6 May, 2. pinsedag 17 May.                                                                             |
- **R7 Holidays are per year** [Observed]: not auto-copied; the "generate year N" action creates the statutory set; a
  nightly job warns Admin in November if next year's calendar is empty. [Assumed job]
- **R8 Rates history** [Assumed]: the applicable cost or sale rate on date d is the row with the latest `validFrom ≤ d`.
  If an employee references a cost-price group, the group's rate applies unless an employee-specific cost row exists.
  _Example_: cost 420 kr valid 1 Jan 2026, 450 kr valid 1 Jul 2026 → entry dated 30 Jun uses 420 kr, 1 Jul uses 450 kr.
- **R9 Department depth** [Brief]: unlimited parent chain; cycles are rejected. Line-manager visibility includes indirect
  reports (recursive on `managerId`). [Assumed]
- **R10 Initials** [Assumed]: 2–6 uppercase letters/digits, unique per tenant, immutable once time is registered
  (used in reports/specifications).

## 6. Edge cases

- Holiday on a weekend or a day with 0 pattern hours → no reduction (R2 floors at 0).
- Half-day holiday on Friday with 7.0 h pattern → 3.5 h reduction.
- Backdated norm change into a closed accounting period: allowed for flex purposes but warned; financial data unaffected. [Assumed]
- Employee without manager: approvals route to the department manager; if none, to Admins with an inbox warning. [Assumed]
- Two legal entities in different countries (V3) each use their own holiday calendar per employee. [Observed]
- Re-hire: new employment period on the same Employee row is out of scope for MVP; create a new employee record with new initials. [Assumed]
- Part-time 2-week pattern (e.g. 4-day and 5-day weeks alternating) needs a correct anchor date; UI shows "week A/B" preview.

## 7. Acceptance criteria

- **AC1** Given the default pattern, When I view week norm for a week without holidays, Then it shows 37,00 t.
- **AC2** (Brief §9) Given a full-day holiday on Wednesday, When the weekly norm is calculated, Then it is 29,5 t.
- **AC3** Given year 2026 is generated for the DK calendar, Then it contains 2. påskedag on 6 Apr 2026, Kristi himmelfart
  on 14 May 2026 and no Store bededag.
- **AC4** Given an employee starting on a Wednesday, When week norm is calculated, Then only Wed–Fri count (22,0 t).
- **AC5** Given a norm change with a past valid-from date, When saved, Then a new history row exists, the old row is
  unchanged, and flex is recalculated for weeks from that date.
- **AC6** Given a cost rate change valid 1 Jul, When an entry dated 30 Jun is approved, Then the old cost rate is snapshot.
- **AC7** Given a department move that would create a cycle, When saved, Then it is refused with a validation message.
- **AC8** Given a line manager, When they open the employee list, Then they see direct and indirect reports only
  (unless they also hold another wider role).
- **AC9** Given duplicate initials, When creating an employee, Then the save is refused.

## 8. Open points

- Which optional company days does ARCnordic give (Grundlovsdag half/full, 24 Dec, 31 Dec, day after Ascension)?
- Does ARCnordic have part-time or 2-week patterns in use today?
- One legal entity or several (affects whether V3 multi-entity is needed early)?
- Competency catalogue: does a list exist (disciplines, certifications like brand/fire/statics)?
- Should employees be able to edit their own competencies, or only managers?
