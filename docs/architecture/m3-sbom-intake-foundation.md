# M3 SBOM intake, immutable evidence, and durable job foundation

## Scope and preserved contracts

- **User outcome:** an authorized organization member or scoped CI pipeline can
  submit an SBOM once, retain its original bytes immutably, and follow one
  durable `sbom.ingest` job to a truthful terminal state.
- **In scope:** release-bound direct uploads, immutable original evidence,
  organization-scoped CI credentials, durable intake jobs, retry/replay,
  transactionally durable audit facts, private download, product-release UI,
  and the worker foundation that verifies captured bytes.
- **Out of scope:** CycloneDX/SPDX semantic parsing, component normalization,
  advisory matching, scoring, diffs, VEX, supplier portal, binary analysis,
  source scanning, and firmware reverse engineering.
- **Preserved:** `/api/v1`, API error envelopes, ES256/JWKS session validation,
  refresh-cookie path, frozen auth-action signatures, deny-by-default route
  coverage, permission resolution order, mock ordering, existing release
  contracts, and product-detail navigation behavior.

## Concrete problem

The product import and security-update-artifact flows already demonstrate that
browser bytes must not traverse a Nest controller, Storage URLs must remain
transient, and provider verification needs a worker lifecycle. They do not
provide a general ingestion job with cross-principal idempotency, a scoped CI
credential, or a release-bound immutable SBOM source. A controller upload or
browser-managed queue would couple HTTP availability to 100 MiB payloads and
would lose progress after a refresh or process restart.

## Why not simpler?

A direct `POST` of the file to the API plus one mutable `product_releases`
column cannot retain exact originals, verify content after a browser disconnect,
deduplicate callbacks, prevent tenant storage-key tampering, or safely resume
work after a worker restart. Reusing `product-imports` would impose a 10 MiB
CSV-oriented policy, while reusing `security-update-artifacts` would conflate
legal update distribution with SBOM intake and its lifecycle. The smallest
authoritative model is a private SBOM bucket, immutable raw-object/source rows,
one feature job row, and CI-credential rows.

## Selected patterns

- **Focused inward storage port.** The SBOM application owns reservation,
  inspection, signed upload/download, and cleanup contracts because Storage has
  an immediate provider lifecycle and the worker is a second concrete caller.
  A Supabase adapter implements the port; no controller or React component
  imports the client. Remove the port only if a supplied platform storage API
  replaces both upload and worker verification.
- **Reservation and finalize state machine.** A source starts
  `upload_pending`; only a locked completion transaction can make it
  `verified`, link immutable raw evidence, and enqueue work. Mismatch and
  expiry transition to `rejected` and `expired` respectively. This separates a
  successful object PUT from a successful application fact.
- **Durable feature job.** `sbom_ingest_jobs` is required because M3 has a real
  retry, lease, progress, dead-letter, and restart lifecycle. A worker claims
  one eligible organization per scheduling round with `FOR UPDATE SKIP LOCKED`;
  the database enforces the per-tenant active-job limit. The job boundary is
  removable when an existing shared durable queue takes over the exact lease
  and progress guarantees.
- **Pure validation and authorization policies.** Filename, media-type, hash,
  byte-size, request-digest, retry-delay, and CI-token parsing are immutable
  functions. Nest guards supply verified principal identity; browser-selected
  organization state is never authority.

Dependency direction is functional React section -> typed `SbomsApi` gateway
-> thin Nest controller/guard -> SBOM use case and policies -> repository and
storage ports -> Supabase RPCs/Storage adapter. Worker entry -> same SBOM use
case/ports. The UI and controllers never query Supabase directly.

## Rejected patterns

- A generic evidence, generic queue, or event bus is rejected: this release
  has only one concrete SBOM lifecycle and existing generic audit/outbox tables
  do not provide its lease and status semantics.
- API-proxied multipart uploads are rejected because large upload availability
  and retries would consume the API process and weaken reconnect behavior.
- Client-provided object keys, overwrite uploads, or delete-and-replace content
  are rejected because none can prove tenant ownership or immutable evidence.
- The existing asynchronous `AuditService` is not authoritative for these
  facts: it deliberately swallows persistence failure. SBOM security facts are
  inserted by the completion/failure/replay RPC transactions instead.
