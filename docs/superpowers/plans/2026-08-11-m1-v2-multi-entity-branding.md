# M1 V2 Multi-Entity Tenancy and Organization Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tenant-scoped legal entities and versioned, secure organization branding without changing the M1 legal-profile contract.

**Architecture:** Legal entities and branding are separate organization features with shared Zod contracts, thin HTTP controllers, application ports, and organization-first Supabase adapters. Product, reporting, supplier portal, and document-generation owners remain external: V2 supplies typed context, dependency, and branding-snapshot ports but creates none of their tables or workflows.

**Tech Stack:** Next.js 16, NestJS 11, Zod 4, Supabase/Postgres 17, private Supabase Storage, Sharp, file-type.

## Global Constraints

- Preserve `organization_legal_profiles`, `organizationSchema.legalProfile`, auth-action signatures, `/api/v1`, cookies, and permission resolution order.
- Every service-role operation receives `organizationId` first and filters it explicitly; foreign entity IDs return `not_found`.
- Legal-entity and branding writes require owner role plus `can_edit_organization`; reads require `can_view_organization`.
- Legacy profiles backfill to one default entity; missing profiles backfill to an inactive `needs_completion` entity and cannot be activated or used as a context until completed.
- Entities soft-delete only. Historical contexts are immutable snapshots owned by the product/reporting consumer.
- Logos are private PNG/JPEG/WebP input only: <=2 MiB, 64--2048 px, <=16 MP decoded, normalized to metadata-free WebP. SVG, mismatched bytes, corrupt images, active content, and oversized images are rejected.
- Stored primary and secondary colors must provide derived black-or-white text at WCAG AA 4.5:1; unresolved branding always falls back to CRA Sentinel defaults.
- Do not create product, report, obligation, legal-hold, supplier-portal, or document-rendering implementations. Define explicit ports and tests only.
- Additive migrations first; retain previous APIs for at least one release; generated types are never hand edited.

---

### Task 1: Feature design, contracts, and pure policies

**Files:**
- Create: `docs/architecture/m1-v2-multi-entity-branding.md`
- Create: `packages/contracts/src/organizations/schemas/legal-entity.schema.ts`
- Create: `packages/contracts/src/organizations/schemas/organization-branding.schema.ts`
- Create: `packages/contracts/src/organizations/types/legal-entity.type.ts`
- Create: `packages/contracts/src/organizations/types/organization-branding.type.ts`
- Modify: organization schema/type exports and contract tests

- [ ] Write failing contract tests for strict legal-entity inputs/outputs, identifier normalization, lifecycle/version/idempotency fields, palette contrast, and Sentinel fallback.
- [ ] Run the focused contracts suite and observe the missing-schema failure.
- [ ] Implement feature-first schemas and immutable pure contrast/fallback policies; derive public types with `z.output`.
- [ ] Document the ownership contract: product/reporting owners persist entity snapshots and assignment history in their own transactions, then reconcile dependency projections.
- [ ] Run focused contracts tests and contract coverage; commit `feat: add v2 organization contracts`.

### Task 2: Additive legal-entity and branding persistence

**Files:**
- Create: one foundation migration under `apps/infrastructure/supabase/migrations/`
- Modify: `apps/infrastructure/tests/m1-tenant-administration.test.sql`
- Modify: `apps/infrastructure/supabase/seed.sql` only if needed for valid V2 test fixtures
- Regenerate: both Supabase `database.types.ts` copies

- [ ] Write migration SQL tests for idempotent complete/incomplete default backfill, normalized identifier uniqueness, lifecycle/dependency blocks, generic cross-tenant outcomes, RLS/grants, private bucket, and audit facts.
- [ ] Run the SQL test file against the local stack and observe the absent-object failure.
- [ ] Add tables, normalizers, indexes, RLS/grants, update triggers, and security-definer organization-first RPCs for entity lifecycle, dependency projection, branding drafts/assets/versions, and publishing.
- [ ] Update the existing create-organization RPC body without changing its public signature so it creates a complete active default entity atomically.
- [ ] Run `db:types`, separate existing generated nullability changes from V2 types, then run database lint and focused SQL tests; commit `feat: persist v2 organization entities and branding`.

