# M8-06 reviewable bulk intake and recipient-watermarked exports

## Scope and preserved contracts

- **User outcome:** an authorized uploader can review a bounded collection of
  evidence files independently, accept or correct deterministic filename-only
  class suggestions, and retry/cancel only the affected item. An authorized
  evidence manager can create, preview, and explicitly deliver a private,
  recipient/purpose/timestamp-watermarked derivative of a clean immutable
  version.
- **In scope:** maximum-20-item batches, maximum 250 MiB aggregate intake,
  per-item durable state/attempts/classification provenance, PDF/JPEG/PNG/WebP
  derivatives, private derivative storage, preview-before-delivery grants, and
  cleanup integration with M8-05.
- **Out of scope:** automatic class acceptance, content/AI classification, a
  generic job framework, unwatermarked fallback delivery, external email,
  DRM, Office/CSV/text transformations, original-byte changes, and a new role
  model.
- **Preserved:** the M8 single upload/reserve/finalize/scan flow, private
  verified evidence delivery, immutable versions, M2 retention projections,
  M8-05 holds/deletion lifecycle, M7 pinned-version references, `/api/v1`,
  existing permissions, auth cookies/JWKS, and the existing Evidence Library.

## Concrete problem and direct solution

One browser loop around the single-upload endpoint cannot retain a review
state across reload, isolate an item failure, protect a late completion after a
cancel, or prove which classification a user accepted. Similarly, returning a
signed URL for an original does not create a recipient-bound derivative,
preserve original integrity evidence, or enforce preview before release.

The direct alternative is client-only progress state plus a one-off file
transform in the controller. It fails on retry/restart, concurrent cancellation,
tenant audit, source replacement, storage/DB partial failure, and confidential
recipient/purpose handling. M8-06 therefore uses two focused durable workflows
only: a batch item/attempt state record and a watermark export/lease record.

## Selected and rejected patterns

- **Focused facade/use cases.** `EvidenceBulkIntakeUseCases` coordinates the
  existing signed-upload/inspection path and a tenant-scoped batch repository;
  `EvidenceWatermarkExportUseCases` coordinates export intent and application
  delivery grants. Each has one feature lifecycle and is removed if that
  lifecycle disappears.
- **Adapter ports at real external boundaries.** The existing evidence storage
  port remains the original-byte authority. A narrow watermark renderer and
  derivative-storage adapter exist because PDF/image rendering and private
  object storage have failure semantics that the application must not expose to
  pages/controllers. A Supabase repository implements atomic state/audit
  commands. No generic provider family or export bus is introduced.
- **Persisted state plus leased command records.** Batch items use
  `unconfirmed -> ready -> uploading -> scan_pending -> clean|quarantined|
  failed|cancelled`; attempts preserve immutable document/version/object-key
  history. Exports use `queued -> claimed -> ready|failed|cancelled`; a worker
  lease and idempotency digest survive restarts. These are focused state
  policies, not a generic workflow engine.
- **Deterministic filename suggestion policy.** The only V1 classifier is an
  immutable `filename_rules_v1` function. It sees NFC-normalized filename text,
  never unscanned document/OCR bytes. The database rechecks the suggested class
  and records `unconfirmed`, `accepted`, or `corrected` with actor/time.

Rejected: an AI gateway has no approved provider or trustworthy scanned-content
contract; client-side state cannot authorize a mutation; a generic export queue
would duplicate the one lease lifecycle; a direct Storage URL leaks a private
derivative and bypasses application access rechecks; modifying originals would
invalidate their integrity/signature evidence; and a new export permission
duplicates existing `can_manage_evidence` policy.

The selection follows [ADR-0001](adrs/ADR-0001-pattern-selection.md) and the
[pattern selection matrix](pattern-selection-matrix.md): Facade, Adapter,
focused State, and immutable command records have current concrete triggers.

## Data, tenant, and transaction boundaries

- Additive RLS-enabled/non-forced service-role tables retain batch, item,
  immutable attempt, watermark export, and derivative-grant facts. New foreign
  keys are organization-scoped and reference `public.users` where applicable;
  all functions pin `search_path`, revoke `PUBLIC`, and grant only
  `service_role`.
- A batch item durably retains the metadata needed by the existing reservation
  contract—client item id, item idempotency key, title, owner, product links,
  validity, filename and declared size—together with the filename-rule
  suggestion and acceptance/correction evidence. It must not reconstruct
  omitted metadata from the browser on initialize/retry.
- Each mutation accepts `organization_id` first, verifies active membership and
  the existing permission in the same transaction, and filters product, batch,
  item, document, version, source hash, export, grant, and object key by that
  organization. Cross-tenant IDs return the established safe denial without
  leaking a batch, recipient, purpose, filename, or export state.
- Batch creation binds the full descriptor digest to the actor-scoped batch
  idempotency key. Item initialization binds its selected class and decision to
  its own idempotency key. Cancellation locks the item and prevents a late
  finalization; it never makes a private object public. The existing inspect,
  finalize, scan-job, and scan transition remains the only upload promotion
  authority.
- An export intent locks/verifies active document lifecycle, product/version
  linkage, clean scan state, retained source hash/type, and M8-05 protection
  state before queueing. It stores recipient/purpose only as confidential table
  metadata, never in object keys, signed URLs, logs, or public response shapes.
  The worker rechecks source bytes/hash immediately before rendering and commits
  derivative metadata plus durable audit evidence before ready state.
