# Integrations & API (Integrationer og API)

Release: M0 — Entra ID OIDC SSO, REST API skeleton with OpenAPI, PATs. V2 — e-conomic adapter (sandbox), outbound webhooks,
Graph calendar import, reporting API/OData, OAuth client credentials. V3 — Dinero, Business Central, payroll adapters, Google SSO
(optional earlier), SharePoint/OneDrive links. Tags: [Observed] / [Assumed] / [Brief].

## 1. Purpose & roles
Connect ARCnordic Tid to identity, accounting, payroll, calendar and file systems through a uniform adapter layer, and expose a
versioned API for customers' own integrations. All external connections are optional, **disabled by default**, and developed only
against official sandboxes/test accounts. [Brief]

| Role | What they do |
|---|---|
| Admin | Enables/configures connections, SSO, webhooks, API clients. [Brief] |
| Finance | Maps accounts/VAT codes, monitors sync log, retries failures. [Assumed] |
| Employee | Connects own Outlook calendar (consent), creates personal access tokens if allowed. [Brief] |

## 2. Screens / views
1. **Integrations overview**: cards per available adapter with status (`disabled|configured|connected|error`), last sync, errors. [Assumed]
2. **Connection setup**: credentials/consent flow, test connection, mapping tables (customers ↔ debtor no., VAT codes, accounts, products/item numbers, departments/dimensions), sync options. [Observed: item numbers mapped to GL accounts] [Assumed]
3. **Integration log**: per event: time, adapter, direction, entity, status, attempts, error message, payload (redacted), retry button. [Observed: integration log report]
4. **SSO settings**: provider, tenant/client IDs, allowed domains, JIT provisioning on/off, default role, group → role mapping. [Brief]
5. **Webhooks**: endpoints, subscribed events, secret (shown once), delivery log, test ping, disable. [Brief]
6. **API clients & tokens**: OAuth clients (client id, scopes, secret rotation); personal access tokens per user (name, scopes, expiry, last used, revoke). [Brief + Observed: PATs]

## 3. Data
- **IntegrationConnection**: id, tenantId, legalEntityId (nullable), type (`economic|dinero|business_central|danloen|dataloen|zenegy|graph_calendar|sharepoint`), status, config (non-secret), secretRef (key vault reference, never stored in DB plain), enabled (default false), lastSyncAt. [Brief]
- **ExternalRef**: tenantId, connectionId, entityType, entityId, externalId, lastSyncedHash. [Assumed]
- **Outbox**: id, tenantId, eventType, aggregateId, payload, createdAt, status (`pending|done|failed|dead`), attempts, nextAttemptAt, lastError. Written in the same DB transaction as the business change. [Brief: outbox pattern]
- **Webhook**: id, tenantId, url (https only), events[], secretRef, active, failureCount. **WebhookDelivery**: webhookId, eventId, status, responseCode, durationMs, attempt. [Brief]
- **ApiClient** / **PersonalAccessToken**: hashed secret (argon2id), scopes[], expiresAt, lastUsedAt, createdBy. [Brief]
- **CalendarImportCandidate**: userId, eventId, start, end, subject, organizer, suggestedProjectId/taskId, state (`new|imported|ignored`). [Assumed]

## 4. Adapter interface [Brief + Assumed]
```ts
interface IntegrationAdapter {
  type: AdapterType;
  capabilities: Set<'pushCustomers'|'pushInvoices'|'pullPayments'|'pushJournal'|'pushPayroll'|'readCalendar'|'linkFiles'>;
  connect(config, secrets): Promise<ConnectResult>;     // OAuth / token exchange
  test(): Promise<HealthResult>;
  sync(event: OutboxEvent): Promise<SyncResult>;          // idempotent per event id
  pull?(since: Date): Promise<PullResult>;                // e.g. payment status
  mappings(): MappingSpec[];                              // drives the mapping UI
}
```
Adapters live in `packages/integrations`; long-running pulls and payroll/PDF jobs may be Python workers (D-002) using the same contract over the job queue.

## 5. Business rules
- **R1 Disabled by default**; enabling requires Admin and a successful `test()`. Production credentials can only be entered by the tenant's Admin; dev/staging uses sandbox credentials from env/secret store. [Brief]
- **R2 Outbox delivery**: worker polls pending events, calls adapters/webhooks, exponential backoff (1 min, 5, 15, 60, 6 h, then `dead` after 8 attempts), alerts Admin on dead events; manual retry from log. Idempotency key = outbox event id. [Brief + Assumed]
- **R3 e-conomic (first)** [Brief]:
  - Push customers (create/update debtor; CVR, EAN, address, payment terms, currency) on customer save or first invoice.
  - Push booked invoices as booked invoices (number from ARCnordic Tid, lines with product/account mapping, VAT codes, PDF attached if supported); credit notes likewise.
  - Pull payment status (remaining amount) every 4 h and on demand → updates invoice paidAmount/status.
  - Never renumber in the accounting system; if the target refuses our number, the event fails and Finance resolves.
