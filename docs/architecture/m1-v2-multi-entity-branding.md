# M1 V2 multi-entity tenancy and organization branding

## Scope and preserved contracts

- User outcome: an organization owner can maintain multiple legal entities and
  publish a safe, accessible organization brand without weakening historical
  records or existing organization administration.
- In scope: organization-local legal-entity contracts and lifecycle, derived
  dependency projections, versioned brand drafts/publications, private logo
  metadata, safe resolved branding, and their API/web integration seams.
- Out of scope: product, report, obligation, legal-hold, supplier-portal, and
  document-generation tables or workflows. Those systems remain authoritative
  for their own entity snapshots and assignment history.
- The M1 `organization_legal_profiles` contract, `organizationSchema.legalProfile`,
  frozen auth-action signatures, `/api/v1` prefix, cookie paths, session model,
  permission merge order, and mock namespace remain unchanged. V2 adds a
  separate feature; it does not reinterpret an existing legal profile.

## Concrete problem

One organization can operate through more than one legal identity, while
products and reports need durable proof of the identity selected at the time
they were created. A mutable foreign-key choice on a product would let a later
legal-entity edit rewrite history. Similarly, an arbitrary image URL and CSS
color strings would leak private storage implementation, permit unsafe image
inputs, and create inaccessible text combinations.

## Why not simpler?

The direct approach would put a `legal_entity_id` on future product/report
records and place color/logo columns on `organizations`. It cannot preserve an
immutable historical entity snapshot in records owned by product/reporting,
communicate deletion dependencies without joining their tables, expose
versioned brand publications, or ensure a browser never learns a storage path.

## Selected patterns

- **Ports and adapters** — product/reporting and branding storage are owned by
  independently changing systems. Legal-entity administration owns typed
  context and dependency-projection ports; each external owner implements them
  after its own transaction commits. Remove a port if its owner and entity
  administration become one transactional store.
- **Facade with focused use cases** — organization controllers coordinate
  authorization, schema parsing, and an organization-first use case, not
  persistence or storage calls. This keeps the compatibility-facing
  `OrganizationsService` thin while V2 has several entity and branding actions.
- **Durable versioned records** — legal entities and branding publications have
  monotonic versions. The current version is carried in commands so concurrent
  tabs cannot overwrite each other. Published branding is immutable; drafts
  are mutable only through expected-version updates.
- **Pure policy functions** — contrast calculation and Sentinel fallback are
  immutable shared-contract functions with no framework, DOM, storage, or
  request state. Remove them only if branding is no longer shared by API and
  web.

Dependency direction is web presentation -> typed HTTP gateway -> API
controller/facade -> application use case/port -> Supabase or storage adapter.
Product/reporting implementations depend on typed V2 context ports but never
make V2 depend on their database schema.

## Rejected patterns

- A cross-feature entity-assignment table is rejected because it would make
  V2 the authority for product/report history and split their transaction.
- A global event bus or background workflow is rejected. Entity snapshot and
  assignment history writes are security-relevant and must commit with the
  owner record; a retryable reconciliation job is only for the derived V2
  dependency projection.
- A browser-held branding theme is rejected because it is neither authoritative
  nor safe for server-rendered/export contexts.
- Arbitrary external logo URLs, data URLs, SVG, and public storage links are
  rejected. An authorized image endpoint can serve a normalized private asset
  without exposing a bucket, object key, raw path, or signed URL.
- A class hierarchy for branding states is rejected. A discriminated data
  record plus pure policies represents the two current resolved states clearly.

## Data and tenant boundaries

- The global auth guard verifies the Supabase ES256/JWKS access token and treats
  the signed active-organization cookie only as a selection hint. Repository
  operations reverify membership, active organization state, actor, and
  organization identity.
- Every service-role repository method accepts `organizationId` first and
  filters it explicitly. A supplied entity ID that belongs to another
  organization returns the same generic `not_found` result as a missing ID.
- Legal entities are soft-deleted only. Incomplete entities created by legacy
  backfill remain inactive and cannot become active or be supplied as a new
  product/report context until completed.
- Product and reporting owners persist a complete legal-entity snapshot and
  assignment history in *their own transaction* with their authoritative
  record. After that transaction commits, they reconcile an aggregate V2
  dependency projection. V2 never writes their records or replaces their
  immutable snapshots; a failed projection reconciliation cannot roll back or
  erase the owner transaction.
- Entity create and publish/remove-branding commands carry an idempotency UUID
  bound by the API/database to actor, organization, command type, and payload
  digest. Reusing a key with a different payload safely conflicts. Entity,
  draft, and publication changes carry an expected version.
- V2 migrations are additive. Existing legal profiles backfill to one complete
  active default entity; organizations without a legal profile receive an
  inactive `needs_completion` default entity. Previous callers continue using
  M1 legal-profile and organization fields during rollout and rollback.

## API boundary contracts

- `@repo/contracts/organizations/schemas/legal-entity.schema.ts` defines
  strict create, replacement update, lifecycle, output, and response schemas.
  Entity identifiers trim and normalize to lowercase before the API/database
  applies organization-local uniqueness. Optional registration and tax
  identifiers normalize Unicode compatibility forms, remove all Unicode
  whitespace, and uppercase before collision checks. The output includes status,
  completion state, version, timestamps, actor IDs, and aggregated dependency
  counts; it intentionally contains no external assignment IDs.