- A derivative links to its original version/hash but has a separate
  hash/size/media type/object key. It is visibly labelled as a watermarked
  derivative; it never claims to preserve an original digital signature.
  M8-05 document cleanup revokes derivative grants and cleans derivatives only
  in the same confirmed cleanup workflow; a queued/claimed/failed/deleted
  document cannot create an export.

## API and presentation boundaries

- `@repo/contracts/evidence` owns strict feature schemas/types for batch
  creation/read/item initialize/complete/cancel/retry and watermark
  create/read/preview/delivery. Parsed types use `z.output`. Batch input is
  bounded to 20 files, 50 MiB each/250 MiB total, unique client IDs and unique
  per-item idempotency keys; output exposes exact total/pending/success/
  rejected/cancelled counts plus granular states.
- Initialization requires a class plus explicit `accepted`/`corrected`
  decision. A decision of `accepted` must equal the server-derived suggestion;
  `corrected` must differ. Complete/cancel use only their idempotency key;
  retry that creates a replacement carries renewed classification metadata and
  can never silently retarget an existing source version.
- Watermark create validates 1–160 NFC-normalized recipient/purpose values,
  rejects controls, and supports only PDF/JPEG/PNG/WebP. Preview and delivery
  have independent idempotency keys. Delivery is available only after that
  actor has an auditable preview, and returns a short-lived application delivery
  URL rather than a Storage URL.
- Nest controllers parse all params/bodies and parse successful responses. The
  evidence web gateway passes outgoing `inputSchema` and incoming `schema`.
  Bulk mutations require `can_upload_evidence`; watermark create, preview, and
  delivery require `can_manage_evidence`. Authenticated refresh never replays
  a mutation.
- Functional Evidence Library panels are code-split and follow the current
  compact operational table/form style. They expose per-file class review,
  progress, success/pending/rejected/cancelled counts, cancel/retry, source
  version pinning, watermark preview, explicit delivery, and validation/
  conflict/offline/retry states without dropping entered values. Untrusted
  filenames, OCR, and document content remain rendered text, never HTML.

## Failure modes, tests, and rollback

| Failure or edge case | Required result |
| --- | --- |
| Mixed files, one storage/scan failure, retry/reload | Per-item durable state and attempt history; unaffected files continue; no duplicate document/version for a replay. |
| Unconfirmed or altered suggestion | Initialize denied until an authorized explicit acceptance/correction; server recalculates filename rules. |
| Cancel during upload/finalize | Abort unfinished browser transfer, lock/mark item cancelled, reject late finalize, retain private bytes only. |
| Quarantine/tamper/expired or deleted source | Do not export; return a stable safe policy error and never issue unwatermarked bytes. |
| Unsupported/oversized/malformed PDF/image or missing renderer/font | Fail export with a bounded safe code; preserve original and keep no ready derivative. |
| Unicode/long recipient/purpose, rotation/multi-page source | Normalize/validate input; stamp every supported page/image readably; test orientation/page limits and output cap. |
| Retry, worker restart, source replacement, hold/deletion race | Pin export to source version/hash; use lease/idempotency/row locks; recheck immediately before render; no release after lifecycle block. |
| Partial derivative storage/DB failure | Keep no public grant; record retryable state; delete only an orphan confirmed by durable failure. |

Start with characterization tests for existing single upload/scan, M8-05
lifecycle blocks, and M7 historical-version links. Add schema, pure policy,
repository/controller, worker, and database/RLS tests for limits, duplicate
keys, aggregation, classification acceptance/correction, tenant/revoked access,
late finalization, scan results, source pinning, holds/deletion, preview before
delivery, confidential metadata, storage failure, and derivative cleanup. Run
focused tests, coverage (80% for changed modules), `pnpm verify`, generated
type/lint/live RLS suites, API auth tests, accessibility checks, and Playwright
against uniquely named local fixtures only.

Deploy expand/deploy/contract: migration and CLI-generated types first, then
API/workers, then code-split web panels. Rollback stops new claims/routes and
UI while preserving immutable originals, private derivatives, attempts,
recipient/purpose audit records, and no-public-grant state. It never deletes
evidence, opens access, or attempts a destructive migration rollback.

## Review checklist

- [x] Direct browser-loop and direct-original-download solutions were rejected
      for demonstrated state, audit, cancellation, and confidentiality gaps.
- [x] Selected patterns have present-tense triggers and focused contracts.
- [x] Single-upload scan/retention/access authority stays the source of truth.
- [x] Inputs/success responses use feature-first strict Zod schemas and
      `z.output` types.
- [x] Controllers/pages do not query Supabase or make tenant/authorization
      decisions.
- [x] Recipient/purpose never enter public URLs, object keys, or generic logs.
- [x] Original hashes/signatures and M7 source links remain immutable.
- [x] Deployment/rollback is additive and cannot mass-delete evidence.
- [x] Focused contract, API, web, database-contract, generated-type, lint,
      architecture, and local browser verification completed.
- [x] Local browser verification uses the configured `localhost` origin. Using
      `127.0.0.1` suppresses Next development hydration, so it is intentionally
      excluded from the reproducible browser command.
