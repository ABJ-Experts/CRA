# M1–M4 BRD Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the verified M1–M4 gaps against `CRA-Sentinel-Technical-BRD-v2.0-ABJ-Experts.pdf`, and prove the complete organisation-to-vulnerability journey in a real browser against the local Supabase stack.

**Architecture:** Preserve the existing feature boundary: React functional components call feature gateway classes/hooks, which parse shared Zod contracts on both sides of `/api/v1`; Nest controllers remain thin and call application ports/use cases; infrastructure adapters scope all service-role access by organisation. Do not create a second product, SBOM, or vulnerability data path for tests: browser, CI, and API ingestion must converge on the same use cases and database functions.

**Tech Stack:** pnpm/Turborepo, Next.js 16, React 19, TypeScript, NestJS 11, Zod in `@repo/contracts`, Supabase/Postgres, Vitest/Jest, Playwright.

**Spec:** [CRA-Sentinel-Technical-BRD-v2.0-ABJ-Experts.pdf](/Users/abjmac003/Downloads/CRA-Sentinel-Technical-BRD-v2.0-ABJ-Experts.pdf), especially FR-ORG-001–008, FR-PROD-001–014, FR-SBOM-001–016, and FR-VULN-001–016.

## Global Constraints

- Use Node 20+ and pnpm only; run commands from the repository root.
- Preserve the API prefix `/api/v1`, `cra_at`/`cra_rt` cookie names, and narrow `REFRESH_COOKIE_PATH`.
- Every request and successful response uses a shared feature-first Zod contract in `@repo/contracts`.
- Tenant identity comes from verified session membership, never from a client body, query, or route segment.
- `service_role` remains explicitly organisation-scoped until the separate ADR decision resolves the BRD restricted-role/forced-RLS conflict.
- Every mutation emits audit evidence and has allow/deny tenant-authorisation tests.
- Never hand-edit generated Supabase types; regenerate through `pnpm --filter infrastructure run db:types` after an approved migration.
- Do not use regulatory guesswork: CRA classification needs a counsel-approved decision table; live-report submission remains M6 work.
- A database reset is destructive. During execution, use an isolated local test database or obtain explicit confirmation immediately before resetting the shared local database.

---

## Delivery order

1. Make the live browser baseline reliable.
2. Close M1 policy/form gaps and prove every M1 form.
3. Close M2 classification and product-form gaps.
4. Close M3 large-file/export/quality gaps.
5. Close M4 deterministic-priority/manual-finding/feedback gaps.
6. Prove the full M1 → M4 browser journey and CI gate.

### Task 1: Stabilise active-organisation access and create an isolated E2E baseline

**Files:**

- Modify: `apps/api/src/auth/supabase-auth.guard.ts`
- Modify: `apps/web/app/_features/session/session.queries.ts`
- Modify: `apps/web/e2e/fixtures/*` or create `apps/web/e2e/fixtures/cra-live.ts`
- Modify: `apps/web/e2e/auth-session.spec.ts`
- Create: `apps/web/e2e/active-organization-access.spec.ts`

**Interfaces:**

- Consumes: signed `cra_org` handling in `apps/api/src/auth/cookies.util.ts`.
- Produces: `signInAsOwner(page)` and `createRunScopedOrganization(request)` test fixtures; a verified active organisation available to `/organization`, `/products`, and SBOM routes.

- [ ] **Step 1: Write a failing browser regression test for the current inconsistency.**

```ts
test("an owner with an active organization can open product registry", async ({ page }) => {
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "Organization administration" })).toBeVisible();
  await page.goto("/products");
  await expect(page.getByText("Create or join an organization before managing products")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
});
```

- [ ] **Step 2: Run the focused test against `E2E_WEB_ORIGIN=http://127.0.0.1:3003`.**

Run: `pnpm --filter web exec playwright test e2e/active-organization-access.spec.ts --project=chromium`

Expected: the test fails before the access/session mismatch is corrected.

- [ ] **Step 3: Trace the active organisation from cookie verification through `CurrentUser` and session queries; repair the single broken boundary.**

