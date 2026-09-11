# CRA-M3-02 Parse and Validate SBOMs

## Goal

Extend M3-01 immutable SBOM ingestion so supported CycloneDX and SPDX documents
are detected from content, parsed safely, validated deterministically, persisted
as one bounded versioned report per existing job, and displayed through the
existing API and web layers. Raw evidence remains immutable; no normalized
component or finding graph is created.

## Global constraints

- Preserve `/api/v1`, M3-01 raw-object immutability, RBAC, tenant isolation,
  cookies, JWKS verification, API error envelopes, and menu parity.
- Every service-role query takes `organizationId` first and scopes every
  operation. Cross-tenant identifiers return `404`.
- Keep `sbom_sources.status = verified` as evidence integrity. Persist
  `pending`, `valid`, `valid_with_warnings`, or `invalid` as validation state
  on the existing ingest job/report only.
- Do not add a report table or write normalized components/findings.
- Parse and serialize cross-app values with feature-owned `@repo/contracts`
  Zod schemas; preserve existing strict `SbomJob` response shape/stages.
- Run untrusted parsing in a worker thread after raw storage integrity is
  verified. Deny XML DTD/entity/schema-location inputs before any XML schema
  validator. No network schema resolution.
- Fixed ceilings: 100 MiB bytes; depth 256; 1,000,000 tokens/nodes; 1 MiB
  scalar values; 128 attributes per element; 64 KiB total attributes; 100
  diagnostics; 30-second worker timeout.
- Validator unavailability, crashes, and timeouts are retryable infrastructure
  failures, never validation success or invalid content.
- A corrected input is a new immutable source linked through
  `supersedesSourceId`; dead-letter replay stays for transient recovery.
- Never use or mutate hosted MCP project `hrywyeidbwywmaudvcnr`; only local
  project id `cra` may be used for local live verification. Do not reset or
  delete development data.
- Test first and keep changed modules at 80% branch/function/line/statement
  coverage. Use functional React, central API client, existing Operate-mode
  design-system primitives and semantic tokens.

## Task 1: Lock validation contracts and compatibility

Files:

- Create `packages/contracts/src/sboms/schemas/sbom-validation.schema.ts`
- Create `packages/contracts/src/sboms/types/sbom-validation.type.ts`
- Modify `packages/contracts/src/sboms/schemas/index.ts`,
  `packages/contracts/src/sboms/types/index.ts`, and
  `packages/contracts/src/sboms/schemas/sbom.schema.ts`
- Test `packages/contracts/src/sboms/schemas/sbom-validation.schema.spec.ts`

Requirements:

- Define `SbomValidationStatus` as `pending | valid | valid_with_warnings |
  invalid` and strict report/diagnostic runtime schemas. A diagnostic has
  `severity`, `code`, `location`, `message`, and `remediation`; report has
  nullable detected format/serialization/spec version and validator metadata,
  bounded diagnostics, counts, omitted count, and nullable completion time.
- Add optional upload-init `declaredFormat`, `declaredSpecVersion`, and
  `supersedesSourceId` as untrusted comparison metadata.
- Add strict schemas and parsed `z.output` types for release-scoped source
  history pagination and source validation-report retrieval. Do not change the
  legacy `SbomJob` success response.
- Permit declared `text/plain` alongside existing M3-01 accepted media types.
- Test terminal states, severity preservation, 100 diagnostic cap, omitted
  count, strict rejection, and output types; tests must start red.

## Task 2: Implement bounded, deterministic validators

Files:

- Create `apps/api/src/sboms/validation/sbom-validator.ts`,
  `sbom-validation-worker.ts`, `sbom-validation-policy.ts`,
  `spdx-tag-value-parser.ts`, `schema-manifest.ts`, and vendored
  `assets/…`
- Modify `apps/api/package.json` and lockfile
- Test `apps/api/src/sboms/validation/*.spec.ts` and curated fixtures

Requirements:

- Add direct, pinned Ajv/Ajv-formats, saxes, selected official CycloneDX XML
  validator and pinned native peer. Vendor official CycloneDX 1.4/1.5/1.6 and
  SPDX 2.2/2.3/3.0 assets with upstream URL/tag or commit/SHA-256/internal
  validator version manifest.
- Curated valid corpus: CycloneDX 1.4/1.5/1.6 JSON and XML; SPDX 2.2/2.3 JSON
  and tag-value; SPDX 3 JSON.
