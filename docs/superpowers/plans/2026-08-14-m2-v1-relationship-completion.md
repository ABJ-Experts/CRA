# M2 V1 Relationship Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the verified product-relationship correctness defects, then add a finding-owned durable propagation consumer without allowing M2 to read or persist finding, SBOM, triage, or override records.

**Architecture:** Keep `apps/api/src/products` the authoritative owner of versioned baselines, release-scoped graph facts, and its published read/queue ports. The future finding module consumes only those ports and persists source-finding impact associations and overrides in its own tables. PostgreSQL remains the graph store: active, tenant-indexed adjacency rows; deterministic depth-limited traversal; and transactional outbox facts.

**Tech Stack:** TypeScript, NestJS 11, Zod, Supabase PostgreSQL 17, Vitest/Jest, pgTAP-style SQL integration scripts, Playwright.

**Spec:** `docs/architecture/m2-v1-variants-hierarchy-finding-propagation.md`

## Global Constraints

- Use Node 20+ and pnpm; do not use npm or Yarn.
- Preserve `/api/v1`, HttpOnly session cookies, RBAC permission merge order, mock namespace, and current product/release contracts.
- Every API boundary uses the shared Zod input and successful-response schemas; derive trusted values with `z.output`.
- Service-role operations take `organizationId` first and enforce the organization filter at every direct and recursive step.
- Do not give browser roles direct access to relationship, finding, SBOM, or triage tables; RLS and RPC grants remain service-role-only.
- Do not make M2 adapters query finding, SBOM, triage, evidence, or product-specific override tables.
- New privileged database functions pin `search_path`, revoke `PUBLIC`, `anon`, and `authenticated`, and grant only the required service role.
- Relationship writes, graph-version bumps, audit facts, and graph events remain one transaction; no migration reset, data reset, or generated-type hand editing.
- Preserve existing uncommitted product-relationship and routing work; add forward-only migrations only.

## Scope boundary and prerequisite decision

The repository already implements the product-side relationship model and a read-only `ProductRelationshipResolverPort`, but it has no finding/triage module. The BRD requires source-finding IDs, impact-association persistence, explicit exceptions, and a restartable finding worker; those records must be owned by that missing module. Tasks 1–3 can be implemented independently and make the existing product boundary correct and consumable. Task 4 requires the finding-module owner to confirm its aggregate names, retention/export ownership, and permission names before code is written; it must not be implemented in `products` as a shortcut.

## File structure

- Modify `apps/infrastructure/supabase/migrations/20260814100000_m2_v1_relationship_correctness.sql`: roll forward the preview outcome, release-scoped candidate traversal, and strict cursor validation without rewriting applied migrations.
- Modify `apps/infrastructure/tests/m2-v1-variants-hierarchy-finding-propagation.test.sql`: execute the new RPC behaviour inside its rollback transaction.
- Modify `packages/contracts/src/products/schemas/product-relationship.schema.ts` and `packages/contracts/src/products.spec.ts`: give the propagation cursor a canonical UUID-pair grammar.
- Modify `apps/api/src/products/infrastructure/supabase-product.repository.ts` and its spec only if the migration deliberately changes a published RPC result shape; otherwise retain the existing `found + preview.outcome=allowed` contract.
- Create `apps/api/src/products/application/product-relationship-event.port.ts` and its spec only when a finding module needs to claim product graph events through DI rather than direct Supabase access.
- Create the future finding-owned worker, impact/override entities, migrations, contracts, use cases, controller, adapter, operational documentation, and browser journey under a feature directory chosen by its owner. Do not add those files to `products`.

### Task 1: Make a permitted component-link preview a valid API success

**Files:**

- Modify: `apps/infrastructure/supabase/migrations/20260814100000_m2_v1_relationship_correctness.sql`
- Modify: `apps/infrastructure/tests/m2-v1-variants-hierarchy-finding-propagation.test.sql`
- Test: `apps/api/src/products/infrastructure/supabase-product.repository.spec.ts`

