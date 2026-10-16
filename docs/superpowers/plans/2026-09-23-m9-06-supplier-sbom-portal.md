# M9-06 Supplier SBOM Portal Implementation Plan

> **For agentic workers:** Execute the approved M9-06 plan test-first. Keep each subsystem's edits scoped and review its tests before integration.

**Goal:** Let one M9-issued checklist item route a supplier SBOM through the existing M3 intake and review flow.

**Architecture:** A nullable organization-scoped checklist link selects an existing M3 request. An M9 invitation creates a linked M3 grant; the server activates it for the exact item and delegates upload/finalization to M3. M3 remains the source, worker, and review authority.

**Tech Stack:** Next.js 16, NestJS 11, shared Zod contracts, Supabase/Postgres, Vitest, Jest, Playwright.

**Spec:** `docs/architecture/m9-06-supplier-sbom-portal.md` and the user-approved M9-06 plan.

## Global constraints

- Local CRA Supabase only. Do not touch production, reset, or delete existing data.
- Preserve M3 direct routes, M9 evidence flows, `/api/v1`, auth/cookies, permissions, immutable evidence, and M7 snapshots.
- All state-changing operations are idempotent and audit facts are transactionally durable.
- Use existing parser, storage, worker, and quality/matching gates; no new SBOM intake table or provider stack.

## Review focus

- A second supplier's identical bytes must get a terminal submission state and its own accepted-source provenance.
- Revoking an M9 invitation during upload must invalidate the linked M3 session before finalization.
- An SBOM for another checklist item, product, release, or component must never be accepted.
- Malformed data must yield supplier-safe guidance and keep the immutable source for internal inspection.
- M9 evidence checklist and M3 SBOM review states must not be conflated.

## Tasks

1. **Contracts (red → green):** Add explicit SBOM item/input/output schemas and eligible/upload/status contracts under `packages/contracts/src/supplier-evidence/`; verify legacy evidence inputs still parse and unsupported keys fail. Run `pnpm --filter @repo/contracts test` and build.
2. **Database (red → green):** Add one CLI-created additive migration for scoped FKs, issue/reissue/revoke/activation, safe projections, component match, dedup terminal state, and accepted alias provenance. Add `apps/infrastructure/tests/m9-06-supplier-sbom-portal.test.sql`; run local SQL/RLS tests and lint. Generate both DB type copies via the infrastructure script.
3. **API (red → green):** Add item grant use case, scoped adapter, thin internal eligible and public portal routes; wire `SbomModule`'s existing supplier service. Add authorization/response tests and update the exact public-route allowlist. Run focused Jest, typecheck, and architecture checks.
4. **Web (red → green):** Extend the request draft selector and code-split portal SBOM panel using shared contracts and existing private-upload transport. Test loading, offline, retry, conflict, expiry, validation, keyboard, and narrow layouts with Vitest.
5. **Integrated verification:** Run local Postgres/RLS/storage/worker tests, `pnpm verify`, seeded-owner and supplier Playwright journeys with screenshots, local DB provenance/audit cross-check, and bounded read latency measurements. Record requirement-to-test mapping, deploy/rollback order, unrelated baseline failures, and residual risks.
