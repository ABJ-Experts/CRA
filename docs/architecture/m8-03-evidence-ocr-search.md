# M8-03 evidence OCR and permission-scoped search

## Scope and preserved contracts

- **Outcome:** authorized users can see durable local extraction progress and
  search clean evidence text within one product. This covers FR-EVD-005 and
  FR-EVD-014.
- **In scope:** local text/OCR extraction, durable leased jobs, version/hash
  provenance, current-version search by default, explicit historical search,
  snippets, retry, and accessible Evidence Library states.
- **Out of scope:** organization/global search, vectors, AI conclusions,
  translation, cloud OCR, and changes to M3 SBOM storage or M8 delivery.
- **Preserved:** `/api/v1`, ES256/JWKS and cookie paths, permission merge order,
  immutable evidence versions, existing upload/viewer flows, product navigation,
  and service-role organization-first boundaries.

## Concrete problem and selected patterns

Extraction cannot be synchronous with upload: scanned PDFs can be slow,
malformed, encrypted, or unavailable to local binaries, and a process restart
must not lose progress. A direct mutable text column on a version also violates
the M8 immutable version record.

- **Derived text + leased-job pair:** a version-linked text row and one durable
  job isolate mutable derived state from evidence facts. The scan completion
  RPC enqueues the pair and audit fact in one transaction. Row locks, source
  hash/extractor snapshots, leases and bounded attempts make retry/restart
  idempotent. Remove the job table only if the database platform supplies the
  same durable, observable lifecycle.
- **Focused local extractor adapter:** `LocalEvidenceTextExtractorAdapter`
  accepts a digest-guarded stream, writes it into a random private temporary
  directory, then runs bounded parsers. It is a real OS/binary boundary, so it
  remains an adapter rather than controller or worker logic. No network or
  shell invocation is permitted.
- **Database search policy:** product membership, active tenant/user,
  permission, clean/hash/validity/current-version eligibility are joined before
  matching, ranking, facets, counts or snippets. PostgreSQL `simple` FTS and a
  partial GIN index are sufficient for V1; vectors and extension dependencies
  have no demonstrated requirement.

Dependency direction is functional React -> typed evidence gateway -> Nest
controller -> application use case/port -> Supabase or local adapter. Pages and
controllers never query Supabase; workers only call database RPCs and adapters.

## Data, tenancy and API boundaries

- Every service-role RPC takes `organization_id` first and verifies active
  membership and the established custom-role/override-aware permission helper.
  Product, document, version, and source hash are scoped in the same query.
- `evidence_document_version_texts` stores source hash, extractor version,
  normalized bounded text, FTS vector, visible status and safe failure label.
  `evidence_document_extraction_jobs` stores the queue/lease/retry state. Both
  have RLS enabled, no browser grants, and FKs to the tenant/version.
- Clean scan and enqueue are atomic. Completion rejects a lost lease or changed
  hash/extractor snapshot, so an old worker cannot overwrite a newer index.
  Existing clean versions are queued additively. Quarantined, expired, archived,
  inaccessible, or integrity-mismatched rows are excluded at query time.
- Contracts live in `@repo/contracts/evidence`, with Zod query/body/path and
  success schemas. The API owns an opaque, fingerprinted keyset cursor; the
  database only receives decoded rank/timestamp/version values. Browser calls
  validate outgoing mutation bodies and all success responses.

## Local extraction and failure behaviour

TXT/CSV are normalized directly; OOXML reads bounded XML entries using `yauzl`.
PDF native text uses `pdftotext`; raster/PDF OCR uses local `pdftoppm` and
`tesseract`; images are pixel-limited through `sharp`. `spawn` uses no shell,
has fixed arguments, command and total deadlines, maximum pages/output/pixels,
and always removes the temporary directory.

Malformed, encrypted, image-bomb, timeout, empty, low-quality, storage, or
missing-binary cases record safe extraction failure/unavailable status. They
never yield an empty successful index or cloud fallback. Evidence preview and
download remain governed by M8-02 and work while OCR is down. Extracted content
is untrusted text: snippets are control-normalized React text segments, never
HTML, links, commands, prompts, or compliance assertions.

## Tests, observability and rollout

Focused contract tests cover bounds and metadata; worker/adapter tests cover
verified input, unavailable parsers and completion; SQL tests assert RLS,
grants, FTS/index, current/history and stale job predicates; UI tests cover
safe rendering, loading, failure and retry. Operational logs report safe job
outcomes and worker failure categories only, not extracted text or paths.

Deploy in expand order: migration and CLI-generated types, API/web, then a
non-root worker provisioned with explicit local Poppler/Tesseract paths.
Rollback stops the worker and removes the new routes/UI; the additive derived
rows remain retained and prior code ignores them. The remaining deployment
prerequisite is local binary provisioning, deliberately surfaced as
`unavailable` rather than silently egressing content.

## Review checklist

- [x] Synchronous extraction was rejected for a demonstrated durable lifecycle gap.
- [x] Version content remains immutable and derived state is tenant-scoped.
- [x] Input/output boundaries use shared Zod schemas and parsed output types.
- [x] Authorization is applied before all search selection and aggregate work.
- [x] Extraction failures are explicit; unavailable is not reported as no results.
- [x] Rollback is additive and non-destructive.