**Interfaces:**

- Consumes: `preview_product_component_link(...) returns table(outcome text, preview jsonb)`.
- Produces: a successful RPC row with `outcome = 'found'` and `preview.outcome = 'allowed'`; rejected previews retain `conflict`, `cycle_detected`, `depth_exceeded`, `not_found`, or `invalid_request` as their row outcome.

- [ ] **Step 1: Write the failing repository regression test.**

```ts
it("accepts an allowed preview returned by the database", async () => {
  rpc.mockResolvedValueOnce({
    data: [{ outcome: "found", preview: allowedPreview }],
    error: null,
  });

  await expect(repository.previewProductComponentLink(orgId, actorId, parentId, input))
    .resolves.toEqual({ outcome: "found", preview: allowedPreview });
});
```

- [ ] **Step 2: Add the SQL integration assertion before the first component create.**

```sql
select * into v_preview from public.preview_product_component_link(
  v_org, v_parent_product, v_child_product, v_actor, v_graph,
  v_parent_release, v_child_release, 2, 'manual', 'SQL integration fixture',
  'Preview before create', v_now, null
);
perform pg_temp.check('allowed preview is an API-success outcome',
  v_preview.outcome = 'found' and v_preview.preview ->> 'outcome' = 'allowed');
```

- [ ] **Step 3: Run the focused repository test and local SQL test to verify the regression.**

Run: `pnpm --filter api run test -- supabase-product.repository`

Run: `pnpm --filter infrastructure run test -- m2-v1-variants-hierarchy-finding-propagation.test.sql`

Expected: the SQL assertion fails against the current wrapper because it returns `outcome = 'allowed'`; the repository test proves the intended API contract.

- [ ] **Step 4: Roll forward the wrapper without changing `productRelationshipPreviewSchema`.**

```sql
v_preview := public.m2_component_link_preview(...);
if v_preview ->> 'outcome' = 'allowed' then
  return query select 'found'::text, v_preview;
end if;
return query select (v_preview ->> 'outcome')::text, v_preview;
```

The existing repository already treats `found` as success and parses the nested preview. Do not add `allowed` to `ProductRelationshipPreviewOutcome` because that would conflate RPC transport success with the preview decision.

- [ ] **Step 5: Re-run the focused tests and inspect the SQL function ACL.**

Run: `pnpm --filter api run test -- supabase-product.repository`

Run: `pnpm --filter infrastructure run test -- m2-v1-variants-hierarchy-finding-propagation.test.sql`

Run: `pnpm --filter infrastructure exec supabase db lint --local`

Expected: all pass; the replacement function still has `security definer`, `search_path=public, pg_temp`, revoked public access, and service-role execute only.

- [ ] **Step 6: Commit the independently verifiable repair.**

```bash
git add apps/infrastructure/supabase/migrations/20260814100000_m2_v1_relationship_correctness.sql \
  apps/infrastructure/tests/m2-v1-variants-hierarchy-finding-propagation.test.sql \
  apps/api/src/products/infrastructure/supabase-product.repository.spec.ts
git commit -m "fix: normalize relationship preview outcome"
```

### Task 2: Make candidate traversal release-aware and cursor-safe

**Files:**

- Modify: `apps/infrastructure/supabase/migrations/20260814100000_m2_v1_relationship_correctness.sql`
- Modify: `apps/infrastructure/tests/m2-v1-variants-hierarchy-finding-propagation.test.sql`
- Modify: `packages/contracts/src/products/schemas/product-relationship.schema.ts`
- Modify: `packages/contracts/src/products.spec.ts`

**Interfaces:**

- Consumes: `get_product_relationship_propagation_candidates(organizationId, sourceReleaseId | sourceBaselineRevisionId, actorId, graphVersion, asOf, pageSize, cursor)`.
- Produces: candidate rows only where an embedded edge has `target_release_id IS NULL`, the current walk release is unknown (`NULL`, product-wide scope), or `target_release_id = walk.release_id`; a cursor is exactly `product UUID + ':' + optional release UUID`.