The repaired behavior must satisfy this invariant:

```ts
expect(await productsApi.list({ limit: 25 })).toMatchObject({ rows: expect.any(Array) });
// A valid signed active organisation must not be downgraded to “no organization”.
```

- [ ] **Step 4: Add a cross-tenant negative test.**

```ts
await expect(otherTenantRequest.get(`/api/v1/products/${productId}`)).resolves.toMatchObject({ status: 404 });
```

- [ ] **Step 5: Run focused API, web, and browser checks.**

Run: `pnpm --filter api test -- supabase-auth-tenant-scope && pnpm --filter web test -- session && E2E_WEB_ORIGIN=http://127.0.0.1:3003 pnpm --filter web exec playwright test e2e/active-organization-access.spec.ts`

Expected: all pass; no browser route relies on mock data.

- [ ] **Step 6: Commit the isolated fix.**

```sh
git add apps/api/src/auth apps/web/app/_features/session apps/web/e2e
git commit -m "fix: preserve active organization across workspace routes"
```

### Task 2: Close M1 organisation-policy and form coverage

**Files:**

- Modify: `packages/contracts/src/organizations/schemas/*`
- Modify: `apps/api/src/organizations/organizations.controller.ts`
- Modify: `apps/api/src/organizations/application/*`
- Modify: `apps/web/app/(workspace)/organization/organization-settings-retention.tsx`
- Modify: `apps/web/app/(workspace)/organization/organization-legal-entities-section.tsx`
- Modify: `apps/web/e2e/tenant-administration.spec.ts`
- Create: `apps/web/e2e/tenant-lifecycle.spec.ts`

**Interfaces:**

- Consumes: server-owned settings catalog and current retention response contracts.
- Produces: an explicit `idleTimeoutMinutes` setting if the product supports it; every M1 UI field persisted and reloaded by browser E2E.

- [ ] **Step 1: Decide the session-policy contract before changing UI.**

The schema must separate the maximum age from idle timeout; do not overload one field.

```ts
export const organizationSessionPolicySchema = z.object({
  maximumSessionAgeMinutes: z.number().int().min(60).max(480),
  idleTimeoutMinutes: z.number().int().min(5).max(60),
});
```

- [ ] **Step 2: Write failing contract/API tests for invalid session policy and every settings field.**

```ts
expect(organizationSessionPolicySchema.safeParse({
  maximumSessionAgeMinutes: 60,
  idleTimeoutMinutes: 0,
}).success).toBe(false);
```

- [ ] **Step 3: Implement the server contract, storage, audited update, and UI controls.**

Use the existing Zod body/response decorators. Keep MFA enforcement disabled until the server reports all members enrolled; preserve the date-picker holiday behavior already introduced in the UI.

- [ ] **Step 4: Extend browser E2E to persist and reload all M1 settings.**

```ts
await page.getByLabel("Organization holidays").fill("2026-12-25");
await page.getByRole("button", { name: "Add holiday" }).click();
await page.getByLabel("Email").check();
await page.getByLabel("In App").check();
await page.getByRole("button", { name: "Save settings" }).click();
await page.reload();
await expect(page.getByText("2026-12-25")).toBeVisible();
```

- [ ] **Step 5: Add legal-entity CRUD, branding, export, and tenant-lifecycle scenarios.**

The lifecycle scenario must prove a protected purge names its retention/legal-hold blocker and that no data is purged in the test's rollback transaction.

- [ ] **Step 6: Verify and commit.**

Run: `pnpm --filter contracts test -- organizations && pnpm --filter api test -- organizations && E2E_WEB_ORIGIN=http://127.0.0.1:3003 pnpm --filter web exec playwright test e2e/tenant-administration.spec.ts e2e/tenant-lifecycle.spec.ts`

Commit: `git commit -m "feat: complete organization policy controls"`

### Task 3: Deliver the missing CRA classification workflow and repair M2 form usability

**Files:**

