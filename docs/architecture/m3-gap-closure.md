# M3 gap closure design

## Scope and preserved contracts

Close evidence-backed gaps against FR-SBOM-001–016 at milestone-1 `d5d1d05`. Preserve M1/M2/M4–M10, immutable originals and assessments, scoped supplier grants, `/api/v1`, ES256/JWKS, refresh cookies, permissions, schemas and existing worker jobs. Local CRA only; no resets, production changes, commits or pushes. No replacement SBOM engine or new persistence is planned.

## Concrete problem

The streaming ingestion path bypasses the existing validation worker; XML publication has no awaited chunk boundary. Browser hashing buffers entire files; upload attempts rotate command identities after lost responses. Source history ignores its pagination cursor. Normalized CycloneDX/SPDX export is missing. Top-level dependency labels imply completeness that the declared graph cannot establish. These findings require characterization and failure tests before fixes; additional audit findings must be evidenced before expanding scope.

## Why not simpler?

Reuse the existing normalization/validation policies, durable ingestion jobs, immutable graph, cursor queries, source reservation and download boundaries. Fix shared functions rather than adding a parallel pipeline. Export reads the current authorized immutable normalized graph and reviewed VEX; never fabricate absent provenance or conformity. Retention remains owned by M1/M2/M8. No table is needed for a read projection or portable export.

## Selected patterns

Existing gateway, application facade and inward-owned storage/repository ports remain. Deterministic policies handle validation, serialization and retry identity. Existing worker leases/checkpoints handle restart. Pagination provides bounded history and graph reads. Export uses the existing response/download conventions; its contract and format limitations must be explicit. New abstractions require a present caller and a test seam.

## Rejected patterns

No generic export bus, replacement queue, alternative normalized store, custom identity provider or speculative vendor integration. No legal completeness claim inferred from one declared graph edge. No full-file browser buffering or automatic POST replay.

## Data and tenant boundaries

Verified session or existing server-resolved CI/supplier grant supplies organization, actor and product/release scope. Service-role queries remain explicitly scoped. Partial parse failure retains originals and an invalid report, never a completed partial graph. Retry reuses exact unchanged command identities and detects changed metadata. Historical source records remain immutable and accessible through bounded pagination. Any necessary migration is CLI-created, additive, locally verified, type-generated and reviewed before application; prefer existing columns/FKs.

## Lineage integration audit

The final FR-SBOM-008 audit found that the existing diff worker still treated version changes as unresolved even though M4 now supplies ecosystem comparators. Reuse those comparators through a focused adapter; compare exact canonical package identities and keep unsupported or ambiguous versions unresolved. New reports identify the installed comparator policy. Preserve completed historical reports and existing M4 finding-occurrence projections; do not fabricate finding snapshots or mark unfinished matching as complete. Tests cover upgrade, downgrade, equivalent versions, unknown ecosystems, retries and historical behavior. No replacement diff engine is introduced.

## API boundary contracts

Feature-first schemas and z.output types remain in @repo/contracts/sboms. Parse paths, queries, bodies and successful JSON responses. Non-JSON export must declare its response kind and validate request metadata and serialized format. Web gateway validates outgoing input and successful responses. Formats/version validation must be identical across manual/API/CI and supplier ingestion. Export must label optional VEX availability rather than silently omit it.

## Frontend logic and rendering

Functional existing panels and existing SbomsApi gateway. Chunked hashing uses an already installed audited implementation with bounded file slices, not a new hand-written cryptographic algorithm. Retain unsaved selection, stable upload command identity and explicit retry. Paginate history; keep old versions downloadable. Accessible controls, textual loading/empty/forbidden/conflict/offline errors, semantic tokens and cn().

## Failure modes

Test malformed/unsupported JSON/XML/tag-value, XML entities, chunk splits, oversized scalar/component/depth, uncertain identifiers, supplier grant revocation, cross-tenant/product substitution, lost initialization/PUT/completion responses, revoked export permission, absent/inconsistent VEX, stale selection, failed graph publication and worker restart. Core ingestion/export must work without AI or external model access. Export or parse outage must not delete existing evidence.

## Tests and observability

