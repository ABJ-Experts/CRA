# M3 SBOM parse validation and report lifecycle

## Scope and preserved contracts

- **User outcome:** an authorized manufacturer can see a bounded,
  deterministic validation report for each immutable SBOM source and upload a
  corrected version without overwriting the original evidence.
- **In scope:** CycloneDX/SPDX format detection, JSON/XML/SPDX tag-value
  validation, parser isolation in a worker thread, terminal validation report
  persistence, source history summaries, report download links to originals,
  and product-detail report controls.
- **Out of scope:** component/package normalization, dependency graph storage,
  license policy decisions, vulnerability matching, VEX, supplier attestations,
  semantic diffing, and any mutation of parsed package data.
- **Preserved:** M3 immutable intake, private `sbom-originals` storage,
  `/api/v1`, ES256/JWKS session validation, refresh-cookie path, deny-by-
  default auth, permission coverage, service-role organization scoping,
  transactional audit, and existing product/release contracts.

## Concrete problem

M3 intake proves that an SBOM file exists, is immutable, and has a durable job.
It does not tell a user whether the captured bytes are a supported CycloneDX or
SPDX document. Parsing in the API request would couple hostile input to the
Nest process and would make completion depend on synchronous validation. A
separate normalization store would be premature because M3 has no downstream
component owner yet.

The smallest useful boundary is therefore a deterministic parser/validator that
runs against verified original bytes, persists only a bounded report on the
existing ingest job, and leaves normalized package data uncreated.

## Selected patterns and dependencies

- **Parser isolation.** The ingest worker reads verified bytes from private
  storage, then calls `validateSbomInWorker`. The child worker owns JSON, XML,
  and tag-value parsing; the parent receives either a report or a retryable
  infrastructure failure. This keeps parser crashes and timeouts outside the
  long-lived worker process.
- **Vendored schema assets.** Supported CycloneDX and SPDX schemas live in the
  API validation asset tree and are loaded locally. Validation does not fetch
  network schemas, resolve XML external entities, or trust document-declared
  locations.
- **Bounded terminal report.** The report is a strict contract value:
  status, detected format/serialization/version, validator name/version,
  diagnostic counts, at most 100 diagnostics, omitted count, and completion
  time. It contains no bytes, signed URLs, storage keys, credential material,
  or normalized component rows.
- **Existing job as lifecycle authority.** `sbom_ingest_jobs` stores the
  validation status/report alongside the legacy completion result. The worker
  records the validation report before marking the job complete; if report
  persistence fails, the job remains leased and restartable rather than being
  falsely completed.
- **Report read model.** Source history returns per-source validation
  summaries. Report detail returns the source plus the bounded report. Both
  are tenant-scoped RPCs and return `404` for foreign or missing identifiers.

Dependency direction remains product UI -> typed SBOM API gateway -> Nest
controllers -> SBOM use cases -> repository/storage ports -> Supabase
RPCs/Storage. The worker uses the same repository/storage boundary and the
validator package; no React component or controller reads storage directly.

## Security invariants

- The original storage object is re-read and verified for key, hash, byte size,
  and media type before validation. A report never authorizes or substitutes a
  different object.
- XML validation rejects doctype declarations, entities, external resources,
  unsafe namespace changes, and oversized content before provider validation.
- JSON validation scans for hostile constructs before schema validation and
  rejects malformed or non-UTF-8 content before detection.
- Validation metadata mismatches are diagnostics, not authority. The detected
  format and version come from content, while declared metadata remains source
  provenance.
- All report writes go through an organization-scoped atomic RPC. The RPC
  checks job state, worker lease, report shape, terminal status/completion
  consistency, and audit insertion in one transaction.
- Cross-tenant source, job, release, download, and report reads are
  indistinguishable from missing data. Human routes require session
  permissions; CI upload routes remain the only public SBOM routes and use the
  credential guard.
