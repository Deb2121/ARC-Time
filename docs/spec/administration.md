# Administration, audit & GDPR (Administration, revisionsspor og GDPR)

Release: M0 — tenant settings, users & roles, audit log, i18n. MVP — departments, norm patterns, holiday calendars, absence codes,
task types, project categories/stages, approval settings, CSV import of employees. V2 — price lists, invoice templates, numbering
series, accounting periods, expense types, mileage rates, integrations, CSV import of customers/projects, GDPR export. V3 — multiple
legal entities UI, GDPR erasure workflow automation. Tags: [Observed] / [Assumed] / [Brief].

## 1. Purpose & roles

Let a tenant configure ARCnordic Tid without developer help, keep a tamper-evident trail of financial changes, and meet GDPR duties. [Brief]
Admin owns all settings; Finance owns finance settings (price lists, numbering, templates, periods, VAT, salary codes); Management reads the audit log. [Brief + overview §3]

## 2. Settings areas (screens) [Brief §4.15]

| Area                                     | Contents                                                                                                                                                                | Owner         | Release              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------------------- |
| Tenant                                   | name, logo, locale (da/en), time zone, currency, hour display (decimal/hh:mm), week vs month submission, future-dated hours limit (default 14 days), max hours/day (24) | Admin         | M0/MVP               |
| Legal entities                           | name, CVR, address, currency, bank details, VAT no., default number series                                                                                              | Admin/Finance | MVP (one), V3 (many) |
| Departments                              | tree ≥ 2 levels, manager                                                                                                                                                | Admin         | MVP                  |
| Users & roles                            | invite, roles (multi), manager, department, deactivate, "approve on behalf of" right                                                                                    | Admin         | M0                   |
| Norm-time patterns                       | named weekly (or 2-week) patterns; per-weekday hours                                                                                                                    | Admin         | MVP                  |
| Holiday calendars                        | Danish holidays built in, per-year entries (full/half/hours), copy to next year                                                                                         | Admin         | MVP                  |
| Absence codes                            | see absence-flex.md (type, unit, counts toward norm/flex, approval required, salary code)                                                                               | Admin         | MVP                  |
| Expense types & mileage rates            | VAT default, billable default, markup, statutory rate table per year                                                                                                    | Finance       | V2                   |
| Task types, project categories, stages   | lists with active flag and sort order                                                                                                                                   | Admin         | MVP                  |
| Contract types                           | enable/disable available types per tenant                                                                                                                               | Admin         | V2                   |
| Price lists                              | see rates.md                                                                                                                                                            | Finance       | V2                   |
| Invoice templates                        | logo, colours (from brand tokens), header/footer texts, bank details, payment text, language, appendix on/off                                                           | Finance       | V2                   |
| Numbering series                         | per legal entity and kind (invoice/credit/project no.), prefix, next number (editable only while unused), padding                                                       | Finance       | V2                   |
| Approval settings                        | flow (line manager / PM then line manager / none), closing rules (warn/block below norm, 0-hour weeks), expense steps                                                   | Admin         | MVP                  |
| Accounting periods                       | see accounting-periods.md                                                                                                                                               | Finance       | V2                   |
| Integrations, SSO, webhooks, API clients | see integrations.md                                                                                                                                                     | Admin         | M0/V2                |
| Import                                   | CSV for employees, customers, projects (+tasks)                                                                                                                         | Admin         | MVP/V2               |
| Security                                 | session timeout (default 8 h idle 60 min), MFA enforcement for local accounts, IP allow-list (V3), PAT policy                                                           | Admin         | M0                   |
| GDPR                                     | processing inventory, retention settings, data subject requests                                                                                                         | Admin         | V2                   |

All settings changes are audited. Settings that affect history (norm pattern, rates) are **dated** (valid-from) instead of overwritten. [Observed: valid-from on norm time; rates pushed with confirmation] [Assumed]

## 3. Data

- **TenantSettings** (typed JSON with schema + version), **NumberSeries**, **InvoiceTemplate**, lists as separate tables with `active`, `sortOrder`. [Assumed]
- **AuditLog**: id, tenantId, at (UTC), actorUserId, actorType (`user|api_client|system`), action (`create|update|delete|status_change|login|export|reopen`), entityType, entityId, before JSON, after JSON (changed fields only), reason, requestId, ip. Append-only: DB role for the app has INSERT only on this table; rows hash-chained (`hash = sha256(prevHash + row)`) per tenant for tamper evidence. [Brief + Assumed]
- **ImportJob**: type, file, mapping, status (`uploaded|validated|committed|failed`), rows OK/errors, createdBy. [Assumed]
- **DataSubjectRequest**: personId, type (`export|erasure`), status, requestedBy, completedAt, outcome. [Assumed]

## 4. Actions & flows