- [ ] **Step 1: Write contract failures for malformed cursors.**

```ts
expect(() => relationshipPropagationQuerySchema.parse({
  sourceReleaseId: sourceReleaseId,
  graphVersion: 0,
  cursor: "not-a-candidate-cursor",
})).toThrow();

expect(relationshipPropagationQuerySchema.parse({
  sourceReleaseId: sourceReleaseId,
  graphVersion: 0,
  cursor: `${productId}:${releaseId}`,
}).cursor).toBe(`${productId}:${releaseId}`);
```

- [ ] **Step 2: Add SQL regressions for release B1/B2 and invalid cursor.**

```sql
-- The parent embeds child release B1 only; source finding is on child B2.
select * into v_candidates from public.get_product_relationship_propagation_candidates(
  v_org, v_child_release_b2, null, v_actor, v_graph, v_now, 25, null
);
perform pg_temp.check('a release-scoped component link excludes other child releases',
  not (v_candidates.candidates -> 'candidates' @>
       jsonb_build_array(jsonb_build_object('productId', v_parent_product))));

select * into v_invalid_cursor from public.get_product_relationship_propagation_candidates(
  v_org, v_child_release_b1, null, v_actor, v_graph, v_now, 25, 'invalid'
);
perform pg_temp.check('candidate cursor must be canonical',
  v_invalid_cursor.outcome = 'invalid_request');
```

- [ ] **Step 3: Run the focused contract and SQL tests to verify they fail.**

Run: `pnpm --filter contracts run test -- products`

Run: `pnpm --filter infrastructure run test -- m2-v1-variants-hierarchy-finding-propagation.test.sql`

Expected: malformed cursors currently parse and the B2 source currently reaches the B1-only parent.

- [ ] **Step 4: Implement the canonical cursor and release-aware walk.**

```ts
const relationshipPropagationCursorSchema = z
  .string()
  .regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}:(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})?$/i);
```

```sql
if p_cursor is not null
   and p_cursor !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}:([0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})?$' then
  return query select 'invalid_request'::text, null::jsonb;
  return;
end if;

... join active_edges edge on edge.target_product_id = walk.product_id
  and (
    edge.target_release_id is null
    or walk.release_id is null
    or edge.target_release_id = walk.release_id
  )
```

`walk.release_id IS NULL` means the prior product-wide edge applies to every release; it is not permission to cross tenant boundaries. Keep `organization_id` predicates in seed, edge, recursive step, and candidate output.

- [ ] **Step 5: Add the positive B1 control and a deep mixed-scope traversal test.**

```sql
perform pg_temp.check('the matching child release reaches its parent',
  v_b1_candidates.candidates -> 'candidates' @>
  jsonb_build_array(jsonb_build_object('productId', v_parent_product, 'releaseId', v_parent_release)));
```

The deep fixture must alternate product-wide (`NULL`) and release-specific edges, verify every returned path stays within the tenant, contains no repeated product IDs, and has at most 64 relationship IDs.

- [ ] **Step 6: Run all tests for the changed contracts and database functions.**

Run: `pnpm --filter contracts run test -- products`

Run: `pnpm --filter infrastructure run test -- m2-v1-variants-hierarchy-finding-propagation.test.sql`

Run: `pnpm --filter api run test -- product-use-cases supabase-product.repository`

Expected: release mismatch is excluded, matching release and product-wide scope are retained, malformed cursors return validation errors, and existing candidate parsing remains valid.

- [ ] **Step 7: Commit the correctness repair.**

```bash
git add apps/infrastructure/supabase/migrations/20260814100000_m2_v1_relationship_correctness.sql \
  apps/infrastructure/tests/m2-v1-variants-hierarchy-finding-propagation.test.sql \
  packages/contracts/src/products/schemas/product-relationship.schema.ts \
  packages/contracts/src/products.spec.ts
git commit -m "fix: scope relationship propagation by release"
```