- Create: `docs/architecture/m2-classification-decision-table.md`
- Create: `packages/contracts/src/products/schemas/product-classification.schema.ts`
- Modify: `packages/contracts/src/products/schemas/index.ts`
- Modify: `apps/api/src/products/products.controller.ts`
- Create: `apps/api/src/products/application/product-classification-policy.ts`
- Modify: `apps/web/app/(workspace)/products/product-detail-content.tsx`
- Modify: `apps/web/app/(workspace)/products/products-registry-content.tsx`
- Modify: `apps/web/e2e/product-registry.spec.ts`
- Create: `apps/web/e2e/product-classification.spec.ts`

**Interfaces:**

- Consumes: counsel-approved answers and outcomes in the decision-table document.
- Produces: `classifyProduct(input): ProductClassificationResult`, stored answer history, rationale, decision-table version, and browser-accessible review history.

- [ ] **Step 1: Obtain and record the counsel-approved decision table.**

Do not implement classifications until the document defines each question, permitted answer, outcome, rationale requirements, and effective version. If counsel has not supplied it, stop this task after adding no product behavior.

- [ ] **Step 2: Write failing policy tests from approved table examples.**

```ts
expect(classifyProduct({ answers: { remoteDataProcessing: true } })).toEqual({
  classification: "out_of_scope",
  rationaleRequired: true,
  decisionTableVersion: "2026-09-02",
});
```

- [ ] **Step 3: Implement questionnaire/history with immutable answer snapshots.**

The controller receives only the contract input, resolves organisation from the authenticated member, and emits an audit event containing before/after classification state.

- [ ] **Step 4: Replace raw product owner UUID entry with an authorised member selector; replace placed-on-market text entry with a timezone-labelled datetime control.**

```tsx
<select aria-label="Responsible owner" value={ownerUserId} onChange={onOwnerChange}>
  {assignableMembers.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
</select>
```

- [ ] **Step 5: Add browser scenarios for every M2 create/edit/release/lifecycle field.**

The test must create products and releases in the browser, not with `context.request.post`, then assert saved type, owner, description, market states, support record, alert intervals, archive result, and retention explanation.

- [ ] **Step 6: Verify and commit.**

Run: `pnpm --filter contracts test -- products && pnpm --filter api test -- products && E2E_WEB_ORIGIN=http://127.0.0.1:3003 pnpm --filter web exec playwright test e2e/product-registry.spec.ts e2e/product-classification.spec.ts`

Commit: `git commit -m "feat: add CRA product classification workflow"`

### Task 4: Complete M2 relationship/sync proof without creating a second source of truth

**Files:**

- Modify: `apps/web/app/(workspace)/products/product-relationship-section.tsx`
- Modify: `apps/web/app/(workspace)/connectors/connector-conflicts-section.tsx`
- Modify: `apps/web/e2e/product-relationships.spec.ts`
- Modify: `apps/web/e2e/connector-sync.spec.ts`

**Interfaces:**

- Consumes: existing relationship, connector mapping, field-authority, and finding-propagation contracts.
- Produces: a browser-visible propagation preview and field-authority conflict decision linked to existing connector-sync records.

- [ ] **Step 1: Write failing browser tests for variant/component propagation and connector conflict resolution.**

```ts
await expect(page.getByText("Affected dependent products: 2")).toBeVisible();
await page.getByLabel("Resolution").selectOption("keep_local");
await page.getByLabel("Reason").fill("Regulatory owner confirmed local record.");
```

- [ ] **Step 2: Implement only the missing visual/API wiring.**

Reuse existing connector authority contracts. The product feature must not write connector tables directly.

- [ ] **Step 3: Verify no duplicate finding assessment is created for a propagated component.**

```ts
await expect(page.getByText("1 shared assessment reused")).toBeVisible();
```

- [ ] **Step 4: Run and commit.**

Run: `E2E_WEB_ORIGIN=http://127.0.0.1:3003 pnpm --filter web exec playwright test e2e/product-relationships.spec.ts e2e/connector-sync.spec.ts`

Commit: `git commit -m "test: prove product relationship and sync flows"`

