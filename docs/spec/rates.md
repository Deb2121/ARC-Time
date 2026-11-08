# Price lists & rates (Prislister og timepriser)

Release: employee default sales rate and cost rate — **MVP** (needed for budget-vs-actual value and margin).
Price lists, full resolution order, snapshot at approval — **V2** (M2). Annual indexation — **V3**.

## 1. Purpose & roles
Decide, for every billable hour, which hourly rate applies, and freeze that rate when the hour is approved so history
never changes when prices change later. Also supply cost rates for margin. [Brief]

| Role | Uses this module to |
|---|---|
| Finance | Maintain standard and customer price lists, project price lists, indexation |
| Project Manager | Set project-specific employee rates and project price list rates on own projects (if right granted) |
| Admin | Rate roles (price groups), task types used as rate keys |
| Management | Read |

## 2. Screens / views
- **S1 Price lists** — list of price lists: name, kind (standard / customer / project), owner (customer or project),
  currency, number of rates, active. Exactly one active standard list per legal entity. [Observed standard + customer lists; Brief project list]
- **S2 Price list detail** — two views [Observed list + matrix]:
  - *List*: one row per rate: key (rate role / task type / employee), amount, valid from, valid to (derived), status.
  - *Matrix*: rate roles (rows) × task types (columns), cell = current amount; empty cell = falls through.
  Actions: add rate, add new version from a date (keeps old), copy list from another list, deactivate.
- **S3 Project rates tab** (on project) — project price list selection; project-specific employee rates; preview table
  "who gets which rate on which task" with the step that produced it. [Assumed]
- **S4 Rate explanation** — on any time entry (and invoice line), a popover shows the resolution trace:
  "Step 2: projektprisliste 'Tilsyn' → 875 kr (gyldig fra 01-01-2026)". [Assumed]
- **S5 Indexation (V3)** — choose lists, percentage (e.g. +4 %), effective date, rounding (nearest 5 kr); preview;
  apply creates new versions. [Brief + Observed indexation page exists]

## 3. Data
```
RateRole(id, tenantId, name, active)              -- price group, e.g. Arkitekt, Ingeniør, Konstruktør, Projektleder, Studentermedhjælp
Employee.rateRoleId                               -- one rate role per employee (with history: EmployeeRateRole(employeeId, rateRoleId, validFrom))
PriceList(id, tenantId, legalEntityId, kind: standard|customer|project, customerId?, projectId?, name, currency, active)
PriceListRate(id, priceListId, rateRoleId?, taskTypeId?, employeeId?, amountMinor, validFrom)
   -- key = any combination; at least one of rateRoleId/taskTypeId/employeeId (employeeId only on project lists)
ProjectEmployeeRate(id, projectId, employeeId, amountMinor, validFrom)   -- step 1
EmployeeRate(kind=sale|cost)  -- defined in organisation.md (step 5 and cost)
TimeEntry.resolvedRateMinor, resolvedRateSource jsonb {step, priceListId?, rateId?}, costRateMinor  -- snapshot at approval
```

## 4. User actions & state transitions
- Rates are never edited in place once used by an approved entry: changing an amount means adding a new row with a new
  `validFrom`. Rows not yet used may be edited/deleted (audited). [Brief: history must not change; Assumed mechanism]
- Adding a rate to a standard list prompts whether existing active projects using that list should pick it up — with
  our model this is automatic (resolution is live until approval), so the prompt only informs how many projects and
  unapproved entries are affected. [Observed prompt; Assumed simplification]
- **Snapshot**: at the transition `submitted → approved`, the domain function resolves sale rate and cost rate and
  writes them to the entry. Before approval, UI shows a *provisional* rate computed live. [Brief]
- **Re-rate** (Finance only): for approved, not invoiced entries, Finance can trigger "re-resolve rates" for a project
  and date range; changes are audited per entry (old → new). Invoiced entries are never re-rated. [Assumed]

## 5. Business rules & calculations
- **R1 Resolution order** [Brief §4.9] — for an entry (employee E, project P, task T with task type TT, date D):
  1. **Project-specific employee rate**: `ProjectEmployeeRate(P, E)` valid on D.
  2. **Project price list**: on P's project price list, first match among
     (a) employee E + task type TT, (b) employee E, (c) task type TT + E's rate role, (d) task type TT, (e) E's rate role.
  3. **Customer price list**: on the price list of P's customer, first match among (c), (d), (e).
  4. **Standard price list** of P's legal entity: first match among (c), (d), (e).
  5. **Employee default sales rate** valid on D (organisation.md R8).
  If nothing matches → rate 0 and the entry is flagged "mangler timepris"; approval is allowed but invoice suggestions
  show a blocking warning. [Assumed for sub-order (a)–(e) and the no-match behaviour]
  Note: in step 1–2, an explicit project price list on P wins over P's customer price list, because the project list is
  the most specific commercial agreement. A project with no project list skips step 2.
