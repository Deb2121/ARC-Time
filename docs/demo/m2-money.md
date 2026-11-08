# Demo script — M2 Money

Fictional data only. Password for all demo users: `demo1234`. Start with clean data:

```powershell
pnpm db:reset; pnpm db:migrate; pnpm db:seed
pnpm dev
```
The seed has already invoiced and closed **August and September** (invoices 1001–1013), so October/November are open
with uninvoiced work, due milestones and a retainer fee.

## Walkthrough (≈10 min) — as **Jonas Friis** `jf@demo.arcnordic.test` (finance)

1. **Prislister**: the standard list (rate per price group + catch-all), the municipality's framework list
   (supervision cheaper than design). The intro explains the 5-step order. Add a rate with a future _Gælder fra_ date
   (e.g. +4 % from 1 January) — it applies only to hours on/after that date.
2. **Fakturering → Faktureringsgrundlag**: per project the approved, billable, uninvoiced hours (value at the rate
   snapshotted at approval) plus due milestones / retainer fees. Choose grouping, tick a project, **Opret kladde**.
3. **Invoice draft**: lines show how many time entries they cover. ✎ a line and lower the amount → a reason is required;
   the write-down is spread exactly over the underlying entries (visible as "Reguleret fra …"). Add a text/heading/product
   line. **Vis faktura** / **Hent PDF** (with time specification appendix, KLADDE watermark).
4. **Bogfør** → confirm → gets the next number (no gaps, never reused) and becomes read-only. The hours disappear
   from the basis. Try editing → refused (also enforced by a database trigger).
5. **Opret kreditnota** → keep "Gør timerne fakturerbare igen" → book it → the hours are back in the basis.
6. **Regnskabsperioder**: August/September closed. October shows the checklist (unapproved timesheets) →
   **Luk måned** → **Luk alligevel**. The month-end report shows WIP on T&M, fixed-price completion with revenue
   recognised this month vs invoiced to date (incl. milestones invoiced before go-live), and retainer deferral.
   **Genåbn** the latest closed month with a reason (audited).
7. As **Laura** try to change hours in August → "Ugen er låst" (closed period).
8. As **Anne Lund** (project manager): open **26001 Lyngparken** → **Betalingsplan**: mark rate 3 _Klar til fakturering_.
   In Fakturering Anne sees only her own projects and can prepare drafts and mark them ready — only finance books.

## e-conomic (disabled by default)

Booked invoices put an `invoice.booked` event in the outbox. Without sandbox tokens and an enabled connection the
worker marks events _skipped_. To try against an e-conomic **sandbox** agreement only: set
`ECONOMIC_APP_SECRET_TOKEN` / `ECONOMIC_AGREEMENT_GRANT_TOKEN` in `.env` and enable the connection row for the tenant.

## Verified automatically

| Check                                                                                | Where                                                         |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| §9 an invoiced entry never appears in a new suggestion                               | `packages/domain/src/m2.test.ts`, `apps/api/src/m2.test.ts`   |
| §9 booked numbers never reused, no gaps — even when booking fails after numbering    | `apps/api/src/m2.test.ts`                                     |
| §9 editing in a closed period is refused                                             | `apps/api/src/m2.test.ts`                                     |
| Rate resolution order, specificity, valid-from                                       | `packages/domain/src/m2.test.ts`; framework rates in API test |
| Write-down spreading sums exactly; reason required                                   | domain + API tests                                            |
| Booked invoices immutable (API + DB trigger); held entries cannot be reopened/edited | API tests                                                     |
| Credited-back entries are never deleted (bookkeeping trail)                          | API test                                                      |
| e-conomic mapping and call sequence (fake fetch, no network)                         | `packages/integrations`                                       |
| Full flow register → submit → approve → invoice → close period                       | `e2e/full-flow.spec.ts`                                       |
