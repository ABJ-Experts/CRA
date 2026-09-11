# Published Organization Dashboard Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the active organization’s published branding palette, display name, and logo across its authenticated dashboard, while drafts remain editor-only and the current design system remains the fallback.

**Architecture:** A dashboard-scoped client provider derives the verified active organization from the existing session context, fetches the existing resolved-branding API under a tenant-partitioned React Query key, and writes only published colors as CSS variables on the dashboard subtree. A separate published-logo resolver prevents drafts from being rendered in the global shell. The existing shared Zod branding response remains the only JSON wire contract.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, TanStack Query 5, Tailwind CSS 4, NestJS 11, Supabase/Postgres, Zod, Vitest, Jest, Playwright.

## Global Constraints

- Use Node 20+ and pnpm only; preserve unrelated dirty worktree changes and do not commit without explicit user approval.
- Keep all JSON routes under `/api/v1`, parse consumed inputs and successful JSON outputs with existing shared contracts, and keep controllers free of direct Supabase calls.
- The API remains authoritative for active organization, membership, RBAC, and tenant scope; the browser organization ID partitions cache only and is never sent as authority input.
- Only `source: "published"` changes the dashboard; sentinel, draft preview, loading, error, logout, and unmount use the neutral design-system fallback.
- Auth/public/docs screens, structural surface/foreground tokens, and status colors remain unchanged.
- Use the existing contrast-confirmed `primaryText` foreground for filled primary components; do not hard-code white.
- The existing draft-preview logo route must never render the dashboard logo. A published-only route and resolver are required.

---

## File structure

- `packages/contracts/src/organizations/schemas/organization-branding.schema.ts` owns the code fallback palette.
- `apps/infrastructure/supabase/migrations/20260812150000_m1_v2_published_organization_theme_defaults.sql` updates only fallback JSON and adds a service-role, org-first published-logo resolver.
- `apps/api/src/organizations/branding/{application,branding.controller.ts,branding.service.ts,infrastructure}` exposes the authenticated published-logo binary boundary through inward ports.
- `apps/web/app/_features/organizations/active-organization-branding.queries.ts` owns the tenant-partitioned resolved-branding query.
- `apps/web/app/dashboard/organization-theme-provider.tsx` owns dashboard-only query, CSS variable, and trusted branding context lifecycle.
- `apps/web/app/globals.css` maps the dashboard’s published variables to existing Tailwind semantic/active token names.
- `apps/web/app/dashboard/layout.tsx` mounts the provider around every dashboard surface.
- `apps/web/app/_components/sidebar/sidebar.tsx` consumes the trusted dashboard branding context to render the published identity.

## Task 1: Align server and contract fallback defaults; add a published-logo resolver

**Files:**
- Modify: `packages/contracts/src/organizations/schemas/organization-branding.schema.ts`
- Modify: `packages/contracts/src/organizations/schemas/organization-branding.spec.ts`
- Create: `apps/infrastructure/supabase/migrations/20260812150000_m1_v2_published_organization_theme_defaults.sql`
- Modify: `apps/infrastructure/tests/m1-v2-multi-entity-branding.test.sql`
- Modify: `apps/api/src/organizations/branding/application/branding-use-cases.ts`
- Modify: `apps/api/src/organizations/branding/application/branding-use-cases.spec.ts`
- Modify: `apps/api/src/organizations/branding/infrastructure/supabase-branding.repository.ts`
- Modify: `apps/api/src/organizations/branding/infrastructure/supabase-branding.repository.spec.ts`
- Modify: `apps/api/src/organizations/branding/branding.service.ts`
- Modify: `apps/api/src/organizations/branding/branding.service.spec.ts`
- Modify: `apps/api/src/organizations/branding/branding.controller.ts`
- Modify: `apps/api/src/organizations/branding/branding.controller.spec.ts`

**Interfaces:**
- Produces `GET /api/v1/organizations/current/branding/logo` as a guarded `@NonJsonResponse("stream")` endpoint with the same safe `404/502/503` mapping as the preview renderer.
- Produces `BrandingRepository.getRenderablePublishedLogo(orgId, actorId)` and `BrandingUseCases.renderPublishedLogo({ organizationId, actorId })`.
- Does not change the existing `/logo/preview` route, which remains draft-first for the editor.

- [ ] **Step 1: Write failing contract and API tests.**

  Assert `CRA_SENTINEL_BRANDING.palette` is exactly `{ primary: "#595FE5", primaryText: "#FFFFFF", secondary: "#ADB0ED", secondaryText: "#000000" }`. Add controller metadata tests that `renderPublishedLogo` has path `logo`, requires `can_view_organization`, uses no role requirement, and forwards only guard-owned `{ organizationId, actorId }`. Add use-case and repository tests in which `getRenderablePublishedLogo` calls `get_organization_branding_published_logo_render` with `p_organization_id` first and returns `not_found` without an object key.

