# Open questions for the product owner

Each has a default we will use if unanswered (recorded as [Assumed] in the specs). ★ = blocks the next phase.

## A. Project setup & technology
- ★ **OQ-01 Repo location** — The repo is in a OneDrive-synced folder. OneDrive + `.git` + `node_modules` is slow and can lock files. OK to keep docs here but put the working copy at e.g. `C:\dev\arcnordic-tid` with GitHub as source of truth? *Default: keep here, exclude build folders.*
- ★ **OQ-02 Language split** — TypeScript for web + API + domain rules, Python for workers (reports, exports, PDF, imports, payroll files)? Or a Python (FastAPI) backend? *Default: TS core + Python workers (D-002).*
- ★ **OQ-12 Dev machine** — Node.js 22 LTS, pnpm and Docker Desktop are not installed. Can we install them (may need IT)? *No default — needed for M0.*
- **OQ-03 GitHub** — Which GitHub org/repo for CI? Private repo under ARCnordic?
- **OQ-04 Hosting** — Is there an Azure subscription (EU region) we can use, and who owns it?
- **OQ-05 Internal tool or product?** — Is ARCnordic Tid only for ARCnordic, or should it later be sold to other firms? (Affects priority of multi-tenancy polish, billing, onboarding.) *Default: internal first, multi-tenant-ready.*

## B. Company facts (needed for seed config and defaults)
- **OQ-06 Legal entities** — One company (ARCnordic A/S?) or several? *Default: one, multi-entity in V3.*
- **OQ-07 Accounting system** — e-conomic, Dinero, Business Central, other? Sandbox access possible? *Default: e-conomic adapter first.*
- **OQ-08 Payroll provider** — Danløn, DataLøn, Zenegy, other? Monthly only, or also 14-day pay groups? Current salary-code list?
- **OQ-09 Numbering** — Continue existing invoice-, project- and customer-number series? Separate series for credit notes? *Default: one gap-free invoice series per legal entity incl. credit notes; project no. `YY` + 3-digit sequence (26001).*
- **OQ-10 SSO** — Microsoft Entra ID tenant: create users on first login (JIT) and map Entra groups to roles? *Default: JIT on, groups → roles mapping configurable.*
- **OQ-11 Brand guide** — Official logo files, colours, fonts? *Default: values from arcnordic.dk (crimson #CA0538, Open Sans, see docs/research/brand.md).*

## C. Time, absence, flex
- **OQ-13 Approval flow** — Line manager only, or project managers first then line manager? Week or month periods? *Default: line manager only, weekly.*
- **OQ-14 Closing rules** — Warn or block when a week is below norm? *Default: warn.*
- **OQ-15 Holidays & company days** — Is Grundlovsdag (half/full), 24 Dec, 31 Dec, the day after Ascension given as days off? *Default: none beyond statutory.*
- **OQ-16 Vacation** — Accrue monthly (2.08 days) per holiday act, or grant upfront? Days or hours? Feriefridage (how many)? *Default: monthly accrual in days, 5 feriefridage per calendar year.*
- **OQ-17 Flex & overtime** — Flex caps (e.g. +/−37 h)? What happens above the cap? Is overtime paid separately or all to flex? *Default: warnings at ±37 h, no hard cap, all to flex.*
- **OQ-18 Go-live balances** — Where will opening flex/vacation balances come from?
- **OQ-19 Time format & timer** — Decimal (1,50) or hh:mm display? Timer rounds to nearest 0.25 h (min 0.25)? Future-dated hours allowed? *Default: decimal; nearest quarter; future up to 0 days for work, absence any future date.*
- **OQ-20 Approver edits** — May approvers edit hours, or only reject? *Default: reject only.*
- **OQ-21 Sickness privacy** — Show sickness as "absent" (not the reason) to colleagues/PMs? *Default: yes, reason visible only to employee, line manager, HR/Finance.*
- **OQ-22 Who approves people without a manager** (e.g. CEO)? *Default: a designated admin approver.*

## D. Projects, rates, planning
- **OQ-23 Task types / phases** — Should architecture/engineering phase models (e.g. the Danish ydelsesbeskrivelse phases) be a default template?
- **OQ-24 Rates** — Which rate roles exist (e.g. partner, architect, engineer, constructor, student)? Do rates differ by task type? Framework agreements with own price lists? Block approval when no rate is found? *Default: warn, do not block.*
- **OQ-25 Indexation** — Yearly rate increase practice (date, %)?
- **OQ-26 Fixed price** — Count non-billable hours toward completion? *Default: yes (all hours on the contract's tasks).*
- **OQ-27 Retainers** — Flat fee or consumption-based? Overuse billed automatically as T&M or PM decision? *Default: PM decision.*
- **OQ-28 Planning** — Weekly or daily granularity? Planning day = 7.4 h or 7.5 h? Block over-booking above e.g. 120 %? *Default: weekly, 7.4 h, warn only.*
- **OQ-29 CRM** — Is a pipeline wanted, or is CRM elsewhere (e.g. HubSpot)? *Default: customers/contacts only until V3.*

## E. Money & finance
- **OQ-30 Invoicing workflow** — "Ready for booking" step by PM on by default? Send invoices from ARCnordic Tid or only via the accounting system? Reminders (rykker) here or in accounting? *Default: step on; send via accounting system; reminders in accounting.*
- **OQ-31 Payment terms** — Standard terms (e.g. netto 30, løbende måned + 30)? *Default: netto 30.*
- **OQ-32 Public sector** — Many public customers (EAN/OIOUBL)? If yes, move OIOUBL from V3 to V2. (ARCnordic's references include municipalities and housing associations.)
- **OQ-33 Write-down reasons** — Fixed list of reason codes or free text? *Default: list + free text.*
- **OQ-34 Month close** — When and by whom is the month closed? Allow late approvals in closed periods? *Default: Finance closes by working day 5; late approvals land in next open period.*
- **OQ-35 Expenses** — Approval steps? Receipt always required? Company cards (import transactions)? Reimbursement via payroll or bank file? Default markup on expenses and customer price per km? Per diems used? *Default: line manager → Finance; receipt required above 0 kr; via payroll; markup 0 %.*
- **OQ-36 Mileage/VAT** — Finance to confirm statutory mileage rates and VAT deductibility rules before go-live (example values in specs are illustrative).

## F. Reporting & admin
- **OQ-37 KPIs** — Which KPIs and targets does management follow? Utilisation = billable ÷ norm (default) or ÷ capacity? Include WIP in T&M margin? Is Power BI used?
- **OQ-38 Admins** — Who are the first admin and finance users?
- **OQ-39 Retention** — Confirm 5-year bookkeeping retention; fiscal year = calendar year?
- **OQ-40 Security** — IP allow-list or extra MFA requirements beyond Entra ID?
- **OQ-41 SharePoint** — Project folders structured by project number? Link only, or create folders automatically?
- **OQ-42 Other systems** — Anything else to connect (e.g. Jira, document management, HR system)?