### Task 3: Expose durable relationship-event claiming without owning finding data

**Files:**

- Modify: `apps/infrastructure/supabase/migrations/20260814101000_m2_v1_relationship_event_leases.sql`
- Modify: `apps/infrastructure/tests/m2-v1-variants-hierarchy-finding-propagation.test.sql`
- Create: `apps/api/src/products/application/product-relationship-event.port.ts`
- Modify: `apps/api/src/products/application/product-use-cases.ts`
- Modify: `apps/api/src/products/products.module.ts`
- Test: `apps/api/src/products/application/product-use-cases.spec.ts`

**Interfaces:**

- Produces `ProductRelationshipEventPort.claim|complete|fail`, an inward product boundary with organization-first commands and no finding payload.
- The database commands return event ID, organization ID, product ID, graph version, stable event key, checkpoint version, lease owner, retry count, and sanitized error code only.
- The future finding owner receives an event and calls `ProductRelationshipResolverPort` for candidates; it does not query product tables.

- [ ] **Step 1: Write SQL test cases for scheduled claim, expired-lease recovery, idempotent completion, retry backoff, dead letter, and tenant isolation.**

```sql
perform pg_temp.check('only one worker claims a scheduled relationship event',
  v_claim_one.outcome = 'claimed' and v_claim_two.outcome = 'none_available');
perform pg_temp.check('a different organization cannot claim the event',
  v_cross_tenant_claim.outcome = 'not_found');
perform pg_temp.check('a permanent failure becomes dead letter after the bounded retry policy',
  v_failed.outcome = 'dead_letter');
```

- [ ] **Step 2: Implement three service-role RPCs against only `product_regulatory_outbox_events`.**

```sql
claim_product_relationship_graph_event_atomic(
  p_organization_id uuid, p_lease_owner uuid, p_lease_seconds integer
)
complete_product_relationship_graph_event_atomic(
  p_organization_id uuid, p_event_id uuid, p_lease_owner uuid, p_expected_checkpoint_version integer
)
fail_product_relationship_graph_event_atomic(
  p_organization_id uuid, p_event_id uuid, p_lease_owner uuid, p_expected_checkpoint_version integer,
  p_error_code text, p_retryable boolean
)
```

The claim query selects only `event_type = 'product_relationship.graph_changed'`, with `FOR UPDATE SKIP LOCKED`, organization filter first, and either `scheduled`/`retrying` due rows or expired leases. Completion requires `leased`, matching owner, and checkpoint version. Failure clears the lease, uses capped exponential backoff for retryable failures, and sets `dead_letter` for non-retryable or exhausted work. Audit state changes without copying source payloads into logs.

- [ ] **Step 3: Add strict internal TypeScript types and map RPC rows through Zod.**

```ts
export interface ProductRelationshipEventPort {
  claim(command: Readonly<{ organizationId: string; leaseOwner: string; leaseSeconds: number }>): Promise<ProductRelationshipEventClaim>;
  complete(command: Readonly<{ organizationId: string; eventId: string; leaseOwner: string; checkpointVersion: number }>): Promise<ProductRelationshipEventCompletion>;
  fail(command: Readonly<{ organizationId: string; eventId: string; leaseOwner: string; checkpointVersion: number; errorCode: string; retryable: boolean }>): Promise<ProductRelationshipEventFailure>;
}
```

Bind the port in `ProductsModule` next to `PRODUCT_RELATIONSHIP_RESOLVER`; do not expose a browser controller endpoint for claim, complete, or fail.

- [ ] **Step 4: Run durable-state regression tests.**

Run: `pnpm --filter infrastructure run test -- m2-v1-variants-hierarchy-finding-propagation.test.sql`

Run: `pnpm --filter api run test -- product-use-cases`

