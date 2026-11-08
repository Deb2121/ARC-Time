# Resource planning (Ressourceplanlægning)

Release: allocations (total per employee per task) — **MVP** (as part of project members/budgets).
Time-phased allocations, capacity heatmap, find by competence and free capacity — **V2** (M3).
Drag to reassign, Outlook-fed bookings — **V3**.

## 1. Purpose & roles
Plan who works on what and when, compare planned load with each person's real capacity, and spot over- and
under-booking early. [Brief]

| Role | Uses this module to |
|---|---|
| Project Manager | Allocate members to tasks on own projects, see their availability |
| Line Manager | See and adjust load for own department; resolve over-booking |
| Employee | See own plan for coming weeks (read-only) |
| Finance / Management | Read: planned revenue, utilisation forecast |
| Admin | Settings (planning unit, colour bands, absence codes that reduce capacity) |

## 2. Screens / views
- **S1 Heatmap** [Brief] — rows = employees (grouped by department, collapsible), columns = ISO weeks (default: this week
  + 11). Cell = booked hours / capacity and utilisation %, coloured by band (R5). Click a cell → drill-down to S3.
  Filters: department, competency, project, PM, employee. Toggle unit hours / days (R7). Saved filters. [Observed filters + man-day setting]
- **S2 Project view** — rows = project tasks → members, columns = weeks; cell = allocated hours for that member/task/week,
  with registered hours shown beside it for past weeks (planned vs actual). Totals per task vs task budget. [Observed: allocation vs registered]
- **S3 Employee week drill-down** — for one employee and week: capacity breakdown (norm, holidays, absence by code),
  allocations per project/task, registered hours so far, free capacity.
- **S4 Find people** (V2) [Brief] — inputs: competency (+ minimum level), period, hours needed per week, department.
  Output: employees ranked by free capacity in the period, showing competency level and current utilisation; action
  "allocate" opens an allocation form prefilled.
- **S5 Planned revenue** (V2) [Observed: estimated revenue from planned hours] — per project and month: allocated
  remaining hours × resolved rate (T&M), or fixed-price average remaining rate (R9).

## 3. Data
```
Allocation(id, tenantId, employeeId, projectId, taskId, periodStart, periodEnd, hours numeric(8,2),
           mode: total|per_week|per_day, createdBy, updatedAt)
  -- mode total: hours spread over the period (R3); per_week / per_day: AllocationBucket rows hold explicit values
AllocationBucket(allocationId, bucketDate, hours)      -- explicit week (Monday date) or day buckets
AbsenceCode.reducesCapacity bool                       -- defined in absence-flex.md [Observed: absence deducted as capacity]
PlannedAbsence = approved or submitted absence entries with future dates (absence-flex.md)
Settings: planningUnit hours|days, hoursPerDay for display (default 7.4), bands {low:70, high:100}
```

## 4. User actions & state transitions
- **Create / edit allocation** (PM on own projects; Line Manager for own reports): choose employee, task, period, hours
  and mode. Allocations have no approval lifecycle — they are plans. Every change is logged (who/when/old/new). [Assumed]
- **Copy allocation forward** — repeat the same weekly hours for the next N weeks. [Assumed]
- **Drag to reassign** (V3) [Brief] — move remaining hours of an allocation to another employee or week.
- **Over-allocation warning** — saving an allocation that pushes a week over 100 % shows a warning, never blocks. [Assumed]
- Allocations to closed tasks or completed projects cannot be created; existing future allocations on a project
  that is completed are deleted automatically with a log entry. [Assumed]

## 5. Business rules & calculations
- **R1 Capacity per employee per day** [Brief]: `capacity(d) = norm(d) − absenceReducing(d)`, floored at 0, where
  `norm(d)` already excludes public holidays (organisation.md R2) and `absenceReducing(d)` = Σ hours of absence entries
  (draft excluded; submitted and approved included) whose code has `reducesCapacity = true`.
  Weekly capacity = Σ over Mon–Sun.
  *Example*: default 37 h pattern, week with a Thursday holiday and one approved vacation day Monday:
  norm = 37 − 7,5 = 29,5; capacity = 29,5 − 7,5 = **22,0 h**.
- **R2 Booked hours per week** [Assumed]: Σ allocation hours falling in the week (after spreading, R3).
  For past and current weeks the heatmap can switch to *registered* hours (approved + submitted + draft).