### Task 3: Legal-entity application and HTTP boundary

**Files:**
- Create: `apps/api/src/organizations/legal-entities/application/*`
- Create: `apps/api/src/organizations/legal-entities/infrastructure/*`
- Create: `apps/api/src/organizations/legal-entities/legal-entities.controller.ts`
- Create: `apps/api/src/organizations/legal-entities/legal-entities.service.ts`
- Modify: `apps/api/src/organizations/organizations.module.ts`
- Test: colocated Jest unit/controller/adapter specs

- [ ] Write failing use-case/controller tests for owner-only writes, organization-first repository calls, inactive/incomplete restrictions, stale-version conflicts, dependency reason mapping, and foreign-ID `not_found`.
- [ ] Run focused Jest tests and observe missing providers/routes.
- [ ] Implement framework-free directory/dependency-reporting ports, use cases, response parsing adapters, thin Zod controllers, and service error mapping under `/organizations/current/legal-entities`.
- [ ] Add typed future-owner context/dependency interfaces without importing product/report modules.
- [ ] Run focused Jest tests, API typecheck, and controller response-contract tests; commit `feat: add tenant legal entity administration`.

### Task 4: Branding security, storage, and export snapshots

**Files:**
- Create: `apps/api/src/organizations/branding/application/*`
- Create: `apps/api/src/organizations/branding/infrastructure/*`
- Create: branding controller/service/specs
- Modify: API env validation/example/package manifest and organization module
- Modify: tenant export archive and lifecycle storage/worker adapters plus specs

- [ ] Write failing tests for byte/MIME mismatch, SVG/corrupt/bomb rejection, scanner outcomes, storage compensation, no raw object paths, fallback reads, owner authorization, immutable publish versions, and export-time version snapshots.
- [ ] Run the focused Jest tests and observe missing inspector/storage ports.
- [ ] Implement inspected multipart upload, private server-generated paths, Sharp normalization, optional scanner policy, reserve/upload/finalize compensation, draft/preview/publish/remove use cases, and resolved branding snapshot port.
- [ ] Include V2 tables and published branding artifacts in export and organization-purge behavior without weakening existing fail-closed artifact handling.
- [ ] Run focused Jest tests, API coverage, and storage-related live tests; commit `feat: add secure organization branding`.

### Task 5: Web organization administration

**Files:**
- Modify: `apps/web/app/_lib/http/api-client.ts`
- Modify: organization API, keys, queries, and associated specs
- Create: entity and branding sections under `apps/web/app/dashboard/organization/`
- Modify: organization administration composition/page specs

- [ ] Write failing Vitest component/API tests for schema-paired multipart transport, query invalidation, owner-only editing, entity lifecycle states, logo selection cleanup, preview/publish/remove, and Sentinel fallback.
- [ ] Run focused web tests and observe missing transport/features.
- [ ] Implement a typed form-data transport, organization API/query methods, functional entity/branding sections, and validated style-variable preview with no raw HTML or external logo URL.
- [ ] Run focused Vitest tests, web typecheck, and design/fetch-boundary architecture tests; commit `feat: add organization entity and branding UI`.

### Task 6: End-to-end validation, architecture gates, and review

**Files:**
- Create/modify: API E2E, Playwright, live Supabase, export-registry architecture, and documentation tests as required

- [ ] Add red tests for rerun backfill, concurrent entity creation, cross-tenant entity/branding access, dependency blocking, product/report contract fakes, duplicate-safe rollup contract, branding failure fallback, and export rendering snapshot consistency.
- [ ] Implement only fixes demanded by those tests and no excluded owner workflow.
- [ ] Run focused suites, live database/storage tests, API E2E, Playwright, architecture verification, coverage, lint, typecheck, and build.
- [ ] Perform security and whole-diff review; resolve critical/high findings and rerun the affected verification.
- [ ] Commit `test: cover v2 tenant entity and branding flows` only after evidence is green.
