# Demo script — M0 Foundation

Everything below uses fictional data ("ARCnordic Demo ApS"). Dev password for every demo user: `demo1234`.

## Start

```powershell
pnpm install
pnpm db:up          # Postgres 17 in Docker
pnpm db:migrate     # schema + row-level security
pnpm db:seed        # demo company, 3 departments, 12 people
pnpm dev            # API http://localhost:4000, web http://localhost:3000
```

## Walkthrough (≈5 min)

1. Open http://localhost:3000 → you are redirected to **Log ind**. Note the ARCnordic wordmark, DA/EN switch, dev-login notice.
2. Try `lv@demo.arcnordic.test` with a wrong password → accessible error under the field (no hint whether the user exists).
3. Sign in as **Anne Lund** `al@demo.arcnordic.test` (line manager + project manager, Arkitektur).
   - Home: Danish date, ISO week, her roles, next Danish public holiday (computed, incl. Easter-based holidays).
   - Menu shows only what her roles allow; future modules are marked "Kommer snart".
4. **Medarbejdere** → Anne sees exactly herself and her three reports (Peter, Laura, Emil). This is enforced in the API, not the UI.
5. Switch to **EN** → the whole UI changes language; reload keeps the choice.
6. **Log ud**, then sign in as **Laura Vinther** `lv@…` (employee) → no "Medarbejdere" menu; `GET /api/v1/users` returns only Laura.
7. Sign in as **Karen Holm** `kh@…` (admin) → sees all 12 people.
8. Open http://localhost:4000/api/docs → generated OpenAPI documentation for `/api/v1`.
9. Keyboard only: on the login page use Tab / Enter to sign in — no mouse needed; visible red focus ring.

## What is verified automatically

| Check                                                                                             | Where                                |
| ------------------------------------------------------------------------------------------------- | ------------------------------------ |
| §9: 37,5 h vs 37 h norm → flex +0,5                                                               | `packages/domain/src/domain.test.ts` |
| §9: Wednesday holiday → norm 29,5 h                                                               | same                                 |
| §9: fixed price 240.000 kr, 98/200 h → 49 % → 117.600 kr                                          | same                                 |
| Tenant isolation (RLS), append-only audit log                                                     | `packages/db/src/rls.test.ts`        |
| Login, CSRF, logout, dev login off in production, people visibility per role, audited role change | `apps/api/src/app.test.ts`           |
| Browser flow incl. keyboard-only login                                                            | `e2e/m0-foundation.spec.ts`          |
