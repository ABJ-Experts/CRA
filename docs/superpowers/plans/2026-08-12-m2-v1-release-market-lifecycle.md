# M2 V1 release market availability and lifecycle — execution plan

## Task 1: Feature design and compatibility record

Create `docs/architecture/m2-v1-release-market-lifecycle.md` from the feature-design template before any schema changes. Record BRD evidence, release-level lifecycle authority, the strict transition matrix, FR-PROD-004 deferral because no approved decision table exists, the legacy-data migration stop, tenant and audit requirements, durable retention signal, rollback, and the full verification checklist. Update the existing M2 architecture document only where its legacy lifecycle wording or test claims would otherwise be false.

## Task 2: Shared product contracts and decision policy

Replace the legacy release lifecycle contract with the V1 states. Remove direct lifecycle mutation from generic release create/update payloads; release creation is development. Add strict Zod schemas and `z.output` types for Member State reference data, availability read/add/remove/correct, lifecycle transition, placed-on-market correction, lifecycle timeline, the expanded release response, and typed domain error payloads. Add a pure, exhaustive lifecycle policy with no framework or infrastructure imports. Add tests for every contract and decision-table row, including strict UTC-Z timestamps.

## Task 3: Atomic Supabase storage and RPC boundaries

Add ordered migrations and live SQL tests. Block on legacy released/retired rows before altering the existing lifecycle state; map only draft to development. Add release `placed_on_market_at`, versioned seeded EU-27 reference data, active availability projection, audit-backed availability/lifecycle/date history, durable retention outbox, atomic organization-first service-role RPCs, RLS/grants/indexes/export registration, and the composite release/product dependency-fact foreign key. Update release JSON/read/list/create/update/archive RPCs to the V1 model. All writes must lock and compare aggregate version; atomic failures roll back audit and outbox effects.

## Task 4: Nest application and transport integration

Add framework-free regulatory use cases/ports and Supabase adapter methods for the new read and command paths. Export published market-availability and regulatory-state readers from the product module. Keep controller thin, enforce existing verified organization context and exact permissions, parse contracts on all boundaries, map domain outcomes to stable HTTP errors, preserve malformed-provider diagnostics as 502, and add unit/controller/repository tests.

## Task 5: Functional product-detail experience

Extend the product gateway and React Query hooks with parsed action methods. Replace editable lifecycle selects with a transition form and timeline; add Member State add/remove/correct controls, current availability, pre-placement warning, stale reload, validation/blocked/retry/forbidden states, and accessible status/error feedback. Fix baseline query-pending and permission-gating defects. Add focused gateway/query/component tests.

## Task 6: Integration validation and final review

Regenerate Supabase types after the approved migration, run database lint/diff/type generation and live SQL/concurrency tests, then contract/API/web/architecture/root checks. Use the local application stack and browser automation to log in as `owner@cra.test`, create uniquely named local records without resets/deletion, test successful and blocked flows, capture screenshots, and inspect only the resulting local Supabase records/audit/history/outbox via MCP. Finish with security and whole-branch review.
