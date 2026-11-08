# Payroll export (Lønoverførsel)

Release: V3 (M4) — CSV export first; provider API adapters (Danløn, DataLøn, Zenegy) later in V3. Salary codes on absence codes are
configurable from MVP so data is ready. Tags: [Observed] / [Assumed] / [Brief].

## 1. Purpose & roles
Deliver, per pay period, the payroll-relevant quantities for each employee (absence, overtime, allowances, mileage, expense
reimbursements) to the payroll provider in its expected format, without double-sending. ARCnordic Tid does not calculate salary. [Brief]

| Role | What they do |
|---|---|
| Finance (payroll) | Configures salary codes and rules, runs export, locks pay period, handles late registrations. [Brief] |
| Admin | Maps absence codes / expense types to salary codes; sets employee payroll numbers. [Assumed] |
| Line Manager | Must approve items before they are exportable. [Brief] |

## 2. Screens / views
1. **Salary codes** (admin): code, name, unit (`hours|days|km|amount`), source mapping, include in export (yes/no), provider code per provider. [Observed: include-in-export + mapping per absence code]
2. **Pay periods**: list per legal entity and pay group (e.g. monthly salaried, hourly paid 14-day): start, end, status, exported at/by. [Observed: chained salary periods]
3. **Payroll export run**: filters — legal entity (only if several), department, pay group, employee; period (defaults to next
   unexported period). Table: one row per employee with ticked checkbox, totals per salary code, warning icons:
   ⚠ missing employee payroll number (row not selectable), ⚠ unapproved items in period (count + drill-down), ⚠ items changed since last export. Actions: preview lines, generate file / send to provider, lock period. [Observed: checkbox per employee, warnings for missing approval and missing employee no.]
4. **Export history**: each run with file download, line count, user, provider response; integration log. [Observed: integration log]

## 3. Data
- **SalaryCode**: id, tenantId, code, name, unit, kind (`absence|overtime|allowance|mileage|expense|other`), includeInExport, providerCodes {provider: code}. [Brief]
- **SalaryCodeMapping**: sourceType (`absence_code|expense_type|mileage_rate|overtime_rule|allowance_type`), sourceId, salaryCodeId. [Assumed]
- **OvertimeRule** (V3): pay group, threshold basis (`daily|weekly`), threshold hours over norm, factor (e.g. 150 %), salary code; only for employees flagged "overtime paid" (others go to flex). [Brief: salary codes for overtime] [Assumed: rule shape]
- **PayGroup**: id, legalEntityId, name, frequency (`monthly|biweekly`). [Observed: salary groups]
- **PayPeriod**: id, payGroupId, startDate, endDate, status (`open|exported|locked`), exportedAt/By. [Observed]
- **PayrollExportRun**: id, payPeriodId, provider, filters, status (`generated|sent|failed`), fileId, createdBy/At. [Assumed]
- **PayrollExportLine**: runId, employeeId, employeeNumber, salaryCodeId, providerCode, quantity, rate (øre, optional), amount (øre, optional), periodStart, periodEnd, sourceRefs[]. [Brief]
- Employee: payrollNumber (medarbejdernummer in payroll system), payGroupId. [Assumed]

## 4. User actions & state transitions
PayPeriod: `open → exported → locked`; `exported → open` only by Finance with reason if nothing was sent to a provider API. [Assumed]
Next period: start = previous end + 1 day; length defaults to previous length (monthly → next calendar month). First period entered manually. [Observed]

## 5. Business rules & calculations
- **R1 Eligible item** = status `approved` (or `invoiced`), date within pay period, mapped to a salary code with includeInExport, employee active in period and has payrollNumber. [Brief + Observed]
- **R2 Line aggregation**: one line per employee × salary code × pay period; quantity = Σ in the code's unit. Absence in days: hours ÷ employee's norm hours that day, summed (full-day = 1, half = 0,5). [Assumed]
  Example: vacation 7,5 h Mon + 7,5 h Tue + 7,0 h Fri (norm 7,5/7,5/7,0) → 3,00 days, code "FERIE".