- Content-first sniffing handles UTF-8 BOM, JSON/XML/tag-value, CycloneDX root
  version, SPDX 2 `spdxVersion`, SPDX 3 JSON-LD markers. Extension, MIME, and
  declared mismatch produce warnings—not errors.
- Reject malformed or non-UTF8 input, unsafe XML DTD/DOCTYPE/entity/schema
  location/external resource/namespace inputs, prototype-like JSON keys,
  extreme numeric literal, duplicate BOM/SPDX IDs, missing required SPDX
  namespace, unsupported/missing versions, all configured limit breaches, and
  SPDX 3 non-JSON serialization with stable diagnostics/remediation.
- Sort diagnostics by location, severity, then code. Same bytes and validator
  version yield deep-equal report values.

## Task 3: Extend persistence and worker flow

Files:

- Create a CLI-generated migration under
  `apps/infrastructure/supabase/migrations/`
- Modify `apps/api/src/sboms/application/sbom-intake-use-cases.ts`,
  `infrastructure/supabase-sbom.repository.ts`,
  `infrastructure/supabase-sbom-storage.adapter.ts`,
  `worker/sbom-ingest-worker.ts`, and `sbom.module.ts`
- Regenerate infrastructure and API database types with `db:types`
- Test SQL and ingest worker paths

Requirements:

- Write failing SQL tests first for raw immutability, report constraints,
  source-version link, org access/grants, audit facts, invalid terminal report,
  and absence of normalized writes.
- Add only needed columns: immutable same-release source supersession and
  declared comparison metadata; job validation status, detection, validator
  metadata, bounded report JSON, and timestamp.
- Create org-scoped source list/report RPCs and transactionally durable
  `record_sbom_validation_atomic`. It locks claimed job, scopes organization,
  persists report/audit without raw bytes, storage keys, signed URL or creds.
- Add `readVerified`: recheck hash/size while returning bytes without another
  complete download. Worker sequence is claim → verify bytes → isolated
  validate → atomically record report/audit → complete current M3-01 job.
- Preserve old completed jobs and `original_evidence_captured`; failures in
  validator provider return through existing retry/dead-letter flow.

## Task 4: Add API report endpoints and durable web views

Files:

- Modify `apps/api/src/sboms/sbom.controller.ts`, `sbom.service.ts`
- Modify `apps/web/app/_features/sboms/sboms.api.ts`, `sboms.keys.ts`,
  `sboms.queries.ts`, and
  `apps/web/app/(workspace)/products/sbom-intake-section.tsx`
- Tests controller, API, queries, and intake section

Requirements:

- Add parsed/authenticated `GET /api/v1/products/:productId/releases/:releaseId/sbom-sources?limit=&cursor=`
  and `GET /api/v1/sbom-sources/:sourceId/validation-report`, guarded by
  `can_view_sboms`, using `@ZodResponse`, `zodParams`, `zodQuery`; foreign IDs
  must be indistinguishable `404`.
- Central `SbomsApi` gateway only: parsed input and response; no direct
  Supabase in React/shared UI. Replace local-only job history with server
  backed source/report queries.
- Unknown browser MIME/extension uploads remain uploadable as declared
  `application/octet-stream`; actual parser detection is content-first.
- In existing Evidence Control Room UI add concise states and panels for source
  results/reports: detected type/version, immutable hash, status, accessible
  counts/filter, diagnostic location/code/message/remediation, bounded notice,
  download, and corrected-version upload. Cover loading/empty/processing/
  forbidden/read-only/degraded/retryable/terminal invalid/valid-with-warnings/
  valid/completed with keyboard/focus/responsive behavior.

## Task 5: Verify, review and collect local E2E evidence

Files:

- Create fixtures and `apps/web/e2e/sbom-validation.spec.ts`
- Create `docs/architecture/m3-sbom-parse-validation.md`

Requirements:

- Add characterization tests for preserved M3-01 completion, cookie/JWT,
  permission coverage and error envelopes before worker behavior changes.
- Run focused contracts, corpus, worker restart/replay, repository/controller,
  SQL/RLS, and web suites. Run database lint/live tests without reset where
  Docker/Supabase is available, then lint/check-types/architecture/test/build.
- Independent correctness/security review must cover XML isolation, asset
  provenance, cross-tenant 404, report bounds, storage secrecy, deterministic
  output, and atomic audit.
- Start only local CRA stack. Playwright uses owner seed account to upload valid
  and invalid uniquely named fixtures, refresh/filter report, upload a corrected
  immutable version, and collect desktop/mobile screenshots; no unrelated data
  is removed.