- **CSV import**: upload (UTF-8/Windows-1252 autodetect, `;` or `,`) → map columns (saved mapping) → **validation preview** listing each row as create/update/error with messages → commit (all-or-nothing transaction) → result report downloadable. Matching keys: employee email/initials, customer CVR or customer no., project no. [Brief + Assumed]
- **Tenant onboarding**: create tenant → legal entity → admin user → wizard: departments, norm pattern (default Mon–Thu 7,5, Fri 7,0 = 37 h [Brief]), Danish holiday calendar, standard absence codes (Ferie, Feriefridag, Syg, Barns 1. sygedag, Afspadsering, Barsel, Orlov uden løn, Kursus), task types, approval flow, invite users. [Brief + Assumed]
- **Data subject export**: Admin selects person → job builds ZIP (JSON + CSV) with profile, entries, absences, expenses, receipts, audit entries about the person → download link valid 24 h. [Brief]
- **Erasure**: Admin selects person (must be inactive) → system shows what will be deleted vs pseudonymised → confirm with reason → executes. [Brief]

## 5. Business rules

- **R1 Audit scope**: every create/update/delete/status change of time entries, absences, expenses, invoices and lines, rates/price lists, budgets, payment plans, accounting periods, salary codes, employee cost/sales rates, role assignments; plus logins, exports, API-token creation. [Brief]
- **R2 Audit immutability**: no API to update/delete audit rows; retained ≥ 5 years after the fiscal year (Bogføringsloven). [Brief + Assumed]
- **R3 Finance corrections of approved entries** require a reason; audit shows before → after. [Brief]
- **R4 Numbering series**: next number can be edited only if no document has been booked in that series; never lowered. [Brief]
- **R5 Retention / erasure**: bookkeeping-relevant data (time entries linked to invoices, invoices, expenses, payroll lines) is retained 5 years from end of the fiscal year it belongs to; personal identifiers on them are **pseudonymised** (name → "Tidligere medarbejder #123", email/phone removed, comments cleared) instead of deleted. Non-bookkeeping personal data (competencies, profile photo, calendar imports, draft entries, personal settings, tokens) is deleted. After retention ends a nightly job deletes the remaining records. [Brief]
- **R6 Processing inventory**: maintained in `docs/gdpr/processing-inventory.md` and visible to Admin: purposes, categories (identity, employment, time/absence incl. sickness — sensitive context), recipients (accounting/payroll providers), retention, legal basis. Sickness codes visible only to the employee, their line manager, Finance/HR. [Brief + Assumed]
- **R7 Data hosting** in EU (Azure EU region); sub-processors listed. [Brief]
- **R8 Deactivating a user** revokes sessions and tokens immediately; historical data stays. [Assumed]
- **R9 Settings validation** with shared schemas; changes that would break invariants are refused (e.g. deleting an absence code in use → only deactivate). [Observed: create new code rather than change] [Assumed]

## 6. Edge cases

- Import row updates an employee who has approved entries → cost/sales rate changes require valid-from date; no retroactive change. [Assumed]
- Admin removes own Admin role → refused if last Admin. [Assumed]
- Erasure requested for active employee → refused; deactivate first. [Assumed]
- Erasure of a person who is PM on active projects → blocked until reassigned. [Assumed]
- Holiday calendar for next year missing → December warning to Admin; "copy & recompute movable holidays" action (Easter-based dates computed). [Observed: holidays not auto-copied] [Assumed]

## 7. Acceptance criteria

- **AC1** Given Finance changes an approved entry from 7,5 to 6,0 h with reason, Then the audit log contains actor, time, before 7,5, after 6,0 and the reason. [Brief]
- **AC2** Given any user incl. Admin, When attempting to modify an audit row via API or DB app role, Then it is refused. [Brief]
- **AC3** Given a CSV with 3 valid and 1 invalid row, Then the preview shows 1 error and commit is disabled until fixed or the row is excluded. [Assumed]
- **AC4** Given erasure of an inactive employee with invoiced entries from 2025, Then entries remain with pseudonymised name, comments cleared, and profile data deleted. [Brief]
- **AC5** Given a data export request, Then the ZIP contains all entries, absences and expenses of that person and nothing about others. [Brief]
- **AC6** Given a new tenant via onboarding, Then the default norm pattern is 37 h (7,5×4 + 7,0) and Danish holidays for current and next year exist. [Brief]
- **AC7** Given a numbering series with booked invoices, When Admin sets next number lower, Then refused. [Brief]

## 8. Open points

- Who are ARCnordic's admins and finance users initially?
- Retention: confirm 5 years + current fiscal year; ARCnordic fiscal year = calendar year?
- Should sickness absence be hidden from project managers (default yes)?
- Need for IP allow-list or MFA beyond Entra ID conditional access?