- A browser timer, in-memory queue, or unbounded worker loop is rejected
  because it cannot survive restart or fairly schedule tenants.

## Data and tenant boundaries

- The global session guard resolves actor and membership; the CI credential
  guard resolves a single active credential and its organization. The release
  is always fetched with the verified organization ID first; a foreign release
  returns `404` before reservation, Storage signing, or persistence.
- `sbom_raw_objects` stores an organization-scoped content identity
  (SHA-256, byte count, canonical media type, bucket/key) and has no update
  path. `sbom_sources` holds release, original source kind, actor identity,
  idempotency/request digest, safe display filename, server-generated staging
  key, expiry, and source status. `sbom_ingest_jobs` stores one source job,
  organization, actor identity, correlation ID, idempotency key, input hash,
  stage/progress, lease, attempts, and terminal result or safe error. Scoped
  `sbom_ci_credentials` retain only credential metadata plus salt/hash, never
  the secret.
- Every service-role repository operation accepts `organizationId` first and
  applies it to releases, sources, raw objects, jobs, credential rows, and
  audit rows. RLS remains defense in depth. New RLS policies are enabled but
  not forced; broad grants are revoked and explicit RPC grants include
  `service_role` after `PUBLIC` revocation.
- The completion RPC locks the source, rechecks actor/credential authorization,
  verifies declared metadata against inspection output, upserts only an exact
  immutable content identity, links the source, inserts exactly one job, and
  inserts `upload_completed`, `source_linked`, and `job_queued` audit facts in
  one transaction. Mismatch writes `hash_mismatch` and no job. Failure/replay
  uses corresponding transactional audit facts. Audit metadata holds IDs,
  hash, size, source kind, safe status/error code, and never bytes, URLs,
  filename-derived paths, credential secret, or token.
- Idempotency uniqueness is actor-scoped and organization-scoped. The stable
  request digest makes a repeated key with altered metadata a conflict, while
  a byte-identical repeat returns the same source/job without a duplicate raw
  object, job, or audit side effect. Concurrent completion is serialized by
  the source lock.
- Migrations are additive: private `sbom-originals` bucket and tables/indexes/
  RLS/functions/grants, generated types, API/worker, then UI. Security-definer
  functions pin `search_path = public, pg_temp`. A previous application can run
  during each expand step.

## API boundary contracts

- Runtime contracts and parsed `z.output` types live feature-first in
  `@repo/contracts/sboms`. They include manual and CI initialization/
  completion, source/job/credential paths, source and job resources, signed
  instructions, original downloads, owner credential management, and replay.
- Upload input accepts only `application/json`, `application/xml`, `text/xml`,
  `application/octet-stream`, and the supported CycloneDX/SPDX vendor media
  types. It requires lowercase 64-character SHA-256, UUID idempotency key,
  safe NFC filename, and an integer byte size `1..104857600`. Unknown fields,
  paths, control characters, zero bytes, oversized input, and unsupported
  media types fail before a signed URL is issued.
- Session/API initialization sets `manual_upload`; the CI guard forces
  `ci_upload`. Internal future paths may use `integration`, `supplier`, and
  `generated` only after their own verified source boundary. Completion accepts
  an opaque source ID and idempotency key, returns `202` plus a job/progress
  resource, and never accepts a storage key or result supplied by the caller.
- Controllers parse every parameter/body/query with Zod pipes and declare every
  success with `@ZodResponse`. `SbomsApi` provides outgoing `inputSchema` and
  incoming response `schema`; only its upload helper uses `XMLHttpRequest` for
  progress against the returned temporary Storage URL.

## Lifecycle and failure behavior

1. Initialization validates permission, organization-scoped release, exact
   metadata, and idempotency before a reservation transaction writes
   `upload_initiated`. The storage adapter signs a unique server-owned key with
   `upsert: false` and a short expiry. If signing fails, the pending reservation
   remains retryable and no object is declared successful.
2. The client PUTs directly. A disconnect after PUT leaves only a pending
   source; a later same-key completion or retry safely inspects the exact key.
   Expired and used signed instructions cannot authorize a different key.
