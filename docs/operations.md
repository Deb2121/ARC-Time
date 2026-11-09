# Operations — hosting, backup, mail and the repository (D-027)

Status 2026-11-09: ARCnordic Tid runs **locally only** (D-017). That is fine for testing with fictional data. Before
real hours, invoices and payroll go in, the four points below must be decided and done. Nothing here is set up
automatically; each step needs the product owner (and, for Azure, whoever owns the subscription).

## 1. Hosting (OQ-04) — proposal

| Part       | Proposal                                                                   | Why                                                |
| ---------- | -------------------------------------------------------------------------- | -------------------------------------------------- |
| Region     | Azure **West Europe / North Europe** (EU)                                  | Spec R7: data in the EU                            |
| Web + API  | Azure Container Apps (two containers: `web`, `api`) + one for `analytics`  | Same build as locally; scales to zero at night     |
| Database   | Azure Database for PostgreSQL – Flexible Server 17, zone-redundant off     | Managed patches, **point-in-time restore 35 days** |
| Secrets    | Azure Key Vault (SESSION_SECRET, Entra secret, SMTP, e-conomic tokens)     | Never in the repo or .env on a laptop              |
| Files      | Azure Blob Storage for receipts (today `data/uploads`)                     | Durable, backed up, not on a server disk           |
| Sign-in    | Microsoft Entra ID (already built, D-012); dev login **off** in production | One login, MFA from the company tenant             |
| Monitoring | Azure Monitor / Application Insights on API errors and the nightly jobs    | Someone notices when reminders or the outbox stop  |

Estimated running cost for ~15 users: a few hundred kroner a month (smallest Postgres tier + Container Apps
consumption). Go-live checklist: production `.env` values in Key Vault → `pnpm db:migrate` against the new database
→ `ALTER ROLE arc_app/arc_analytics PASSWORD …` (the dev passwords in migrations must not be used) → import real
customers/projects/employees (Import page) → set opening balances → switch DEV_LOGIN_ENABLED off.

## 2. Backup and restore

**Locally (now):** `Start-ARCnordic-Tid.cmd` takes a backup once a day before migrating (`backups/`, newest 14
kept). VS Code tasks: _Tag backup_, _Gendan seneste backup_ (asks for confirmation and takes a safety backup first),
and _Nulstil demo-data_ now backs up before wiping. Restore was verified into a throwaway database (identical row
counts). `pnpm db:reset` still deletes everything — that is its purpose — so never use it on real data.

**Production:** rely on the managed Postgres point-in-time restore (35 days) plus a weekly `pg_dump` to Blob
Storage kept 12 months. Test a restore every quarter into a separate database and write down the date.

## 3. E-mail

Reminders (D-020) need SMTP. In production use the company's Microsoft 365: either SMTP AUTH on a dedicated
mailbox (e.g. `tid@arcnordic.dk`) or Microsoft Graph `sendMail` with an app registration. Set `SMTP_HOST`,
`SMTP_PORT`, `MAIL_FROM` (Key Vault). Locally, Mailpit (`localhost:1025`, inbox on `:8025`) shows what would be sent.

## 4. Move the working copy out of OneDrive (OQ-01)

`.git` and `node_modules` inside OneDrive cause locked files and slow syncing. GitHub is the place the code is kept;
OneDrive is not needed for it. Steps (5 minutes, nothing is lost because everything is pushed):

```powershell
# 1. Stop the app (Ctrl+C) and make sure everything is pushed
cd "C:\Users\<you>\OneDrive - ARCnordic\Skrivebord\ARCnordic Time"; git status; git push
# 2. Clone a fresh working copy outside OneDrive
mkdir C:\dev; cd C:\dev; git clone https://github.com/Deb2121/ARC-Time.git arcnordic-tid
# 3. Copy the local, untracked settings and backups
copy "C:\Users\<you>\OneDrive - ARCnordic\Skrivebord\ARCnordic Time\.env" C:\dev\arcnordic-tid\
robocopy "C:\Users\<you>\OneDrive - ARCnordic\Skrivebord\ARCnordic Time\backups" C:\dev\arcnordic-tid\backups
# 4. Open C:\dev\arcnordic-tid in VS Code and run the task "Start ARCnordic Tid" (installs packages the first time)
```

The Docker database is not in the folder (it lives in a Docker volume), so the demo data stays. When the new copy
works, delete the old OneDrive folder (or keep only `docs/` there if colleagues read documents in OneDrive).

## 5. Continuous integration

GitHub Actions (`.github/workflows/ci.yml`) runs lint, typecheck, migrations + drift check, seed, all unit and
integration tests (TypeScript and Python), a production build of the web app, and the Playwright E2E suite against
it. A red build must be fixed before more is merged.