- [ ] **Step 2: Run the focused tests and confirm red.**

  Run: `pnpm --filter @repo/contracts run test -- organization-branding && pnpm --filter api run test -- branding.controller branding.service branding-use-cases supabase-branding.repository`

  Expected: the new assertions fail because the default palette, method, RPC, and binary route do not exist.

- [ ] **Step 3: Implement the smallest safe server path.**

  Change `sentinelPalette` to the four values above. In the new migration, use `CREATE OR REPLACE FUNCTION public.m1_v2_sentinel_branding_json()` with the same return shape and updated palette, then create:

  ```sql
  create function public.get_organization_branding_published_logo_render(
    p_organization_id uuid,
    p_actor_user_id uuid
  ) returns table (outcome text, object_key text, sha256 text)
  language plpgsql security definer set search_path = public, pg_temp;
  ```

  The function must verify exact active membership for `p_actor_user_id`, read only the current published version’s approved asset, verify the private storage object exists, return generic `not_found` for every inaccessible/missing case, be owned by `postgres`, revoke `PUBLIC`, `anon`, and `authenticated`, and grant only `service_role`. It must never read `organization_branding_drafts`.

  Add the corresponding repository port/method, reuse the existing storage download and provider-error mapping in a dedicated `renderPublishedLogo()` use case, service facade method, and controller stream response. Set `Content-Type`, `Cache-Control: private, no-store`, and ETag exactly as the editor preview route does.

- [ ] **Step 4: Extend the live SQL characterization.**

  Add assertions to `m1-v2-multi-entity-branding.test.sql` that the fallback JSON has the four default values and that a valid published logo resolves while a newer approved draft logo cannot change the published resolver result. Assert a non-member gets only `not_found`.

- [ ] **Step 5: Run focused verification.**

  Run: `pnpm --filter @repo/contracts run test -- organization-branding && pnpm --filter api run test -- branding && pnpm --filter infrastructure run test -- m1-v2-multi-entity-branding.test.sql && pnpm --filter api run check-types`

  Expected: all pass; new route has no JSON contract exemption error and the migration is tenant-safe.

## Task 2: Create the published-only dashboard branding query and provider

**Files:**
- Create: `apps/web/app/_features/organizations/active-organization-branding.queries.ts`
- Create: `apps/web/app/_features/organizations/active-organization-branding.queries.spec.tsx`
- Create: `apps/web/app/dashboard/organization-theme-provider.tsx`
- Create: `apps/web/app/dashboard/organization-theme-provider.spec.tsx`
- Modify: `apps/web/app/dashboard/layout.tsx`
- Modify: `apps/web/app/dashboard/dashboard-pages.spec.tsx`

**Interfaces:**
- Produces `useActiveOrganizationBrandingQuery(organizationId: string | null, enabled: boolean)` with key `[..., "branding", organizationId ?? "none"]` and request `organizationsApi.branding(signal)`.
- Produces `useDashboardOrganizationBranding(): ResolvedOrganizationBranding | null`; this returns non-null only for a published snapshot.

- [ ] **Step 1: Write the failing query/provider tests.**

  Verify an active organization ID creates `queryKey: ["organizations", "current", "branding", organizationId]`, no ID disables the query, and the API request contains no ID. Render the provider with published data and assert its `contents` wrapper has `data-organization-theme="published"` plus primary/secondary variables. Rerender from org A to org B with loading data and assert the old variables disappear before B’s result arrives. Assert sentinel, draft preview, null session, error, and unmount all clear the variables/context.

- [ ] **Step 2: Run the focused tests and confirm red.**

  Run: `pnpm --filter web run test -- active-organization-branding organization-theme-provider`

  Expected: modules and provider composition are missing.

- [ ] **Step 3: Implement query partition and dashboard-only context.**

  Build `queryOptions` with `enabled && organizationId !== null`, `retry: false`, the existing `ORGANIZATIONS_STALE_TIME_MS`, and the existing JSON gateway. In `OrganizationThemeProvider`, read `useSession()`, pass the session’s `organization?.id`, and return:

  ```tsx
  <DashboardOrganizationBrandingContext.Provider value={publishedBranding}>
    <div className="contents" data-organization-theme={publishedBranding ? "published" : undefined} style={publishedStyle}>
      {children}
    </div>
  </DashboardOrganizationBrandingContext.Provider>
  ```

  `publishedStyle` contains only the four parsed palette properties. The provider must use resolved branding only, never call `previewBranding`, and derive all values immutably. Add it inside `DashboardLayout`, surrounding the current shell but not the root app or auth layout.

- [ ] **Step 4: Run query/provider/layout tests and typecheck.**

  Run: `pnpm --filter web run test -- active-organization-branding organization-theme-provider dashboard-pages && pnpm --filter web run check-types`

  Expected: cache isolation and fallback cleanup are covered without changing mock-mode behavior or dashboard geometry.