- **R2 Valid-from** [Brief + Assumed]: within one key, the row with the greatest `validFrom ≤ D` applies — D is the
  **entry date**, not the approval date. A row with `validFrom > D` is ignored.
- **R3 Snapshot** [Brief]: approved entries keep `resolvedRateMinor` and `costRateMinor` permanently; later price-list
  changes never alter approved or invoiced history. Reopening an approved entry (→ draft) clears the snapshot; the next
  approval resolves again.
- **R4 Currency** [Assumed]: a price list's currency must equal the project currency to be used; mismatching lists are
  skipped (V3 multi-currency may convert). MVP: all DKK.
- **R5 Cost rate** [Brief]: cost = employee cost rate (or cost-price group) valid on D; snapshot at approval like sales rate.
- **R6 Indexation** (V3) [Brief]: new rate = round(old × (1 + pct), to nearest rounding unit), validFrom = effective date.
  *Example*: 950 kr × 1,04 = 988 kr → nearest 5 kr → **990 kr** from 01-01-2027.

**Worked example (R1 + R2)** — Employee *MKJ* (rate role Arkitekt, default sales rate 900 kr). Customer *Byg & Bo A/S*
has customer list "Byg & Bo 2026": Arkitekt 925 kr. Standard list: Arkitekt 950 kr, Arkitekt+Tilsyn 1 000 kr.
Project *26014 Skolerenovering* has project list with task type Tilsyn 875 kr (valid from 01-03-2026), and a project
employee rate for MKJ of 850 kr valid from 01-06-2026.

| Entry | Date | Task type | Step that matches | Rate |
|---|---|---|---|---|
| 1 | 15-02-2026 | Tilsyn | step 1: none (850 from June) · step 2: Tilsyn 875 not yet valid (March) · step 3: Arkitekt 925 | **925 kr** |
| 2 | 10-04-2026 | Tilsyn | step 2 (d) Tilsyn 875 | **875 kr** |
| 3 | 10-04-2026 | Projektering | step 2: no match · step 3 (e) Arkitekt 925 | **925 kr** |
| 4 | 02-06-2026 | Tilsyn | step 1 project employee rate 850 | **850 kr** |

Entry 2 is approved on 20-04-2026 → snapshot 875 kr. On 01-05-2026 Finance raises the project Tilsyn rate to 900 kr
(new row valid from 01-05). Entry 2 still shows 875 kr; a new Tilsyn entry dated 05-05-2026 resolves to 900 kr.

## 6. Edge cases
- Two rows with the same key and same `validFrom` in one list → refused (unique constraint).
- Employee changes rate role mid-year → resolution uses the role valid on entry date D.
- Customer price list changed on the customer after project creation → project keeps the list it had (projects store
  priceListId explicitly; customer list is only the default). Step 3 uses the **project's** customer list reference. [Assumed]
- Non-billable entries still get a resolved sales rate (for write-down analytics and "value of non-billable time"). [Assumed]
- Fixed-price contracts: resolved rate is used for value-based completion (V3) and the planner revenue estimate, never for invoicing.
- Deleting a price list referenced by approved entries → refused; deactivate instead.

## 7. Acceptance criteria
- **AC1** Given the worked example data, When entries 1–4 are resolved, Then rates are 925, 875, 925 and 850 kr and the
  trace names the matching step.
- **AC2** Given an approved entry with snapshot 875 kr, When the price list rate changes to 900 kr, Then the entry still
  shows 875 kr and invoice suggestions use 875 kr.
- **AC3** Given an entry dated before a rate's validFrom, Then that rate is not used.
- **AC4** Given an approved entry is reopened and re-approved after a rate change, Then the new rate valid on the entry date is snapshot.
- **AC5** Given no rate matches, When the entry is approved, Then rate 0 is stored with a "mangler timepris" flag and
  the invoice suggestion for that project shows a blocking warning.
- **AC6** Given an invoiced entry, When Finance runs re-resolve, Then the entry is unchanged.
- **AC7** Given a rate used by an approved entry, When someone edits its amount in place, Then it is refused and the UI
  offers "ny pris fra dato".
- **AC8** (V3) Given +4 % indexation with 5 kr rounding from 01-01-2027, Then 950 kr becomes 990 kr valid from that date
  and the 950 kr row is kept.

## 8. Open points
- What rate roles (price groups) does ARCnordic use today, and do rates differ by task type (e.g. tilsyn vs projektering)?
- Do framework agreements with public customers (rammeaftaler) carry their own rate lists → customer price lists?
- Should approval be blocked when no rate is found, instead of only warning at invoicing?
- Indexation practice: yearly per 1 January, fixed % or index-linked (e.g. Danmarks Statistik)?