### Task 5: Make M3 ingestion safe for large files and close SBOM contract gaps

**Files:**

- Modify: `apps/web/app/(workspace)/products/sbom-intake-section.tsx`
- Modify: `apps/web/app/_features/sboms/sboms.api.ts`
- Modify: `apps/api/src/sboms/*`
- Modify: `packages/contracts/src/sboms/schemas/*`
- Modify: `apps/web/e2e/sbom-validation.spec.ts`
- Create: `apps/web/e2e/sbom-format-matrix.spec.ts`

**Interfaces:**

- Consumes: current upload reservation/complete protocol and immutable content-hash contract.
- Produces: incremental browser hashing or server-issued upload integrity verification, exact format matrix results, and VEX-export capability represented explicitly.

- [ ] **Step 1: Write failing tests for a streamed/large upload and every supported format pair.**

```ts
const formats = ["cdx-1.4-json", "cdx-1.5-json", "cdx-1.6-xml", "spdx-2.2-json", "spdx-2.3-tag", "spdx-3.0-json"] as const;
test.each(formats)("validates %s", async (format) => { /* fixture upload and validation assertions */ });
```

- [ ] **Step 2: Remove the unconditional `file.arrayBuffer()` requirement from the browser path.**

Use a chunked hash implementation or make the API/storage completion protocol compute and verify the authoritative SHA-256. Keep byte-exact source immutability unchanged.

- [ ] **Step 3: Add explicit contracts/UI states for quality regression and VEX export availability.**

```ts
export const sbomQualityRegressionSchema = z.object({
  previousDocumentId: z.string().uuid(),
  scoreDelta: z.number(),
  materiallyLower: z.boolean(),
  reasons: z.array(z.string()).min(1),
});
```

- [ ] **Step 4: Add browser checks for invalid-is-retained, BSI report, diff, dedupe, historical retention, supplier provenance, and export.**

- [ ] **Step 5: Verify and commit.**

Run: `pnpm --filter api test -- sbom && E2E_WEB_ORIGIN=http://127.0.0.1:3003 pnpm --filter web exec playwright test e2e/sbom-validation.spec.ts e2e/sbom-format-matrix.spec.ts`

Commit: `git commit -m "feat: harden SBOM ingestion and quality reporting"`

### Task 6: Close M4 deterministic decisions and finding-creation requirements

**Files:**

- Create: `packages/contracts/src/vulnerabilities/schemas/vulnerability-priority.schema.ts`
- Modify: `packages/contracts/src/vulnerabilities/schemas/index.ts`
- Create: `apps/api/src/vulnerabilities/application/vulnerability-priority-policy.ts`
- Modify: `apps/api/src/vulnerabilities/vulnerability-matching.controller.ts`
- Modify: `apps/api/src/vulnerabilities/infrastructure/*`
- Modify: `apps/web/app/_features/vulnerabilities/vulnerability-matching-results.tsx`
- Create: `apps/web/e2e/vulnerability-priority-and-manual-finding.spec.ts`

**Interfaces:**

- Produces: deterministic `priorityScore`, `priorityFormulaVersion`, and factor explanation; manual-finding input; structured false-positive reason; per-method quality metrics.

- [ ] **Step 1: Write failing deterministic-priority tests.**

```ts
expect(scoreFinding({ cvss: 9.8, kevListed: true, epss: 0.9, lifecycleState: "in_support" })).toEqual({
  score: 100,
  formulaVersion: "v1",
  factors: expect.arrayContaining(["kev", "cvss", "epss", "lifecycle"]),
});
```

- [ ] **Step 2: Implement the pure, versioned policy and persist its output.**

Do not call an AI model. Parse all data through a Zod contract and display factor-level evidence in the finding UI.

- [ ] **Step 3: Write failing API/browser tests for manual findings and structured false-positive feedback.**

```ts
await page.getByRole("button", { name: "Create manual finding" }).click();
await page.getByLabel("Advisory identifier").fill("INTERNAL-2026-001");
await page.getByLabel("False-positive reason").selectOption("component_not_present");
```