## Task 3: Map published colors to dashboard design tokens and sidebar identity

**Files:**
- Modify: `apps/web/app/globals.css`
- Modify: `packages/ui/src/components/button/button.variants.ts`
- Modify: `packages/ui/src/components/button/button.spec.tsx`
- Modify: `apps/web/app/_components/sidebar/sidebar.tsx`
- Modify: `apps/web/app/_components/sidebar/sidebar.spec.tsx`
- Modify: `apps/web/app/dashboard/organization-branding-section.spec.tsx`

**Interfaces:**
- Consumes `data-organization-theme="published"`, `--organization-brand-primary`, `--organization-brand-primary-text`, `--organization-brand-secondary`, and `--organization-brand-secondary-text` from Task 2.
- Consumes `useDashboardOrganizationBranding()` from Task 2.

- [ ] **Step 1: Write failing visual-semantic tests.**

  Assert primary filled buttons use `text-on-accent`, sidebar’s logo mark uses `text-on-accent`, and fallback sidebar renders `CRA`/`C`. With a published context fixture containing a logo, assert the accessible brand name is rendered and its image source is exactly `/api/v1/organizations/current/branding/logo`; with a sentinel or null context, assert no image and the CRA fallback. Extend the Branding section test to pin default resolved colors shown in the editor.

- [ ] **Step 2: Run tests and confirm red.**

  Run: `pnpm --filter web run test -- sidebar button organization-branding-section`

  Expected: context hook, published logo, and `text-on-accent` assertions fail.

- [ ] **Step 3: Add scoped CSS and consume identity.**

  Add an unlayered dashboard selector in `globals.css` that only applies beneath `[data-organization-theme="published"]`. Map `--color-active-500` to primary, derive active hover/subtle shades with `color-mix(in srgb, ...)`, map `--color-accent` and `--color-on-accent` to primary and `primaryText`, and map `--color-accent-subtle` to a conservative primary/canvas mix. Use secondary only for a dedicated branded sidebar identity surface with its contract-supplied foreground; do not change `canvas`, `surface`, `border`, `fg`, or status variables.

  In button variants replace only filled-primary `text-white` with `text-on-accent`. In the sidebar read the dashboard context: published `displayName` replaces CRA; when `logo !== null`, render the new published-only logo route with the returned `altText ?? displayName`; otherwise retain the `C` mark. Keep nav access behavior and `CRA` fallback intact.

- [ ] **Step 4: Run focused web tests and visual architecture checks.**

  Run: `pnpm --filter web run test -- sidebar button organization-branding-section && pnpm --filter web run test -- design-rules fetch-boundaries && pnpm --filter web run check-types && pnpm --filter web run lint`

  Expected: visual semantics, fallback, no direct fetch, and token rules pass.

## Task 4: Verify published behavior on the local live stack

**Files:**
- Modify: `apps/web/e2e/organization-branding-theme.spec.ts` (create if no suitable branding E2E exists)

**Interfaces:**
- Uses seeded owner credentials and the existing organization branding UI/API.
- Verifies server-backed published state only; no direct database/browser-storage manipulation.

- [ ] **Step 1: Write the failing browser flow.**

  Sign in as the local owner, navigate to Organization administration, enter a valid new draft palette and display name, save it, then assert the dashboard wrapper and sidebar still use fallback values. Publish the draft, wait for the resolved snapshot, and assert the wrapper uses the two published palette values, a primary action uses the brand primary, and the sidebar uses the published display name. Create/select another organization if fixture support already exists, or assert a logout clears the dashboard wrapper; it must never retain the previous organization values.

- [ ] **Step 2: Run it and confirm red.**

  Run: `pnpm --filter web exec playwright test e2e/organization-branding-theme.spec.ts`

  Expected: the current dashboard is not themed after publication.

- [ ] **Step 3: Apply the new migration to the local stack and execute focused live verification.**

  Run: `pnpm --filter infrastructure run db:reset && pnpm --filter infrastructure run test -- m1-v2-multi-entity-branding.test.sql && pnpm --filter api run build && pnpm --filter web exec playwright test e2e/organization-branding-theme.spec.ts`

  Expected: the draft has no global effect, publication themes only the signed-in organization dashboard, and the fallback remains neutral after session removal.

- [ ] **Step 4: Run completion gates and review only owned paths.**

  Run: `pnpm --filter @repo/contracts run test -- organization-branding && pnpm --filter api run test -- branding && pnpm --filter web run test -- active-organization-branding organization-theme-provider sidebar button organization-branding-section && pnpm --filter web run check-types && pnpm --filter api run check-types && pnpm test:architecture && git diff --check`

  Expected: all focused test, type, architecture, and whitespace checks pass. Inspect the diff only for the files in this plan and report any existing unrelated failures separately.
