# Projects, tasks & contracts (Projekter, opgaver og kontrakter)

Release:

- **MVP**: projects, numbering, members, WBS ≤ 5 levels, task types, budgets (hours + amount on project/task/employee),
  contracts T&M and fixed price (terms only), budget-vs-actual with contribution margin.
- **V2**: payment plans and completion % in use by invoicing/revenue, retainers, T&M max budget enforcement, Gantt with dependencies.
- **V3**: project templates (copy; limited propagation), value-based completion method, budget-change correction strategies.

## 1. Purpose & roles

Describe the work we sell: what the project is, how it is split into tasks, what was budgeted and under which commercial
terms (contracts), and how actuals compare to budget. [Brief]

| Role            | Uses this module to                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| Project Manager | Create/edit own projects, tasks, budgets, members, allocations, payment plans; override completion % |
| Finance         | Everything PM can, on all projects; set contract terms; mark payment plan items ready                |
| Line Manager    | Read projects their reports work on                                                                  |
| Employee        | See projects/tasks they can register on; see own budget/allocation                                   |
| Management      | Read all, portfolio overview                                                                         |
| Admin           | Task types, categories, stages, number series, templates (V3)                                        |

## 2. Screens / views

- **S1 Project list** — number, name, customer, PM, status, stage, contract type(s), budget hours / used hours,
  budget amount / revenue to date, health indicator (green ≤ 90 % used, amber 90–100 %, red > 100 % or completion lagging).
  Filters: status, PM, customer, department, category, contract type. Saved filters. [Assumed; Observed saved filters pattern]
- **S2 Project overview** — header (number, name, customer, PM, status, dates, currency, billable), KPI tiles:
  budget vs actual hours, revenue (T&M value or recognised fixed price), cost, contribution margin and %, WIP (V2),
  invoiced (V2); burn-up chart of hours vs budget over time. [Brief]
- **S3 Task plan (WBS)** — tree grid, max 5 levels: number (auto "1.2.3"), name, task type, contract, billable, status,
  start/end, budget hours, budget amount, used hours, remaining, % used; inline editing; indent/outdent; drag to reorder;
  roll-up of child budgets to parents. [Brief + Observed task plan]
- **S4 Members & allocations** — members with project role, project-specific rate (→ rates.md), allocated hours per
  task; employee budget vs used. [Brief]
- **S5 Contracts** — list of contracts on the project; detail per type (see §5); payment plan grid (V2); retainer periods (V2). [D-003]
- **S6 Gantt (V2)** — tasks as bars with start/end, milestones as diamonds, finish-to-start dependencies with lag,
  today line, critical path highlight (optional). Editing dates by drag updates the task. [Brief]
- **S7 Budget vs actual report** — per task and per employee: budget h, actual h, variance, budget amount, actual
  value, cost, contribution margin. Export CSV. [Brief]
- **S8 Admin** — task types, project categories, project stages (ordered, non-gating) [Observed], number series. [Brief]

## 3. Data

```
Project(id, tenantId, legalEntityId, number, name, customerId?, pmEmployeeId, status: planned|active|completed|archived,
        stageId?, categoryId?, startDate, endDate?, currency, priceListId?, billable bool, departmentId?,
        requireComment bool, description, templateId?, createdAt)
  -- internal projects (customerId null, billable=false) for e.g. "Intern tid", "Kompetenceudvikling"
Task(id, projectId, parentId?, wbsCode, level 1..5, sortOrder, name, taskTypeId?, contractId, billable bool?,
     status: open|closed, startDate?, endDate?, budgetHours numeric(8,2)?, budgetAmountMinor?, isMilestone bool)
TaskType(id, tenantId, name, defaultBillable, active)          -- e.g. Projektering, Tilsyn, Byggeledelse, Intern
TaskDependency(id, predecessorTaskId, successorTaskId, type='FS', lagDays int)   -- V2
ProjectMember(id, projectId, employeeId, projectRole?, active)
EmployeeTaskBudget(id, taskId, employeeId, budgetHours)        -- per-employee budget/allocation total; time-phased in resource-planning.md
Contract(id, projectId, name, type: tm|fixed_price|retainer, currency,
         -- tm:          maxBudgetMinor?, maxBudgetHours?, expensesBillable bool
         -- fixed_price: priceMinor, completionMethod: hours|value(V3), completionOverridePct?, overrideReason?,
         --              budgetHours, correctionStrategy: spread_remaining|zero_until_caught_up(V3)|allow_negative(V3)
         -- retainer:    poolKind: hours|amount, poolSize, periodicity: month|quarter|year, feeMinor,
         --              rolloverRule: none|carry_all|carry_capped, rolloverCap?, alertThresholds int[] = {80,100}
         status: active|completed)
PaymentPlanItem(id, contractId, label, amountMinor, dueDate, linkedTaskId?, status: planned|ready|invoiced, invoiceLineId?)
RetainerPeriod(id, contractId, periodStart, periodEnd, poolSize, carriedIn, used, status: open|closed, alertsSent int[])
ProjectNumberSeries(id, tenantId, pattern = '{YY}{SEQ:3}', nextSeq)
```