- [ ] **Step 4: Implement permission-gated manual creation and feedback metrics.**

Every manual finding needs product/release/component context, source/provenance, author, audit event, tenant scope, and a 404 result for cross-tenant IDs.

- [ ] **Step 5: Keep M6 handoff explicitly safe.**

The KEV action may open a reporting intent, but it must never claim an obligation exists or submit anything until M6 supplies the reporting port.

- [ ] **Step 6: Verify and commit.**

Run: `pnpm --filter api test -- vulnerabilities && E2E_WEB_ORIGIN=http://127.0.0.1:3003 pnpm --filter web exec playwright test e2e/vulnerability-priority-and-manual-finding.spec.ts`

Commit: `git commit -m "feat: complete deterministic vulnerability decisions"`

### Task 7: Prove real M4 operations and the complete M1–M4 browser journey

**Files:**

- Modify: `apps/web/e2e/organization-onboarding.spec.ts`
- Create: `apps/web/e2e/m1-m4-live-journey.spec.ts`
- Modify: `apps/web/e2e/vulnerability-feed-health.spec.ts`
- Modify: `apps/web/e2e/vulnerability-reachability-review.spec.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: the earlier test fixtures and production web/API/Supabase boundaries.
- Produces: one isolated, browser-only critical journey and a CI result that is meaningful without mocks.

- [ ] **Step 1: Write the end-to-end test as browser actions, not API setup.**

```ts
test("owner completes M1 through M4 journey", async ({ page }) => {
  await createOrganizationInBrowser(page);
  await createProductAndReleaseInBrowser(page);
  await uploadSbomInBrowser(page, "fixtures/cyclonedx-valid.json");
  await seedOr-import-a-signed-local-feed-fixture(page);
  await expect(page.getByText("Why this finding matched")).toBeVisible();
  await recordHumanVerdictInBrowser(page, "not_affected", "component_not_present");
});
```

- [ ] **Step 2: Use a deterministic local feed fixture, not an external provider.**

The test must exercise the same signed-offline import path used by air-gapped deployments, then assert mirror age, source version, PURL match provenance, enrichment, priority factors, and audit-visible verdict.

- [ ] **Step 3: Convert mocked reachability coverage into a live route test where a supported analyzer fixture exists.**

Unsupported analyzers must display the safe unavailable/unsupported state; no test may fabricate a reachability verdict.

- [ ] **Step 4: Add a clean-database execution target that requires explicit confirmation when run locally.**

```json
{
  "scripts": {
    "test:e2e:m1-m4": "playwright test e2e/m1-m4-live-journey.spec.ts --project=chromium"
  }
}
```

- [ ] **Step 5: Add CI ordering: migrations → infrastructure/RLS tests → API build → local API/web → M1–M4 browser journey.**

Run: `pnpm verify && pnpm --filter infrastructure run test && E2E_WEB_ORIGIN=http://127.0.0.1:3003 pnpm --filter web run test:e2e:m1-m4`

Expected: one green, non-mocked journey and no generated test-result artefacts committed.

- [ ] **Step 6: Commit and produce release evidence.**

Commit: `git commit -m "test: verify M1 to M4 live browser journey"`

## Plan self-review

- **BRD coverage:** M1 settings/export/lifecycle, M2 classification/registry/lifecycle/sync, M3 ingestion/quality/export/retention, and M4 priority/manual finding/feedback/operations each have an owned task. M6 reporting is intentionally not pulled into scope; Task 6 preserves a safe handoff.
- **Required external decision:** Task 3 cannot proceed without a counsel-approved CRA classification decision table. This is a true authority dependency, not an engineering omission.
- **Testing coverage:** Every task starts with a focused failing test, ends with focused verification, and Task 7 provides the required real browser proof.
- **Compatibility:** No task changes frozen auth-action signatures, API prefix, cookies, permission merge order, or mock namespace.
- **No placeholder scan:** The plan uses concrete files, interfaces, tests, commands, and commit subjects; implementation choice is constrained by the existing architecture and contracts.
