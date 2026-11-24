# Demo script — Sagsøkonomi, faktureringsplan og debitorliste

For the finance team (≈15 min). Fictional data only ("ARCnordic Demo ApS"). Password for all demo users: `demo1234`.
Start the app with **Start-ARCnordic-Tid.cmd** (or the VS Code task "Start ARCnordic Tid") and open
http://localhost:3000. If the demo database was made before this module, run `pnpm db:migrate` and `pnpm db:seed`
once. They add the instalment shares, ekstraarbejde, payments and a reminder to the existing data.

What the demo data contains:

- Fast honorar cases: 26001, 26003, 26006, 26008 and the retainer 26005.
- Medgået tid cases: 26002, 26004, 26007, 26009.
- 26008 has an ekstraarbejde phase.
- One instalment is klar.
- Invoice 1006 is partly paid, the invoices due a month ago are overdue, and 1008 has had its 1st reminder.

## 1. Sagsoversigt (≈4 min) — as Jonas Friis `jf@demo.arcnordic.test` (Finance)

1. Open **Økonomi → Sagsøkonomi**. The cards show active cases, what can be invoiced now (approved uninvoiced hours
   plus ready instalments), the number of ready instalments and the cases at risk.
2. Every case shows its honorarform (**Fast honorar** / **Medgået tid**) and status. Point out:
   - **Kan faktureres** on medgået tid cases with approved, uninvoiced hours (the "Ikke faktureret" column).
   - **Honorar overskredet** in red, with "… % af honorar forbrugt" under the fee and remaining fee.
   - **Rate klar** on the retainer.
3. Filter **Honorarform = Medgået tid**. The totals row ("I alt (n sager)") always sums the rows shown.
4. Click a column heading to sort by it. Then click **Eksportér til Excel**: you get the same rows and filters, with
   a totals row.
5. Tab **Rater klar til fakturering** lists every instalment ready to invoice across cases.

## 2. A fixed-fee case (≈5 min) — still as Jonas

1. Click **26008 Søholm Friskole**. The banner shows how much of the fee is consumed, and the tiles show hours (and
   cost), forbrugt, faktureret, ikke faktureret and the remaining fee.
2. **Faseøkonomi:** budget, hours and forbrugt per phase. Phase 3 is **Ekstraarbejde**. Its hours are invoiced as
   medgået tid and do not eat the fee, which is why "Ikke faktureret" is not 0 on a fixed-fee case.
   **Markér som ekstraarbejde** on another phase moves it (this can't be done once hours on it are invoiced).
3. **Faktureringsplan:** rate 1 is Faktureret, rate 2 is Planlagt.
   - **Redigér plan** → **Tilføj fase som rate** (e.g. Myndighedsprojekt) → enter shares.
   - The sum line turns green at exactly 100 %. Only then can **Gem som aktiv** be used. **Gem som kladde** works any
     time.
   - Explain the rule: a rate becomes **Klar** when the previous one is invoiced and its date has passed, or when the
     project manager closes the linked phase.
4. **Timer pr. medarbejder** and **Fakturahistorik** (with paid / outstanding per invoice).
5. Open the case with the ready instalment (see the tab from step 1.5). Click **Fakturér rate**. A draft with one
   line is created; open it under Fakturering. When it is booked the rate turns **Faktureret** and the next one
   follows the rule. (Delete the draft again to keep the demo data unchanged.)

## 3. Debitorliste (≈4 min) — still as Jonas

1. Open **Økonomi → Debitorliste**. The ageing cards show Udestående i alt, Ikke forfaldent, 1–30, 31–60, 61–90 and
   over 90 days.
2. Default view is **Kun ubetalte**:
   - 1006 is **Delvist betalt**, still with the days overdue.
   - The invoices due a month ago are **Forfalden 11 dage** (the number depends on today's date).
   - 1008 shows **1. rykker** with its date.
3. **+ Betaling** → full amount or a partial payment with a date. The status and the outstanding amount change at
   once.
4. **+ Rykker** registers the next reminder (1st, 2nd, 3rd, in order). The letters themselves are phase 2.
5. Switch to **Kun forfaldne** / **Alle**, and filter by customer, case or project manager. **Eksportér til Excel**
   takes the filters along.
6. Explain: once the e-conomic integration is switched on (sandbox tokens), the button **Hent betalinger fra
   e-conomic** reads payment status from e-conomic. Until then payments are registered here.

## 4. Who sees what (≈2 min)

1. As **Anne Lund** `al@…` (project manager): Sagsøkonomi and Debitorliste show only the cases she manages. There
   are no payment or reminder buttons.
2. As **Laura Vinther** `lv@…` (employee): the module is not in the menu.
3. As **Karen Holm** `kh@…` (management): everything is visible, read-only.

## Questions to take back

- What did "I den [?] skal man kunne se forbrugte pengebeløb" mean (OQ-43)? The module covers all three readings:
  kroner consumed, a totals row, and invoiced amounts.
- Are the thresholds right: warning at 75 %, alert above 100 %? Is the status order right (OQ-44)?
