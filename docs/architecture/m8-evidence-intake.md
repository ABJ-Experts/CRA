# M8 evidence intake, metadata, and quarantine

## Scope and preserved contracts

- **User outcome:** an authorized member can upload product-applicable evidence,
  retain an immutable original, and use it only after a durable server-side
  inspection and malware scan report it clean.
- **In scope:** metadata, taxonomy, private direct upload, immutable versions,
  hash/type/size verification, durable scan and notification work, quarantine,
  product retention projection, and M7 readiness evidence.
- **Out of scope:** OCR, extraction, public sharing, supplier portal, SBOM
  changes, AI classification, and bulk-upload UX.
- **Preserved:** `/api/v1`, auth cookies/JWKS verification, permission merge
  order, M3 SBOM contracts/storage, M7 source-link behaviour, and the existing
  product workspace navigation.

## Concrete problem and selected patterns

M3 proves that a browser upload and a database fact are separate failure
domains. It is release-specific and cannot safely represent document metadata,
multi-product applicability, malware provenance, or document versions. A
single mutable file column would permit overwrite, lose the original digest,
and cannot recover from a scanner outage.

- **Focused storage/scanner adapters:** Evidence owns small ports for signed
  private storage and ClamAV streaming; Supabase and ClamAV are infrastructure
  implementations. Remove a port only if the platform exposes the same
  lifecycle directly.
- **Reservation/finalize state machine:** one server-generated object key moves
  `uploading -> scan_pending -> clean|quarantined|failed`; no terminal version
  is rewritten. The completion RPC binds inspection, job, and audit facts.
- **Durable feature worker/outbox:** scan leases, backoff, expiry cleanup, and
  owner notifications survive process restart. This is required by a real
  asynchronous scanner lifecycle; no generic bus is introduced.
- **Existing retention projection and M7 readiness projection:** the evidence
  use case consumes the established product retention projection and extends
  M7 with one explicit `evidence_document` source kind rather than duplicating
  product-retention or technical-file logic.

Dependency direction is functional React -> typed Evidence gateway -> thin
Nest controller -> evidence use cases/policies -> ports -> Supabase/ClamAV.
Workers call the same inward use cases. Controllers, pages, and shared UI do
not access Supabase.

## Data, tenant, and API boundaries

- The global guard supplies verified actor/organization identity. Every
  service-role query/RPC receives and filters by `organization_id` first;
  product and owner references must be active members of that organization.
- Documents retain logical identity; versions retain immutable metadata,
  product links, original bucket/key/digest/type/size, uploader, scan
  provenance, and retention projection. At least one product is required.
- All taxonomy values map explicitly to `evidence_document`; strongest product
  retention, incomplete retention, and legal hold prevent cleanup/deletion.
- Reservation, completion, scan transition, audit row, and detection outbox
  are transactional. `AuditService.log` is not used as the authoritative fact.
  Idempotency keys are actor/organization scoped and bind a request digest;
  altered replays conflict, exact replays return the prior reservation.
- Contracts live under `@repo/contracts/evidence`. Each controller parses
  params/body/query with Zod and declares parsed success responses. The web
  gateway supplies both outgoing `inputSchema` and incoming `schema`.

## M8-02 version access and verified delivery

- A replacement locks the logical document row, compares the caller's expected
  current version ID, and appends a new version number. It never rewrites an
  older object key, hash, size, metadata, or version-pinned reference. The
  row lock gives concurrent successful replacements deterministic ordering;
  stale callers receive a conflict without losing entered metadata.
- Preview and download authorization creates an opaque, actor-bound five-minute
  application grant. The URL is not a Supabase Storage URL. At redemption the
  authenticated actor, active organization, product applicability, clean and
  non-expired version state, and grant expiry are checked again. Issuance and
  byte-delivery-start are separate durable audit facts, including a correlation
  ID and each valid byte range.
- The application obtains private bytes and verifies full SHA-256, byte size,
  and detected media type before it sends bytes. A mismatch fails closed,
  records an integrity audit/outbox fact in the same database transaction, and
  blocks the version. This protects against object tampering after scan; a
  stored digest alone is not treated as immutable storage proof.
- Only PDF, JPEG, PNG, and WebP can be delivered inline. The delivery response
  is same-origin with `no-store`, `no-referrer`, `nosniff`, restrictive CSP,
  safe content disposition, and no active HTML/SVG preview. Attachment grants
  remain attachments even if the browser can render the media type.
- A copied grant is not an authorization bypass: normal session, tenant, and
  permission revocation are rechecked at redemption. Already-started browser
  responses cannot be revoked mid-stream, so the short TTL limits new starts;
  browser receipt after bytes leave the server is not observable.

## Lifecycle and failure behaviour

1. Initialize validates permissions, owner/product membership, title, class,
   validity, and idempotency. It reserves one private `upsert: false` object
   for fifteen minutes.
2. Complete streams actual bytes, computes SHA-256/size, validates magic and
   strict type policy, then atomically queues scanning. Browser claims,
   extensions, and MIME are never authoritative.
3. PDF, DOCX, XLSX, PPTX, CSV, and UTF-8 text are limited to 50 MiB. Generic
   archives, executables, malformed/polyglot content, macros, encrypted files,
   unsafe ZIP paths, and decompression-limit violations fail closed. No content
   is extracted.
4. Scanner transport failure, timeout, or unavailable ClamAV leaves a version
   pending with durable backoff; it never creates a clean result. Detection
   quarantines it, records safe provenance, and queues an owner-only email with
   no attachment. Clean evidence remains available during scanner outages.
5. Only clean, current, non-expired versions can download or become M7 source
   evidence. A quarantine, new version, or validity expiry makes the M7 link
   stale with the established reason codes.

## Frontend, tests, and rollback

The product Evidence Library is functional React using current semantic tokens,
compact tables, accessible forms, text-plus-icon status, and recoverable
validation/conflict/offline states. Entered metadata survives a recoverable
upload error. Download/link controls are unavailable until a clean result.

Start with contract and policy tests, then storage/scanner test doubles,
transaction/RLS SQL tests, hostile-file fixtures, gateway tests, and Playwright
journeys against the local development server. Test cross-tenant IDs, revoked
membership, idempotency races, storage/database partial failure, scanner/mail
outages, retention/legal holds, and clean-only access. Run architecture gates,
focused suites, and non-destructive local checks; shared local data is never
reset.

Rollback is additive: stop the worker and remove navigation/permission grants.
Private evidence remains retained and inaccessible; no destructive migration or
object cleanup is performed as rollback.

## Review checklist

- [x] Direct mutable upload was rejected for a demonstrated lifecycle gap.
- [x] No request, user, tenant, or session state is global.
- [x] Boundary parsing and transactional security facts are explicit.
- [x] Controllers/pages do not query providers directly.
- [x] Existing M3, M2, M7, auth, and permission contracts remain additive.
