# M5 validated VEX exports and controlled publication

## Scope and preserved contracts

- **Outcome:** authorized users can create a reproducible, validated OpenVEX
  0.2.0 or CycloneDX 1.6 export for exactly one product release and, when an
  owner has enabled a deployment-provisioned target, request durable
  publication without making the private download depend on that delivery.
- **In scope:** effective assessment snapshots, immutable export artifacts,
  strict format mappings, target confirmation, publication leases/outcomes,
  and compact triage controls.
- **Out of scope:** SBOM generation, CSAF ingestion, report submission,
  regulatory timers, arbitrary public disclosure, browser-held credentials,
  and a generic event bus.
- **Preserved:** `/api/v1`, VEX revision/approval semantics, M5-03 bulk
  propagation, M5-04/05 projections, auth cookies/JWKS, permission merge
  order, session revocation, menu contracts, and mock passthrough.

## Concrete problem and direct solution

The existing assessment ledger is immutable evidence, while an export needs a
point-in-time release-scoped representation that stays downloadable after a
later assessment decision. Adding export bytes, target state, or retry fields
to `vulnerability_findings` would mix matcher evidence with derived artifacts,
would not retain the selected approval revision, and could not model a failed
external delivery independently of the valid artifact.

The selected design creates a small immutable export snapshot and selected
revision ledger, plus a feature-local durable publication queue. Snapshot,
selection, audit, and idempotency facts commit together. Publication operates
only on already stored immutable bytes. This makes a failed provider separate
from export correctness and needs no generic workflow framework.

## Format, data, and tenant boundaries

Only current assessments whose approval state is `approved` or
`approval_not_required` are eligible. Pending, rejected, superseded,
cross-tenant, archived, and unrelated release records fail closed or remain
outside the scoped snapshot. OpenVEX 0.2.0 maps the current canonical values
directly. CycloneDX 1.6 maps only semantically supported states; `affected`
and any ambiguous justification return a format-specific mapping error rather
than silently omitting or changing a statement.

Public output contains deterministic product/release, finding/advisory,
assessment-revision, approval/provenance, and timestamp references only. It
never serializes assessment detail, change/decision reasons, evidence links,
free-text remediation information, credentials, storage paths, or internal
notes. The bytes are canonicalized and ordered, stored privately, and keyed by
the immutable snapshot digest; a repeated unchanged request returns the same
hash.

Every service-role RPC accepts `organization_id` first and filters release,
product, finding, assessment, snapshot, target, job, attempt, audit, and
idempotency rows by it. Database functions check active membership and the
same permission granted by Nest. RLS is enabled and non-forced, default
function access is revoked, functions pin `public, pg_temp`, `public.users`
foreign keys and tenant composite references are used, and only `service_role`
gets explicit RPC access.

## Publication and failure behavior

`can_export_findings` authorizes export/download; the separate
`can_manage_finding_publication` authorizes target confirmation and
publication. Both use the existing base-role/custom-role/override resolver.
Targets are selected from a deployment-owned registry. Database rows store
only a safe target key and confirmation/version data; endpoint allowlists,
object-storage configuration, and credential references remain server-only.

The feature-local worker uses claim, pinned delivery, complete/fail, retry,
lease expiry, and dead-letter transitions. HTTPS publication revalidates
scheme, configured hostname, DNS public address, redirects, timeout, body
size, content type, and stable idempotency key. Versioned payloads are never
rewritten. Replacement updates only a current pointer; withdrawal writes a
tombstone/pointer record while retaining all local snapshots and attempt
evidence. A timeout may be externally ambiguous, but remains a single local
logical attempt and is auditable. The regulatory outbox is deliberately not
reused: it is M6 obligation input, not publication delivery state.

## Patterns, tests, and rollback

- The browser gateway, Nest use case/port, Supabase adapter, private storage
  adapter, and publication adapter are focused boundary adapters; their
  present trigger is differing transport/provider semantics.
- A feature-local durable queue is required because publication survives a
  restart and needs bounded retry/lease evidence. It is removable with its
  only consumer, unlike a generic bus.
- A shared pinned-HTTPS safety helper is justified only if it is extracted
  from the existing external-reference validator and used by these two real
  egress operations; otherwise the feature keeps its adapter local.

Tests start with strict contract/golden mapping failures, then snapshot policy,
SQL RLS/transaction/concurrency, adapter/controller/worker failure injection,
web state tests, and an isolated local Playwright journey. Deploy expand-only:
migration, generated types, API/worker, then web. Rollback code/config first;
snapshots, revision references, and publication evidence remain readable and
old API versions ignore the additive state.