## 4. User actions & state transitions

- **Project status** [Assumed, per overview §4]: `planned → active → completed → archived`.
  - Time/expenses can be registered only when `active`.
  - `active → completed` warns if there are draft/submitted entries or uninvoiced billable items; fixed-price contracts get
    final revenue recognition at completion [Observed: completion triggers revenue booking].
  - `completed → active` (reopen) allowed for PM/Finance, audited. `archived` is read-only and hidden from pickers.
- **Task status**: `open → closed`; closed tasks reject new entries; reopening allowed. A parent task with open children
  cannot be closed. [Assumed]
- **Only leaf tasks accept time** [Assumed]: parents are summary nodes. Adding a child to a task that has entries is
  refused (or entries must be moved first).
- **Contract status**: `active → completed`; completing a fixed-price contract recognises remaining value. [Observed]
- **Payment plan item**: `planned → ready → invoiced`; `ready` can be set by PM/Finance (or automatically on due date if
  tenant setting "auto-ready on due date" is on); `invoiced` set by invoice booking; crediting the invoice line returns
  it to `ready`. [Observed: mark payments ready for invoicing; Assumed rest]

## 5. Business rules & calculations

- **R1 Project number** [Assumed]: per-tenant series, default pattern `{YY}{SEQ:3}` → first project 2026 = `26001`;
  unique per tenant; editable until the first time entry, then immutable.
- **R2 WBS depth** [Brief]: level ≤ 5; WBS codes are positional ("2.1.3") and recomputed on reorder; stored code is display only.
- **R3 Budget roll-up** [Assumed]: a parent's budget = Σ children's budgets when children have budgets; a PM may also set a
  parent budget; if Σ children > parent budget a warning (not a block) is shown. Project budget = Σ top-level tasks.
- **R4 Billable resolution for a new entry** [Brief]: task.billable if set, else taskType.defaultBillable, else
  project.billable. Internal projects are always non-billable. PM can override per entry during approval (approval.md).
