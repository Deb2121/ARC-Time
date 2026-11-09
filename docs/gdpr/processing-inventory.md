# Processing inventory (Fortegnelse over behandlingsaktiviteter) — ARCnordic Tid

Spec: docs/spec/administration.md R5–R7. Decision D-026. To be reviewed by the data controller (ARCnordic) before
go-live; legal basis and retention are proposals, not legal advice.

| Purpose                            | Data categories                                                                                                                  | People            | Legal basis (proposal)                                                | Recipients                              | Retention                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------- |
| Time registration and approval     | Identity (name, initials, e-mail), employment dates, hours, comments                                                             | Employees         | Employment contract (art. 6(1)(b))                                    | Line manager, project managers          | Bookkeeping-relevant: 5 years after fiscal year end |
| Absence, flex and vacation         | Absence type and hours. **Sickness = sensitive context**, shown as "Fravær" to anyone but the employee, line manager and Finance | Employees         | Employment law obligations (6(1)(c)); art. 9(2)(b) for health context | Line manager, Finance, payroll provider | 5 years (payroll-relevant)                          |
| Invoicing                          | Hours and names on invoice specifications                                                                                        | Employees         | Legitimate interest (6(1)(f))                                         | Customers, accounting system            | 5 years (Bogføringsloven)                           |
| Expenses and mileage               | Receipts, amounts, routes                                                                                                        | Employees         | Contract / legal obligation                                           | Finance, payroll/accounting             | 5 years                                             |
| Payroll export                     | Payroll number, absence days, mileage, reimbursements                                                                            | Employees         | Legal obligation (6(1)(c))                                            | Payroll provider                        | 5 years                                             |
| Resource planning and competencies | Planned hours, competencies                                                                                                      | Employees         | Legitimate interest                                                   | Managers, project managers              | Deleted on erasure                                  |
| Outlook calendar import (optional) | Meeting subject and times of the signed-in user (read-only)                                                                      | Employees         | Consent per user (connects themselves)                                | Nobody                                  | Import log 13 months; token ~1 hour                 |
| Audit log                          | Who changed what and when                                                                                                        | Users             | Legal obligation / legitimate interest                                | Finance, Management, Admin              | ≥ 5 years after fiscal year end; append-only        |
| Customer contacts                  | Name, e-mail, phone of customer contacts                                                                                         | Customer contacts | Legitimate interest                                                   | Project managers, Finance               | While the customer relationship lasts + 5 years     |

**Data subject rights** (built, D-026): Admin → Medarbejdere → _Hent alle persondata_ (JSON with everything about
the person and nothing about others) and _Slet personoplysninger_ for former employees (pseudonymises name, e-mail,
initials and payroll number, clears comments, deletes non-bookkeeping data; blocked while active, managing active
projects or having reports). A nightly job deletes expired sessions and tokens and reminder/calendar logs older than
13 months, and reports bookkeeping data past retention.

**Known limitations:** payroll files already generated keep the names they were sent with (they are the delivered
bookkeeping documents); audit-log snapshots are immutable and may contain names written at the time.

**Sub-processors (when hosted):** Microsoft (Azure hosting, Entra ID, Microsoft 365 mail), the chosen accounting
system (e.g. e-conomic) and payroll provider. All EU data processing to be confirmed in their DPAs.