- Diagnostic output is deterministic, sorted, counted, and bounded. Logs and
  audit rows carry IDs, status, counts, safe codes, and hashes, never document
  content, signed URLs, storage keys, or secrets.

## Lifecycle

1. A user or CI pipeline reserves and completes an immutable source through the
   M3 intake flow. Completion verifies storage and enqueues one durable ingest
   job.
2. The ingest worker claims one tenant-scoped job, checkpoints
   `verifying_original`, reads verified bytes, and starts the isolated parser
   worker.
3. Parser success returns a terminal validation report. Parser timeout,
   crash, or infrastructure failure returns a retryable unavailable result.
4. The worker checkpoints `recording_evidence`, records the validation report
   atomically, then marks the job complete. A persistence exception before
   completion leaves the lease recoverable.
5. Source history shows the latest source first with validation summaries.
   Report detail may be pending until validation finishes, then displays
   diagnostics and counts. Users can download the original if they still have
   view permission.
6. A corrected upload creates a new immutable source with
   `supersedesSourceId`; it does not alter the previous source, report, raw
   object, or audit facts.

## Operational flow

- Start the local CRA stack only. Do not reset the database for validation
  evidence. The one-shot worker command is safe for local E2E:
  `pnpm --filter api exec ts-node -r tsconfig-paths/register src/sbom-ingest-worker.ts --once`.
- If validation reports stay pending, inspect queued/leased
  `sbom_ingest_jobs`, local storage reachability, and worker logs. Retry by
  rerunning the one-shot worker or owner replay endpoint; do not mutate stored
  bytes.
- If a parser crash or timeout repeats, the job should remain retryable until
  max attempts and then enter `dead_letter` with a safe error code. The
  original evidence remains available for authorized download.
- If report shape validation fails, fix forward in the validator/RPC contract
  and replay. Do not hand-edit `validation_report` or create normalized package
  rows to patch a report.

## Tests and evidence

- Contract tests pin report shape, pending/terminal completion-time rules,
  diagnostic bounds, media-type/schema strictness, and source history response
  parsing.
- Validator tests cover the curated CycloneDX/SPDX corpus, deterministic
  output, UTF-8/BOM handling, unsafe XML rejection, oversized input, declared
  metadata mismatches, tag-value parsing, and bounded diagnostics.
- Worker characterization tests pin verified-byte validation, report-before-
  completion ordering, retryable storage/validator outages, and restartable
  leases when report persistence fails.
- Controller/service/auth tests pin Zod response schemas, permission metadata,
  human route session protection, CI public-route exceptions, and stable error
  envelopes.
- SQL/RLS tests must run without reset when the local Supabase stack is
  available. They cover private bucket/table grants, search paths, cross-
  tenant `404`, atomic validation audit, report secrecy, retry/replay, and
  storage immutability.
- Browser E2E uses unique local fixtures to upload valid and invalid SBOMs,
  run the one-shot worker, refresh the report, filter diagnostics, and upload a
  corrected immutable version while leaving unrelated data untouched.

## Rollback and recovery

Stop new workers and hide report UI to halt validation while preserving all M3
intake evidence. Existing immutable sources, jobs, reports, and audit facts
remain readable through forward-compatible contracts. Repair schema or parser
defects with additive migrations or code changes plus replay. Never overwrite
private objects, delete terminal reports to force a green state, or create
normalized component data as part of M3 validation recovery.

## Review checklist

- [x] Parser isolation has a current hostile-input and crash-containment
      trigger.
- [x] Validation reports are bounded, deterministic, and contract parsed.
- [x] XML, asset provenance, storage secrecy, and report output limits are
      explicit.
- [x] Report writes are tenant-scoped and atomically audited.
- [x] Completion remains restartable if report persistence fails.
- [x] Corrected versions add immutable sources instead of mutating old ones.
- [x] Tests cover contracts, parser corpus, worker restart/replay, API
      envelopes, permissions, SQL/RLS, and local E2E behavior.
