# M11-05 Jira remediation synchronization design

## Scope and preserved contracts

Jira Cloud V1 links a finding to one owner-approved project/issue type and records external work state. ServiceNow remains V2. Existing M5 remediation anchors, VEX approval, regulatory decisions, sessions, permissions, and `/api/v1` paths are unchanged. External closure is review context only.

## Concrete problem and simplest boundary

The M11-05 draft exposed an authenticated endpoint that accepted caller-asserted Jira events and generated fictional issue IDs in `sync_vulnerability_remediation_ticket_atomic`. A direct API call to Jira without a durable reservation would duplicate issues after a timeout. The minimum safe boundary is a product-scoped binding, a durable pending operation, a focused Jira REST adapter, and a verified webhook that refetches issue state.

## Selected and rejected patterns

- The existing connector vault owns the Jira scoped service-account token and webhook secret in one strict encrypted JSON value. The ticket feature owns its narrow provider adapter; the product/release `ConnectorPort` and worker are not stretched into ticketing.
- A database reservation and attempt ledger are required by provider creation timeout and duplicate requests. They are not a generic command bus or event platform. Remove this ledger only if provider creation becomes transactionally idempotent with CRA storage.
- Browser requests call functional React and a parsed gateway; thin Nest routes call application policy; the infrastructure adapter calls Jira and tenant-first Supabase RPCs. The domain never imports a provider SDK.

## Data and tenant boundaries

Session identity supplies `organizationId` and actor ID. Owner binding stores stable CRA product, connector, cloud, Jira project, issue type, field authority, and status ID mappings. Each service-role RPC takes organization ID first and checks membership, product, connector, binding, and finding scope. A webhook path binding ID is only a lookup hint; raw-body HMAC and live Jira issue refetch establish provider identity. Credential and binding revisions fence workers after access changes.

Reservation, command audit, and idempotency commit atomically. Provider creation is outside that transaction: it sets a correlation issue property during creation, then finalization binds the returned stable issue ID. A timeout remains uncertain until bounded reconciliation or owner intervention; it never triggers a blind second create. Unknown status IDs, moved projects, revoked credentials, and concurrent edits become conflicts. Out-of-order delivery cannot overwrite a newer provider observation.

New create operations carry a durable protocol version and delay worker reconciliation by five minutes while the API sends the first request. Immediately before the Jira POST, an actor-scoped RPC records that a create might occur. A definitive Jira 400, 401, 403, 404, or 422 response records a terminal no-create result; only these results, or a worker-confirmed pre-POST interruption, permit an owner to reserve a fresh create. Legacy operations, timeouts, 429, 5xx, and malformed responses remain uncertain and fenced. Each safe retry searches the original ticket correlation before sending another POST.

The reservation response carries the persisted operation creation time inside its internal ticket JSON. The worker context RPC returns the binding and ticket in the same parsed shape consumed by the repository. Correlation search uses a conservative date bound because Jira JQL interprets dates in the service account timezone; incomplete bounded results stop the retry for operator review.

## API and UI boundaries

Feature-first Zod contracts under `@repo/contracts/vulnerabilities` parse binding, preview, create/sync, replay, path parameters, and successful responses. A preview contains only approved summary, description, target project/issue type, and context digest. The first create requires that digest and explicit CRA user action. Linked-ticket UI shows pending, linked, error, conflict, external closure pending review, last sync, correlation, and authorized replay. Secret values and evidence/report bodies never enter the browser or Jira issue property.

## Failures, verification, and rollback

Jira 401/403 marks revoked access; 429 honors `Retry-After`; timeouts and 5xx leave durable pending/error state. Provider outages do not block findings, reporting, or evidence. Tests cover forged signatures, tenant substitution, duplicate and old delivery, timeout/restart reconciliation, issue move/delete, unknown statuses, real database concurrency, and accessible browser states. Run focused coverage, `pnpm verify`, local CRA live-stack tests, and Playwright screenshots. A live Jira Cloud sandbox journey is a release gate, not something local fixtures can prove.

Apply the additive schema with ticket paths disabled, then deploy code and enable after migration and local database checks. The old local draft created three zero-row tables and four functions without a migration-ledger entry; reconcile this exact drift before applying forward changes. Rollback disables Jira routes/workers and retains linked tickets and audit for later reconciliation; never reset unrelated data.
