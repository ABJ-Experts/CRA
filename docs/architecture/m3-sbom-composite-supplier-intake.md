# M3 composite SBOM and supplier provenance intake

## Scope and preserved contracts

- **User outcome:** authorized reviewers can produce an immutable, auditable
  composite SBOM from compatible release evidence and accept or reject a
  supplier submission without weakening the normal intake boundary.
- **In scope:** deterministic merge review, relational provenance, generated
  SBOM evidence, supplier request/invitation/submission lifecycle, and the M9
  token-scoped API contract.
- **Out of scope:** a supplier registry, supplier portal UI, reminders,
  analytics, binary analysis, or automatic discovery.
- **Preserved:** `/api/v1`, shared Zod boundaries, existing SBOM source and
  normalized-graph immutability, session/cookie behavior, RBAC merge order,
  source retention, and the product-detail UI.

## Concrete problem and direct solution

`sbom_documents` and `sbom_document_sources` preserve an immutable normalized
source graph, but they cannot record a reviewer-selected field value or every
source edge behind a generated component. Likewise, `supplier` is a reserved
source kind, not an authorization boundary. A mutable release-level SBOM or a
member invitation would lose provenance or expose organization membership.

The selected direct composition is one composite-review workflow and one
supplier-request workflow. Both are feature-owned application use cases with
the existing Supabase SBOM adapter as the sole provider adapter. The existing
ingest worker remains the only validator/normalizer of supplier and generated
bytes.

## Patterns and dependency direction

- **Durable review state:** a merge can have explicit conflicts, resolutions,
  retries, and immutable input snapshots. `SbomCompositeUseCases` owns the
  contract; the Supabase adapter owns atomic persistence. It can be removed if
  a shared immutable-evidence review workflow gains these exact guarantees.
- **Scoped supplier session:** an opaque, hashed invitation and short-lived
  hashed session are required because M9 has no organization member session.
  Supplier endpoints never receive an organization identifier.
- **Pure merge policy:** exact normalized identity grouping and conflict
  detection are deterministic functions. No version ordering or source-order
  selection is permitted.

The flow is React review panel -> `SbomsApi` -> Zod-parsed Nest controller ->
use case/policy -> org-first repository/storage port -> Supabase. Supplier M9
uses the same path after token exchange. Controllers and pages never access
Supabase directly.

## Data, security, and failure behavior

- New tables retain supplier requests/invitations/submissions and composite
  reviews, immutable inputs, conflicts, unresolved edges, and relational
  component/field/dependency provenance. Existing source/document/component
  tables remain the generated graph authority.
- Every internal service-role operation takes `organizationId` first and every
  foreign key is resolved within that organization. Foreign IDs return `404`.
  Supplier token paths provide no tenant/product/finding names.
- The input-set digest includes sorted source/document hashes and merge-rules
  version. Repeated creation replays one review. Resolution requires a current
  version and a reason; generation cannot proceed with unresolved conflicts or
  relationships.
- The generated source is additive and immutable. Its bytes re-enter the
  normal intake worker; it is authoritative only after normalization succeeds.
  Composite provenance and supplier state transitions share the corresponding
  database transaction. Rejection preserves original evidence.
- Expired/revoked/mismatched invitation and session credentials fail as generic
  not-found. Provider/database failures remain retryable and cannot create a
  partial authoritative composite.

## API, UI, tests, and rollback

- Contracts live in `@repo/contracts/sboms`; each request, query, path and
  successful response is parsed by the web client and Nest boundary. Internal
  actions require `can_review_sboms`; supplier endpoints use only the scoped
  supplier principal.
- The product SBOM section shows source coverage, conflicts, decisions,
  provenance, supplier states, and safe loading/empty/error/processing states.
  It follows the established Evidence Control Room visual system; M9 UI is not
  created here.
- Tests characterize existing manual/CI intake and cover conflict identities,
  cycles, tenant isolation, token expiry/retry, rejected evidence, worker
  restart, export provenance, and duplicate-match equivalence. Live database,
  RLS, browser, lint, type, architecture, test, and build gates are required.
- Deploy additively: migration/types, API/workers, then UI. To roll back,
  disable new endpoints/workers while retaining immutable rows and objects;
  repair database defects forward and never delete source evidence.

## Review checklist

- [x] The mutable release SBOM and member-invitation shortcuts were rejected.
- [x] Each added lifecycle has a present-tense persistence/security trigger.
- [x] Tenant identity is server-authoritative and supplier tokens are scoped.
- [x] Contracts, provider access, and generated evidence remain at their
      existing boundaries.