- **R3 Spreading of a total allocation** [Observed: unregistered allocation spread evenly over task duration; Assumed refinement]:
  `remaining = max(0, allocation.hours − registeredHours(employee, task, periodStart..today))`.
  Remaining hours are spread evenly over the employee's **working days with capacity > 0** from max(today, periodStart)
  to periodEnd. Past days show registered hours, not planned.
  *Example*: allocation 60 h on task "Projektforslag" 02-11-2026 → 27-11-2026 (20 working days). On 09-11 (Monday,
  start of day) 12 h are registered → remaining 48 h over 15 remaining working days = **3,2 h/day** = 16 h/week for
  weeks 46–48. If the employee has a vacation day in week 47, that day gets 0 and the 48 h spread over 14 days (3,43 h/day).
- **R4 Utilisation (planning)** [Brief]: `utilisation = booked / capacity`. If capacity = 0 and booked > 0 → shown as
  "over" (∞); if both 0 → grey "ingen kapacitet".
- **R5 Colour bands** [Brief]: `< 70 %` under-booked (cool/blue), `70–100 %` well-booked (green), `> 100 %` over-booked
  (amber → deep orange as it rises). Exactly 70 % and exactly 100 % are green. Colours per brand.md (never brand red,
  so over-booking is distinguishable from brand accents). Every cell also shows the number, so colour is never the only cue (WCAG). [Brief + Assumed]
- **R6 Free capacity** = max(0, capacity − booked) per week; Find-people ranks by Σ free capacity over the requested
  period, tie-broken by higher competency level, then lower current utilisation. [Assumed]
- **R7 Days display** [Observed: man-day conversion setting]: hours ÷ tenant `hoursPerDay` (default 7,4 = 37 / 5), 1 decimal.
- **R8 Absence that does not reduce capacity** (e.g. a code configured as "kursus på projekt"): ignored in R1. [Observed: per-code setting]
- **R9 Planned revenue** (V2) [Observed]:
  - T&M: Σ remaining allocated hours × provisional resolved rate (rates.md) on the allocation's task.
  - Fixed price: remaining hours × average remaining rate, where
    `avgRate = (price − recognised) / (budgetHours − usedHours)` (0 if denominator ≤ 0).
    *Example*: price 240 000 kr, recognised 117 600 kr, budget 200 h, used 98 h → avgRate = 122 400 / 102 = **1 200 kr/h**.
- **R10 Allocation vs budget** [Assumed]: Σ allocations of a task + registered hours outside allocations compared with
  the task budget; > budget shows a warning in S2.

## 6. Edge cases
- Allocation period partly before employment start or after end → hours spread only within employment; the form warns.
- Employee changes norm pattern in future → capacity uses the pattern valid on each day.
- Half-day holiday → capacity counts the remaining half (R1 via norm).
- Registered hours exceed the allocation → remaining 0; nothing spread; S2 shows actual > plan in amber.
- Sick leave registered in the current week reduces capacity immediately, which can turn a green cell amber — expected.
- Very large teams: heatmap paginates by department; performance target < 1 s for 200 employees × 12 weeks. [Assumed]
- Outlook-fed bookings (V3) [Observed]: when both a manual allocation and calendar appointments exist for the same
  day/task, use the higher of the two, not the sum.

## 7. Acceptance criteria
- **AC1** Given a 37 h employee with a Thursday holiday and one approved vacation day, Then the week capacity is 22,0 t.
- **AC2** Given capacity 30 h and booked 20 h, Then utilisation 66,7 % in the under-booked colour; booked 21 h → 70 % green;
  booked 31 h → 103,3 % over-booked colour.
- **AC3** Given a 60 h allocation over 20 working days with 12 h registered after 5 days, Then each remaining working day
  shows 3,2 t planned.
- **AC4** Given an absence code with `reducesCapacity = false`, When such absence is registered, Then capacity is unchanged.
- **AC5** Given capacity 0 and booked 4 h, Then the cell shows "over" and is not a division error.
- **AC6** Given I search for competency "Brandrådgivning" level ≥ 3 for weeks 47–50 needing 15 h/week, Then only employees
  with that competency and level appear, ranked by free capacity.
- **AC7** Given a PM, When they try to allocate an employee on another PM's project, Then it is refused (unless they also
  have Line Manager or Admin rights for that employee).
- **AC8** Every heatmap cell exposes its number and band as text to screen readers.

## 8. Open points
- Planning granularity ARCnordic prefers: weekly hours (assumed default) or daily?
- Should utilisation in the planner count only billable allocations (matching the KPI "utilisation = billable ÷ norm")
  or all allocations (assumed: all, with a toggle for billable only)?
- Is "hours per day" for day display 7,4 (37/5) or 7,5?
- Should over-booking > 100 % ever block saving (e.g. > 120 %)?
