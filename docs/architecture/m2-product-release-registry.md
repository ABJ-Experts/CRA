# M2 product and release registry

## Scope and boundaries

M2 owns the authoritative tenant-scoped product, release, legal-entity assignment history, and lifecycle-dependency projection. It does not own SBOM ingestion, vulnerability findings, reporting, retention policy calculations, or legal holds. Those applications integrate through the product/release context and dependency-reconciliation boundaries rather than querying M2 tables directly.

The registry is served only under `/api/v1/products`; the generic dashboard `/api/products` mock is unchanged. Controllers/pages remain provider-free, while service-role RPCs take organization ID first and revalidate active membership.

## Data and integration design

- A product stores a required active legal-entity reference plus an immutable legal-entity JSON snapshot and version. Every reassignment inserts a new immutable history row and requires owner plus product-edit authorization.
- A release inherits and snapshots its product entity context at creation. Its version is an opaque display value; a hidden Unicode/case/whitespace-normalized key enforces uniqueness within a product. Lists sort by creation time and ID, never lexical version text.
- Product/release create commands are idempotent by organization, actor, key, and canonical payload digest. Updates and archive commands use integer optimistic concurrency versions.
- Product creation commits its product, assignment, idempotency record, audit fact, first-product onboarding evidence, and legal-entity dependency projection inside the same database transaction. Therefore a crash after persistence cannot lose the onboarding fact.
- Installed owner modules can write lifecycle dependency facts. Product archive requires every release archived and no active product facts; release archive requires V1 terminal `withdrawn` state and no active release facts. Release lifecycle authority, market availability, placement evidence, and retention signalling are defined in `m2-v1-release-market-lifecycle.md`; generic release updates do not mutate lifecycle.

## Failure and rollback

Cross-organization resources, inactive owners, inactive/incomplete legal entities, and stale sessions use the same safe not-found or conflict outcomes and reveal no foreign record. Product/archive data is soft-state only; rollback disables callers without deleting records, snapshots, onboarding evidence, or audit history. Internal codes and release identities remain reserved after archive.

## Verification

Contracts validate every request and success response. Unit/API tests cover legal-entity context, idempotency, tenant 404s, optimistic conflicts, lifecycle blockers, and route permissions. V1 lifecycle/availability verification additionally covers the strict transition policy, EU27 placement prerequisite, history/audit/outbox atomicity, and legacy migration stop. Live SQL checks assert RLS, grants, indexes, and RPC access. Browser/E2E tests use real run-scoped Supabase test accounts and the established fixture password without reading password hashes.