Expected: duplicate delivery cannot claim twice, a restarted worker can reclaim after expiry, and no execution path queries a finding or SBOM table.

- [ ] **Step 5: Commit the product-owned queue boundary.**

```bash
git add apps/infrastructure/supabase/migrations/20260814101000_m2_v1_relationship_event_leases.sql \
  apps/infrastructure/tests/m2-v1-variants-hierarchy-finding-propagation.test.sql \
  apps/api/src/products/application/product-relationship-event.port.ts \
  apps/api/src/products/application/product-use-cases.ts \
  apps/api/src/products/products.module.ts \
  apps/api/src/products/application/product-use-cases.spec.ts
git commit -m "feat: lease relationship graph events"
```

### Task 4: Implement the finding-owned impact and override workflow after ownership confirmation

**Files:**

- Create: `docs/architecture/m2-v1-finding-impact-propagation.md`
- Create: `packages/contracts/src/findings/schemas/finding-impact.schema.ts`
- Create: `packages/contracts/src/findings/types/finding-impact.type.ts`
- Create: `apps/api/src/findings/application/finding-impact-propagation.port.ts`
- Create: `apps/api/src/findings/application/finding-impact-propagation-worker.ts`
- Create: `apps/api/src/findings/infrastructure/supabase-finding-impact.repository.ts`
- Create: `apps/infrastructure/supabase/migrations/20260814102000_m2_v1_finding_impacts.sql`
- Create: `apps/infrastructure/tests/m2-v1-finding-impact-propagation.test.sql`
- Create: `apps/web/app/(workspace)/products/finding-impact-status.tsx`
- Test: module-local unit, contract, SQL restart/tenant-isolation, and Playwright product-detail tests.

**Interfaces:**

- Consumes only `ProductRelationshipResolverPort.getRelationshipPropagationCandidates` and `ProductRelationshipEventPort` from `ProductsModule`.
- Produces one source finding plus many idempotent impact-association rows with `sourceFindingId`, relationship path IDs, graph version, rule version, evaluated timestamp, supersession/closure state, checkpoint/progress, retry, and dead-letter metadata.
- Produces an explicit, authorized and audited product-impact override controlled by a finding/triage permission chosen by the finding owner; it must never mutate baseline membership or relationship rows.

- [ ] **Step 1: Obtain the finding module ownership decision before creating a new aggregate.**

Record the selected package/module, existing finding identifier schema, triage/override permission names, evidence-retention/export source, and the source-finding status transitions in the feature design. If no finding aggregate exists, this task is blocked by that product decision; do not put the records in `products`.

- [ ] **Step 2: Write failing worker tests with a fake product resolver and event port.**

```ts
it("records each source-finding/product/path/version association once across duplicate delivery", async () => {
  await worker.handle(claimedEvent);
  await worker.handle(claimedEvent);
  expect(impactStore.upsert).toHaveBeenCalledTimes(1);
});

it("supersedes stale impacts when the event graph version no longer matches", async () => {
  await worker.handle(claimedEvent);
  expect(impactStore.supersedeStale).toHaveBeenCalledWith(expect.objectContaining({
    sourceFindingId, graphVersion: claimedEvent.graphVersion,
  }));
});
```

- [ ] **Step 3: Implement the finding-side transaction and restart recovery.**

Use a unique association key covering `organization_id`, `source_finding_id`, `affected_product_id`, nullable affected release scope, canonical path, graph version, and rule version. Persist the association before completing the product event; on a restart, repeat the upsert with the stable event key, then complete using the lease checkpoint. Never copy an analyst assessment; store an independent product-specific override record only when the finding/triage authorization port allows it.

- [ ] **Step 4: Add database and browser acceptance coverage.**

```sql
-- Assert a failed worker after partial upserts resumes without duplicate rows.
-- Assert product A cannot read or override product-impact rows for tenant B.
-- Assert ending a component link preserves prior impact rows and marks them superseded only after re-evaluation.
```