- `@repo/contracts/organizations/schemas/organization-branding.schema.ts`
  validates canonical six-digit colors and a palette whose derived black or
  white text has WCAG AA contrast of at least 4.5:1. It exposes contract-level
  limits of 2 MiB source bytes, 64--2048 pixels per dimension, and 16 MP
  decoded pixels. File-byte/MIME matching, decode safety, normalization, and
  malware scanning remain API/storage responsibilities.
- Private branding logo metadata may expose only a stable asset UUID,
  normalized WebP dimensions, SHA-256, and alt text. It never contains a
  bucket, object key, storage path, arbitrary external URL, raw source MIME,
  or signed URL.
- `resolveOrganizationBranding` is a pure, total resolver. A null or absent
  organization publication returns immutable CRA Sentinel branding; it cannot
  surface raw storage locations. API response adapters parse their successful
  result with the same output schema before serialization.
- A mutable owner-only draft records its version, creator/updater, timestamps,
  input palette, optional safe footer/contact text, and either no logo or an
  approved normalized-logo asset. Preview and published reads expose only one
  resolved snapshot contract discriminated as `sentinel`, `draft_preview`, or
  `published`; portal and document consumers do not receive the mutable draft,
  asset lifecycle, storage location, or an arbitrary URL.
- Trusted request/response types are `z.output<typeof schema>` aliases in the
  feature type barrel. Controllers parse bodies and parameters before invoking
  application logic; web callers use both outgoing input schemas and incoming
  response schemas.

## Branding asset lifecycle

1. The browser uploads only an inspected candidate to an authorized API route;
   it never chooses a storage path.
2. The API validates request limits, verifies actual bytes/MIME, rejects SVG,
   corrupt, oversized, or dangerous images, strips metadata, and normalizes an
   accepted image to private WebP.
3. A draft references only a server-owned asset UUID through an approved-asset
   state. Publishing creates a versioned immutable branding record atomically
   with its audit fact.
4. The resolver returns a `sentinel`, `draft_preview`, or latest permitted
   `published` snapshot with safe footer/contact text. An authorized route can
   render `logo.assetId`; exports snapshot the resolved branding version rather
   than resolving it again later.

## Failure modes

| Failure | Handling |
| --- | --- |
| Invalid entity identifier, legal data, color, or unknown field | Shared Zod contract fails closed before an application command. |
| Foreign entity ID | Organization-first repository returns generic `not_found`; no tenant detail leaks. |
| Incomplete/inactive entity context | Owner integration rejects a new assignment; historical snapshots remain readable. |
| Entity deletion with dependencies | Transaction rejects deletion with safe aggregate dependency reasons; no external record is mutated. |
| Stale entity/draft/publication version | Stable conflict; no lost update. |
| Reused idempotency key with changed payload | Stable idempotency conflict; no duplicate entity or publication. |
| Byte/MIME/decode/scan/storage failure | No publication; storage reservation compensation runs and public reads resolve Sentinel. |
| Missing, removed, or malformed branding record | Adapter fails closed for mutation and returns the Sentinel fallback for permitted reads. |
| Raw path/URL provider output | Response-schema parsing rejects it; consumers receive no raw object location. |

## Tests and observability

- Contract tests first cover strict legal-entity create/update/output parsing,
  identifier normalization, state/completion invariants, lifecycle/version and
  idempotency fields, canonical palette values, WCAG contrast derivation,
  policy limits, no-storage-location output, and CRA Sentinel fallback.
- API tests cover owner-plus-`can_edit_organization` mutations,
  `can_view_organization` reads, organization-first calls, foreign-ID `404`,
  stale versions, safe dependency failures, inspected upload compensation,
  private asset authorization, and response parsing.
- Live database/storage tests cover normalized identifier uniqueness, RLS and
  grants, complete/incomplete backfill, concurrent create/publish requests,
  private bucket access, image abuse cases, and immutable export snapshots.
- Product/reporting conformance tests prove that a context snapshot and
  assignment history commit with the owner record, and that reconciliation
  retries only affect V2 aggregate projections.
- Structured logs/audit facts include safe action, entity/branding version,
  outcome, projection-reconciliation result, and storage compensation result.
  They exclude raw legal contact values, raw image bytes, storage paths,
  presigned URLs, credentials, and idempotency payload digests.

## Rollback

Deploy additive migrations and generated types before API and web callers. A
rollback disables V2 routes, workers, and UI while legal entities, immutable
snapshots, version records, audit facts, and private assets remain intact. Do
not drop tenant data to roll back. A later separately reviewed contract phase
can retire old records only after all readers and retained exports no longer
need them.

## Review checklist

- [x] The direct solution was considered first.
- [x] Every selected pattern has a present-tense trigger and a contract test.
- [x] No request, user, tenant, or session state is global.
- [x] Controllers/pages contain no provider query or domain decision.
- [x] Domain/application layers do not import frameworks or concrete adapters.
- [x] Boundary input and external responses are schema-validated.
- [x] Wire schemas and parsed `z.output` types live in feature folders.
- [x] Security-critical effects are synchronous or transactionally durable.
- [x] The product/reporting ownership transaction and projection reconciliation
  boundary are explicit.
- [x] Focused contract coverage for changed modules is at least 80%.
- [ ] Live database, storage, API, web, and E2E verification complete in Tasks 2-6.