- **R5 Contract per task** [D-003]: each task belongs to exactly one contract on the same project (child tasks inherit
  the parent's contract unless set). A new project gets one default contract of the chosen type.
- **R6 T&M value** [Brief]: value = Σ approved billable hours × resolved rate (rates.md) + billable expenses incl. markup.
  Revenue is recognised at invoicing.
  _Example_: 12 h × 950 kr + 3,5 h × 1 100 kr = 11 400 + 3 850 = **15 250 kr**.
- **R7 T&M max budget** (V2) [Observed]: if `maxBudgetMinor` is set, cumulative billable value beyond the cap is not
  invoiceable; such entries are flagged "over ramme" and appear in invoice suggestions as excluded write-down candidates.
  _Example_: cap 100 000 kr, rate 1 000 kr; approved billable hours reach 105 → 5 h = **5 000 kr** over cap, excluded.
  Warn PM at 80 % and 100 % of cap.
- **R8 Fixed-price completion** [Brief, D-004]:
  `completion = min(1, usedHours / budgetHours)` where usedHours = approved hours (billable or not) on the contract's
  tasks; PM override replaces it (0–100 %, reason required, audited). Displayed rounded to 0,1 %.
  `recognised = round(price × completion)`.
  _Example (Brief §9)_: price 240 000 kr, budget 200 h, used 98 h → completion 49 % → recognised **117 600 kr**.
  Over-run: 230 of 200 h → completion capped at 100 % → recognised 240 000 kr; overrun 30 h shows as negative margin.
- **R9 Fixed-price margin** [Brief]: contribution margin = recognised − cost, cost = Σ hours × snapshotted cost rate
  (+ non-billable expenses on the contract).
  _Example_: 98 h at cost 450 kr = 44 100 kr → DB = 117 600 − 44 100 = **73 500 kr**, DB-grad 62,5 %.
- **R10 Payment plan** (V2) [Observed]: Σ items should equal the contract price; difference shown as a warning
  ("ikke planlagt: 20 000 kr"). Invoicing a payment item does **not** change recognised revenue; the difference between
  invoiced and recognised is WIP (if recognised > invoiced) or deferred revenue (if invoiced > recognised)
  (accounting-periods.md). _Example_: 2 of 4 equal items invoiced = 120 000 kr; recognised 117 600 kr → deferred 2 400 kr.
- **R11 Budget change on fixed price** (V3) [Observed]: default strategy "spread over remaining": after a change,
  remaining value (price − already recognised) is spread over remaining hours (budget − used). Other strategies V3.
- **R12 Retainer** (V2) [D-008]:
  - Each period gets `pool = poolSize + carriedIn`. Usage = approved hours (or value at resolved rate for amount pools)
    on the contract's tasks dated in the period.
  - Alerts to PM and Finance when usage crosses each threshold (default 80 %, 100 %), once per threshold per period.
  - Rollover at period close: `none` → unused lapses; `carry_all` → unused added to next period; `carry_capped` →
    min(unused, cap). Overuse beyond pool is invoiced as T&M at resolved rate (tenant setting; default on).
  - Fee per period becomes an invoiceable item at period start.
    _Example_: 40 h/month, carry_capped 10 h. October: 32 h used → 80 % alert; 8 h unused → November pool 48 h.
    November: 52 h used → 4 h overuse invoiced as T&M.
- **R13 Budget vs actual** [Brief]: per task and employee: variance h = budget − actual; % used = actual / budget;
  "actual" = approved + submitted hours (submitted shown separately as "afventer"); drafts excluded. [Assumed]
- **R14 Templates** (V3) [Brief + Observed]: creating from a template copies task tree, task types, budgets, members,
  contracts (without payment plan dates, which are shifted relative to the new start date). Propagating template edits
  to existing projects is limited to new top-level tasks and renames; new sub-tasks are not propagated.
- **R15 Gantt** (V2) [Brief]: dependencies FS with lag in working days (employee-independent tenant calendar); moving a
  predecessor shifts successors only if "auto-schedule" is on; cycles refused.

## 6. Edge cases

- Moving a task with entries to another parent or contract: allowed; entries follow; if the contract type changes,
  already-invoiced entries are unaffected; warn PM. [Assumed]
- Deleting a task with entries: refused; close instead. Deleting a task without entries: allowed, audited.
- Budget hours 0 on fixed price → completion undefined → treated as 0 % until PM override is set; show warning.
- Fixed price with entries but completion override lower than previously recognised in a closed period → negative
  recognition in the current period (never alters closed periods). [Assumed]
- Project currency ≠ DKK (V3 multi-currency): budgets and rates in project currency.
- Project end date passed while active: show warning, do not block registration (setting can block). [Assumed]
- Changing project customer after invoices exist: refused.
- Contract type change after entries exist: only allowed when no invoices booked on the contract.

## 7. Acceptance criteria

- **AC1** Given a task at level 5, When I add a child, Then it is refused with "max 5 niveauer".
- **AC2** (Brief §9) Given fixed price 240 000 kr, budget 200 h and 98 approved hours, Then completion shows 49,0 % and
  recognised revenue 117 600,00 kr.
- **AC3** Given 230 approved of 200 budget hours on a fixed-price contract, Then completion is 100 % and recognised = price.
- **AC4** Given a PM overrides completion to 60 % without a reason, Then the save is refused; with a reason, Then it is
  saved and an audit record exists.
- **AC5** Given a project in status `planned` or `completed`, When an employee tries to register time, Then it is refused.
- **AC6** Given a closed task, Then it does not appear in the timesheet task picker and API writes are refused.
- **AC7** Given a parent task with entries, When I add a child task, Then it is refused.
- **AC8** Given task budgets 40 h and 60 h under a parent, Then the parent shows 100 h budget.
- **AC9** (V2) Given a retainer of 40 h/month, When approved hours reach 32 h, Then one 80 % alert is sent and not repeated.
- **AC10** (V2) Given T&M cap 100 000 kr at 1 000 kr/h and 105 approved billable hours, Then 5 h are flagged over cap and
  excluded from invoice suggestions.
- **AC11** Given the series `{YY}{SEQ:3}` and no projects in 2026, When I create a project, Then its number is 26001.
- **AC12** Given a project, Then budget-vs-actual shows contribution margin = revenue − cost and DB-grad = DB / revenue.

## 8. Open points

- ARCnordic's project numbering convention today (keep existing numbers on migration?).
- Standard task types for architecture/engineering (e.g. faser per FRI/DANSKE ARK ydelsesbeskrivelse: idéoplæg,
  dispositionsforslag, projektforslag, myndighedsprojekt, udbudsprojekt, udførelsesprojekt, tilsyn) — should these be a
  default template?
- Should fixed-price completion count non-billable hours on the contract (current assumption: yes, all approved hours)?
- Retainer overuse: invoice automatically as T&M, or require PM decision?
- Health thresholds (90/100 %) acceptable?