The browser test must show impact count, propagation in progress, partial failure/dead-letter, stale graph, empty, forbidden, and explicit override states without rendering finding evidence content.

- [ ] **Step 5: Verify performance and operational recovery at the NFR fixture size.**

Run a deterministic local fixture with 500 products, 5,000 releases, at least one hundreds-of-dependents fan-out, and synthetic impact identifiers only. Capture `EXPLAIN (ANALYZE, BUFFERS)` for candidate traversal and queue claim, assert indexed scans and depth `<= 64`, record fan-out and traversal timing, and keep the fixture out of everyday seeds. Document replay/dead-letter recovery and per-tenant claiming limits in the finding runbook.

- [ ] **Step 6: Commit the finding-owned feature in reviewable slices.**

```bash
git commit -m "feat: persist finding propagation impacts"
git commit -m "feat: add finding impact overrides"
git commit -m "test: cover finding propagation recovery"
```

### Task 5: Full verification and architecture gate

**Files:**

- Modify: `docs/architecture/m2-v1-variants-hierarchy-finding-propagation.md` only for decisions that actually changed in Tasks 1–4.
- Modify: `.github/workflows/ci.yml` only when the new NFR fixture can run deterministically in CI without changing existing route or auth jobs.

- [ ] **Step 1: Run focused regression suites.**

Run: `pnpm --filter contracts run test -- products`

Run: `pnpm --filter api run test -- product-relationship-graph-policy product-use-cases supabase-product.repository products.controller`

Run: `pnpm --filter web run test -- products.api product-relationship-section`

Run: `pnpm --filter infrastructure run test`

- [ ] **Step 2: Run static and architecture gates.**

Run: `pnpm --filter web run check-types`

Run: `pnpm --filter api run check-types`

Run: `pnpm test:architecture`

Run: `pnpm lint && pnpm check-types`

- [ ] **Step 3: Run integration and browser coverage.**

Run: `pnpm test`

Run the product relationship Playwright flow after API restart, including allowed preview, B1/B2 scope, stale graph reload, no duplicate associations after redelivery, and forbidden tenant access.

- [ ] **Step 4: Inspect the local Supabase database read-only.**

Run: `pnpm --filter infrastructure exec supabase migration list --local`

Run: `pnpm --filter infrastructure exec supabase db lint --local`

Use read-only catalog queries to confirm new tables have RLS, no browser grants, every new `security definer` function has a pinned search path and non-public execute, and every graph/impact foreign key has an index.

- [ ] **Step 5: Review the final diff and commit only task-owned files.**

Run: `git diff --check`

Run: `git diff -- apps/api/src/products apps/api/src/findings apps/infrastructure/supabase packages/contracts/src/findings packages/contracts/src/products apps/web/app/'(workspace)'/products docs/architecture docs/superpowers/plans`

Do not stage or revert unrelated uncommitted product-relationship or routing work.

## Self-review

- Spec coverage: Tasks 1–3 correct the verified product-side failures: preview response contract, release-aware candidates, cursor validation, and recoverable queue mechanics. Task 4 covers source-finding impacts, overrides, supersession, and worker recovery, but is explicitly gated by the missing finding aggregate rather than hiding it in M2.
- Deliberate gap: no task can truthfully create source-finding IDs, assessment state, or triage overrides before their owning module and permission names exist. That is a product/architecture decision, not a safe inference.
- Type consistency: product ports use `organizationId` first; candidate traversal remains read-only; queue claims use `eventId`, `leaseOwner`, and `checkpointVersion`; all public request/response data use Zod schemas.
- Placeholder scan: no implementation step relies on an unspecified code location except Task 4, which is intentionally blocked pending the explicit owner selection required by the BRD boundary.

## Execution status

This audit selects inline validation, not implementation, because the current task asked whether the existing work is successful and the incomplete finding aggregate has no established module owner. Tasks 1–3 are ready for a follow-up implementation request; Task 4 must begin with the stated ownership decision.