- **R4 Dinero (second)** same capabilities as R3 where its API allows; **Business Central** V3. [Brief]
- **R5 SSO (Entra ID OIDC)**: authorization code + PKCE; validate issuer/tenant, audience, nonce; map by immutable `oid` claim (not email). JIT provisioning: if on, first login creates an Employee with default role in "Unassigned" department, pending Admin completion; if off, login refused unless pre-created. Optional group → role mapping. Local email/password login only in development builds. Google SSO optional (V2/V3). [Brief]
- **R6 Graph calendar import**: delegated scope `Calendars.Read` only (read-only), per user consent; user sees events for a chosen week, picks events, maps to project/task (remembered per subject/organizer rule), events become **draft** time entries rounded to 0,25 h; already imported events are marked; nothing is ever written back. [Brief]
- **R7 SharePoint/OneDrive**: projects store links (URL + title) to folders; optional picker via Graph `Files.Read` — no file content copied. [Brief]
- **R8 Webhooks**: events `time_entry.approved`, `timesheet.approved`, `timesheet.rejected`, `expense.approved`, `invoice.booked`, `invoice.credited`, `invoice.paid`, `period.closed`, `project.created`, `project.updated`, `employee.created`. Payload: event id, type, tenant, occurredAt, data (ids + key fields, no personal comments). Signature header `X-ArcTid-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`; receivers should reject > 5 min skew. At-least-once delivery; 2xx within 10 s = success. Auto-disable after 50 consecutive failures. [Brief + Assumed]
- **R9 REST API**: base `/api/v1`, JSON, OpenAPI 3.1 generated from code (schemas shared with validation), cursor pagination, `If-Match`/ETag for updates, problem+json errors, ISO dates, money as `{ amount: øre (int), currency }`, hours as decimal string. Breaking changes → `/api/v2`. [Brief]
- **R10 Auth for API**: PAT (user context, scopes ≤ user's rights) and OAuth 2.0 client credentials (service context, scopes, tenant-bound). Same RBAC checks as UI. [Brief + Observed: employee REST with PATs; server-to-server API]
- **R11 Rate limiting**: per token 600 requests/min, per IP 1200/min for unauthenticated auth endpoints stricter (10/min login); `429` with `Retry-After`. [Brief: rate limiting] [Assumed: numbers]
- **R12 Reporting API (V2)**: read-only OData v4 endpoint over fact views for Power BI, service-token auth, incremental refresh by `modifiedAt`. [Brief + Observed: read-only reporting API for Power BI]
- **R13 Secrets** in env/secret store (Azure Key Vault in prod), never logged; payloads in integration log redacted. [Brief]

## 6. Edge cases
- Customer deleted/merged in accounting system → push fails with "not found"; Finance remaps via ExternalRef. [Assumed]
- Token expiry/revoked consent → connection `error`, Admin notified, events stay pending (not lost). [Assumed]
- User's Entra account disabled → login refused; employee record remains (history). [Assumed]
- Email changed in Entra → matched by `oid`, email updated. [Assumed]
- Calendar event spanning midnight or all-day → all-day ignored by default; spanning split per day. [Assumed]
- Webhook receiver slow → timeout counts as failure; retries keep order not guaranteed — consumers must use event id + occurredAt. [Assumed]

## 7. Acceptance criteria
- **AC1** Given a new tenant, Then all integrations are disabled. [Brief]
- **AC2** Given e-conomic connected (sandbox), When invoice 1042 is booked, Then an outbox event is stored in the same transaction and the invoice appears in the sandbox with number 1042; on failure the log shows the error and retry works without duplicates. [Brief]
- **AC3** Given Entra SSO with JIT off, When an unknown user logs in, Then access is refused with a clear message. [Brief]
- **AC4** Given a PAT for an employee, When calling GET /api/v1/time-entries?employeeId=<other>, Then 403 unless manager/PM/Finance. [Brief §9]
- **AC5** Given a webhook, Then each delivery carries a valid HMAC signature verifiable with the shared secret. [Brief]
- **AC6** Given Graph consent, Then only `Calendars.Read` is requested and imported events become draft entries. [Brief]
- **AC7** Given > 600 requests/min on one token, Then 429 with Retry-After. [Assumed]
- **AC8** OpenAPI document at `/api/v1/openapi.json` validates and covers every public endpoint (CI check). [Brief]

## 8. Open points
- Which accounting system does ARCnordic use today (e-conomic assumed)? Sandbox/developer agreement access?
- Entra ID: allow JIT provisioning, and map Entra groups to roles?
- SharePoint: are project folders already structured per project number (for auto-linking)?
- Any other systems to integrate (CRM, document management, Jira)?