- **R3 Mileage reimbursement** = km × statutory tax-free rate for the date's year (table), e.g. 2027 rate configured by admin; split into
  the high/low band at the yearly km threshold per employee (Danish rules: higher rate up to 20.000 km/year). Line quantity = km, amount = reimbursement. [Brief + Assumed: band logic, rates configurable]
  Example (illustrative rate 3,81 kr/km): 412 km → 1.569,72 kr.
- **R4 Expense reimbursement**: approved personal expenses paid by the employee (payment method "own card/cash") → amount incl. VAT on code "UDLÆG"; company-card expenses are never exported. [Assumed]
- **R5 Allowances (per diem)**: days/meals per approved travel × rate table → code "DIÆTER" (V3). [Brief]
- **R6 Overtime** (V3, only overtime-paid employees): hours over threshold → quantity on overtime code; flex not affected for those hours. [Assumed]
- **R7 No double export**: each source item records `payrollExportLineId` when exported in a locked/sent run. Re-running an unlocked period
  regenerates the full file (replacement). After lock, new or changed items dated in that period are **late items**: they are exported in the
  next period's run as separate lines tagged with the original period (column `original_period`), corrections as delta quantities (negative allowed). [Brief + Observed: late registrations are a known problem] [Assumed: delta approach]
- **R8 Lock**: locking a pay period freezes its lines; items dated in a locked pay period remain editable by accounting-period rules, but changes produce late deltas (R7). [Brief]
- **R9 CSV generic format** (UTF-8 with BOM, `;` separator, Danish decimal comma, ISO dates): [Assumed]
  `employee_number;employee_name;salary_code;provider_code;description;quantity;unit;rate;amount;period_start;period_end;original_period;source_count`
  Example row: `1042;Mette Holm;FERIE;31;Ferie;3,00;dage;;;2027-03-01;2027-03-31;;3`
- **R10 Provider adapters (V3)** implement `buildPayload(lines)` and `send()`; Danløn/DataLøn/Zenegy via sandbox only, disabled by default. [Brief]

## 6. Edge cases
- Employee without payrollNumber → excluded, warning; export still possible for others. [Observed]
- Unapproved items → warning only; they will be late items once approved. [Observed]
- Employee changes pay group mid-period → items split by date to each group's period. [Assumed]
- Absence code remapped after export → affects only future runs. [Assumed]
- Leaver: items after employment end are invalid at registration. [Assumed]
- Mileage threshold crossing within a period → line split into two codes. [Assumed]
- Opening file in Excel may break it — download offers both CSV (for import) and XLSX (for reading). [Observed: warning about opening in Excel] [Assumed: dual output]

## 7. Acceptance criteria
- **AC1** Given vacation approved 3 days in March for employee 1042, When exporting March, Then one line FERIE 3,00 days. [Brief]
- **AC2** Given an employee without payroll number, Then their row is disabled with a warning and not in the file. [Observed]
- **AC3** Given March exported and locked, When a sick day dated 10-03 is approved on 05-04, Then the April run contains a late line for SYG with original_period 2027-03 and March's file is unchanged. [Assumed]
- **AC4** Given March exported but not locked, When re-run, Then the new file replaces the previous one with no duplicate lines. [Assumed]
- **AC5** Given a company-card expense, Then it never appears in the payroll export. [Assumed]
- **AC6** Next period after 01-03–31-03 defaults to 01-04–30-04. [Observed]
- **AC7** Only Finance can run/lock exports; others 403. [Brief]

## 8. Open points
- Which payroll provider does ARCnordic use (Danløn, DataLøn, Zenegy, other)? Monthly only, or also hourly-paid 14-day groups?
- Is overtime paid for any employee group, or does everything go to flex/afspadsering?
- Are mileage and expense reimbursements paid through payroll or via the accounting system (bank transfer)?
- Per diem (diæter) rules needed now?
- Provide the current salary-code list (lønarter) from the payroll system.