3. Completion streams Storage bytes, calculates SHA-256, checks exact length
   and permitted/matching media type, then invokes the atomic finalization RPC.
   Storage success followed by database failure leaves an invisible pending
   source that completion may safely retry. Database success cannot precede the
   job insert because they are one transaction.
4. The worker claims a durable queued or expired-lease job. It persists progress
   before original verification and evidence recording. It retries retryable
   outages at most five times with capped exponential full jitter (15 minutes),
   and marks exhausted work `dead_letter`. It only reports `completed` after
   re-verifying retrievability/hash and recording
   `original_evidence_captured`; it does not imply parsed or normalized SBOM.
5. Worker restart leaves leases recoverable. Per-tenant active-job limits and
   round-robin claims prevent a large tenant starving other organizations.
   Owner-only replay creates a new safe lease transition and audit fact, never
   silently rewrites terminal history.
6. Permission/CI credential revocation before completion fails closed and
   cannot enqueue. Already queued evidence remains durable. Authorized source
   download verifies the current same-organization permission, then produces a
   short attachment URL; already-issued URLs expire naturally.

## Frontend logic and rendering

- Product-release SBOM panel and Organization Administration credential panel
  are functional React components using existing semantic tokens, `cn()`,
  design-system controls, labels, alerts, focus rings, and reduced-motion
  behavior. The current Evidence Control Room visual language remains the
  authority.
- `SbomsApi` is the only stateful `.ts` gateway. It owns HTTP/schema parsing
  and its injected central API client; the upload-progress helper owns the
  XMLHttpRequest lifecycle. React Query owns query keys, invalidation and
  polling. Display policies remain pure functions.
- The panels render loading, empty/no release, read-only, client validation,
  forbidden, direct-upload progress, queued, processing, retryable/provider
  degradation, failed, dead-letter, retry/replay, and completed states.
  Concealment is presentation only; every server action reauthorizes.

## Tests and observability

- Start red with contract tests for zero byte, 100 MiB boundary, media type,
  lowercase hash, idempotency, unsafe filename, strict unknown fields, CI
  source forcing, signed URL response, job terminal invariants, and credential
  label. Preserve characterization tests for auth, refresh, permission merge,
  API envelopes, menu parity, and product releases.
- Add unit/use-case tests for request-digest replay, source state transitions,
  actor revocation, inspection mismatch, transient signing/storage/database
  outage, and jitter bounds. Add controller/API tests for Zod parsing, `202`,
  cross-tenant `404`, no token leakage, and owner-only credential/replay routes.
- Add SQL/RLS/live tests for every constraint/index/grant/search path, atomic
  audit facts, identical raw-object linkage, duplicate/concurrent callback,
  foreign release/key tampering, leases, retry/dead-letter/replay, crash
  recovery, and fair tenant scheduling. Add browser E2E using a run-scoped
  owner release and non-destructive local fixtures only.
- Emit structured identifiers, counts, stage/status, retry attempt, and safe
  error code. Exclude raw bytes, signed URLs, object keys, token/secret values,
  and full document content. Require 80% branch/function/line/statement
  coverage for new/materially changed modules.

## Rollback

Stop SBOM API mutations and workers to halt rollout; leave additive schema,
immutable objects, source/job history, and audit facts intact. Revert API/web
code independently while keeping the prior system compatible with the added
tables and private bucket. Correct a database or policy defect with a forward,
idempotent migration and replay, never destructive rollback or object
overwrite. Staging-object expiry cleanup may remove only unverified expired
keys after ownership checks; verified raw evidence is never deleted by this
feature.

## Review checklist

- [x] Direct multipart/mutable-column options were rejected for concrete
      availability, integrity, tenant, and restart failures.
- [x] The storage port and durable worker have present-tense lifecycle triggers.
- [x] Tenant/actor identity is verified server-side and every service operation
      is organization-scoped.
- [x] Controllers/pages do not access Storage or Supabase directly.
- [x] Feature schemas and parsed `z.output` types cover requests and successes.
- [x] Completion, job creation, and security audit facts are transactionally
      durable.
- [x] The rollout is additive and forward-repairable while preserving existing
      auth, RBAC, release, cookie, and navigation contracts.