Write failing contract/policy/worker/gateway/component tests first. Verify format matrix and original hash/byte retention, normalization/dependency graph, quality warnings, lineage/diff/dedupe, historical pagination, composite/supplier provenance and scoped export. New/materially refactored modules require >=80% coverage. Run local SQL/RLS/storage checks, focused regressions, CLI lint/type alignment when applicable, pnpm verify, Playwright runner and MCP, desktop/mobile screenshots. Use exact run-scoped cleanup; never clear other site data or global mail. Record failures separately from passing reruns and avoid production-load/legal/WCAG certification claims.

## Rollback

Roll back additive application changes while retaining originals, runs, normalized graph, provenance, audit and historical records. Do not down-migrate retained evidence or weaken permission/RLS boundaries. Export is a read projection and cannot rewrite an input SBOM. Deployment order: contracts, any additive CLI migration/types, API/worker, then web.

## Review checklist

- [x] Direct reuse considered before abstraction.
- [x] Existing dependency direction and session contracts preserved.
- [x] Verified identity, scoped storage and atomic job boundaries specified.
- [x] Inputs/outputs and non-JSON response contracts specified.
- [ ] TDD and focused coverage verified.
- [ ] Local DB/storage and architecture/full regression gates passed.
- [ ] Playwright runner/MCP screenshots and exact cleanup verified.
- [ ] Independent review and final requirement-to-test report complete.

## Full pinned BSI technical profile follow-up

The complete 20-page BSI TR-03183-2 v2.0.0 source is available in the local working artifacts. Its SHA-256 is `20db4a9e5bfe1d5168e212bd9f3c427a014b3732a061216992e30ceb365ac226`. The earlier failed replacement fetch did not remove this copy. Sections 3–7 specify the normative profile; section 8 explains it. Record the publisher URL, source hash and clause trace, without redistributing the PDF.

The existing five aggregate checks are insufficient: supplier is not creator, arbitrary strong hashes do not satisfy deployable SHA-512, PURL is conditional, depth three is not a normative requirement, and a leaf may have no dependencies. Add a focused technical-profile evaluator separate from `sbom-quality.v1`, which remains unchanged. Use the existing immutable original because normalization discards document creator/timestamp and component creator, filename, property flags and license roles.

A worker-owned inward profile-evidence port resolves organization/report/document/source scope in an infrastructure adapter and injects the existing verified storage stream. All provider queries take organization first. Stream JSON/XML through bounded parsers; drain to verified EOF before reporting results. Existing private spool helpers may support bounded multipass reference checks. No new table, column, store or generic rule engine is needed: existing profile-summary JSON and finding rows retain the assessment.

Trace clauses 3.1, 3.2, 4, 5.1, 5.2.1, 5.2.2, 5.3, 5.4, 6.1 and 7. Machine checks cover supported representation, required declared fields, SHA-512 syntax, dependency enumeration/references, explicit property values, identifiers/license-expression syntax and embedded vulnerability information. Missing or conflicting declarations produce findings at exact source paths. Supplier never fills creator; license roles remain separate; assembly exceptions are unknown until evidenced. Conditional availability, actual build/filename/hash truth, complete delivered inventory, external BOM conformity and license matching require explicit human-review outcomes. Current-edition applicability is unknown: pinned 2.0 checks cannot claim current BSI or statutory conformity. The 2.1 property taxonomy is a representation convention, not a silent normative edition upgrade.

Add backward-compatible optional technical-assessment/provenance/count metadata to shared profile contracts and existing report projections. Preserve old reports and label legacy subset results accurately. A new evaluation records a new evaluator identity. Disabled/unsupported/unavailable states remain explicit; optional profile/provider failure cannot block manual intake/export. Bound retained findings and count omitted issues honestly.

TDD: complete/missing/conflicting field cases, valid leaves, many-to-many dependencies, unresolved references, assembly uncertainty, unsupported format, conditional missing information, malformed SHA-512/license syntax, embedded vulnerability data, source hash failure/cancellation, tenant/source substitution and worker retry. Verify >=80% coverage, existing quality/regression invariants, real scoped source resolution and actual browser/MCP quality findings. Final closure awaits these gates.
