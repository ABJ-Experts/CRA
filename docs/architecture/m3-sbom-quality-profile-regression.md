# M3 SBOM quality, BSI profile, and regression insights

## Scope and preserved contracts

- **User outcome:** an authorized release user can understand an SBOM's
  completeness, optional BSI technical-profile result, concrete remediation,
  and change from the previous source without an opaque compliance claim.
- **In scope:** deterministic quality reports, BSI TR-03183-2 v2.0.0 rules,
  release-lineage comparison, tenant configuration, report reads, and the
  normalized-document quality surface.
- **Out of scope:** legal conclusions, release blocking, source rewriting,
  vulnerability matching, and license decisions.
- **Preserved:** immutable source evidence, the M3-03 graph, `/api/v1`, ES256
  verification and refresh-cookie path, deny-by-default authorization, and
  existing document/component/tree contracts.

## Concrete problem and selected boundaries

Normalized component data contains the facts needed to judge SBOM quality, but
today it is only an inspectable graph. Calculating in a page would expose
tenant data and would make formula/ruleset changes irreproducible; calculating
in a one-off controller would be unable to recover after worker failure.

- **Durable report lifecycle:** `sbom_quality_reports` is both the immutable
  report record and its small, recoverable job lifecycle. This is the minimum
  durable boundary: a separate generic queue would add no second consumer.
- **Pure policy boundary:** formula and BSI rules are immutable TypeScript
  functions over bounded stored facts. The worker streams/aggregates graph
  facts in stable batches, so it never loads a 50,000-component graph.
- **Release source scope:** a report is keyed by source and release, not just
  document. M3-03 intentionally reuses a document hash across sources, while
  comparison baselines must retain each release's provenance.

## Formula and BSI profile

- Formula version is `sbom-quality.v1`: canonical PURL 20%, correctly encoded
  recognized cryptographic hash 20%, supplier 15%, license 15%, direct
  top-level dependency coverage 20%, and the separately displayed,
  capped transitive-depth measure 10%.
- Each numerator, denominator, score, weight, and final score is stored as an
  immutable input snapshot. Missing or unassessable inputs score zero with
  specific remediation. Empty documents do not divide by zero.
- The direct/top-level metric uses an explicitly extracted document subject and
  retained direct links; it is always rendered separately from transitive
  depth. It is an evidence-coverage indicator, not a legal conclusion.
- The initial optional technical profile is BSI TR-03183-2 v2.0.0. Every
  implemented rule records its published identifier, versioned ruleset,
  expected/actual evidence, source path, severity, and remediation. The UI
  calls it a technical profile assessment and never claims certification.
- A report warns only for a total decrease greater than 5.00 points or a
  material coverage decrease greater than 10.00 points. Exact thresholds do
  not warn.

## Data and tenant boundaries

- Organization and actor identity come only from the authenticated API guard.
  Every concrete adapter method and RPC accepts `organizationId` first and
  scopes every query; cross-tenant IDs return not found.
- Tenant BSI enablement/version lives in a one-row quality settings boundary.
  Its versioned snapshot is captured when a report is enqueued, so a later
  change cannot alter an active or completed report.
- The final M3-03 normalization transition enqueues source-quality work in the
  same transaction. A report remains `queued`/`processing` until its findings
  and audit facts are persisted atomically; the completed normalized graph
  stays safely readable while the quality state is explicit.
- Baselines prefer `supersedes_source_id`; otherwise they use the preceding
  verified source in the same release, ordered by `(verified_at, source_id)`.
  Per-release serialization waits for earlier eligible work rather than making
  a concurrent first-document false negative.
- New tables use composite tenant foreign keys, RLS, no browser grants,
  update triggers, tenant-leading indexes, and `security definer` functions
  with `search_path = public, pg_temp`. Additive migration keeps the previous
  API safe during deployment; rollback disables new readers/workers and repairs
  forward without touching evidence.

## API, UI, failure modes, and verification

- Contracts are feature-first under `@repo/contracts/sboms`; controllers use
  Zod pipes and response schemas, application use cases own ports, and the web
  uses only `SbomsApi` with parsed input/output.
- Report and findings reads are source-scoped. The release document list passes
  source provenance into the existing document route, preserving legacy links
  while avoiding an ambiguous deduplicated-document baseline.
- Four functional, accessible operational panels show score/formula, coverage,
  BSI status, and regression; a paged remediation table follows. Every state
  has text, not colour alone, and keyboard/focus/reduced-motion behavior.
- Storage or database failure leaves the lease recoverable; invalid profile
  evidence becomes a finding rather than changing core schema validation;
  tenant deletion cascades work; archived releases keep historical reports.
- Characterize M3-03 behavior first, then test contracts, formula/rules,
  retries, thresholds, replay/config races, RLS/tenant isolation, cursors,
  browser keyboard flow, and local Supabase records. New or changed modules
  require 80% coverage before root lint, type, architecture, test, and build
  gates.

## Review checklist

- [x] The direct page-only calculation was rejected because it cannot preserve
      tenant boundaries, reproducibility, or worker recovery.
- [x] Controllers/pages remain thin and never call Supabase directly.
- [x] Formula, BSI version, baseline policy, and report lifecycle are explicit.
- [x] Core validation remains independent from optional BSI configuration.
