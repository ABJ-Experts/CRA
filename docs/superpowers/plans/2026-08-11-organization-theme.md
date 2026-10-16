# Organization-wide Published Branding Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the active organisation's server-resolved, published branding palette theme every authenticated web surface through semantic CSS tokens, with a sentinel fallback that cannot retain another tenant's branding.

**Architecture:** A new active-organisation React Query key partitions branding cache by the session-derived organisation ID; the existing API still determines tenant identity from the authenticated cookie. `OrganizationThemeProvider` consumes that parsed query at the root provider boundary and maps a published snapshot into scoped document CSS properties. Existing semantic design-system tokens alias those properties, while primary filled surfaces use the contract-supplied `primaryText` token instead of hardcoded white.

**Tech Stack:** Next.js 16 / React 19, TypeScript 5.9, TanStack Query 5, Vitest + Testing Library, Tailwind CSS 4, shared Zod contracts.

## Global Constraints

- Use Node 20+ and pnpm only; preserve the dirty M1-v2 worktree and make no unrelated formatting edits.
- Reuse `organizationBrandingResponseSchema` and `ResolvedOrganizationBranding`; do not add a browser Supabase call, endpoint, database migration, generated type, or DTO.
- Only `source: "published"` may change document theme variables. `sentinel`, `draft_preview`, null data, query loading/error, logout, and unmount must clear them.
- The organisation ID is a React Query cache partition derived from the verified session response, never an API authority input; `/api/v1/organizations/current/branding` remains server-scoped.
- Preserve existing ES256/JWKS auth, `/api/v1` proxy/cookie behavior, mocks behavior, `data-theme` light/dark selection, semantic token use, and public/auth-page sentinel appearance.
- Use immutable values, functional React components, explicit Zod-derived trusted types, and focused colocated Vitest tests. Do not commit without the user's explicit authorisation.

---

## File Structure

- Create `apps/web/app/_features/organizations/active-organization-branding.queries.ts` — cache-partitioned, parsed published-branding query for the authenticated application root.
- Create `apps/web/app/_features/organizations/active-organization-branding.queries.spec.tsx` — verifies tenant-key partitioning, disabled behavior, and gateway invocation.
- Create `apps/web/app/_providers/organization-theme.ts` — pure document-property policy and reset function.
- Create `apps/web/app/_providers/organization-theme.spec.ts` — verifies published-only properties and every reset path.
- Create `apps/web/app/_providers/organization-theme-provider.tsx` — SessionContext-to-query-to-document lifecycle boundary.
- Create `apps/web/app/_providers/organization-theme-provider.spec.tsx` — verifies loading/error/no-session fallbacks and an organisation switch’s new query key.
- Modify `apps/web/app/_providers/providers.tsx` — compose the theme provider inside `SessionProvider`.
- Modify `apps/web/app/_providers/providers.spec.tsx` — assert the new provider’s composition without changing MSW readiness behavior.
- Modify `apps/web/app/globals.css` — alias published organisation properties into the existing semantic accent token surface.
- Modify `packages/ui/src/components/button/button.variants.ts`, `packages/ui/src/components/card/card.variants.ts`, and `packages/ui/src/components/date-picker/calendar.tsx` — use `text-on-accent` for primary fills.
- Modify `apps/web/app/_components/sidebar/sidebar.tsx` and `apps/web/app/(auth)/_components/auth-chrome.tsx` — replace static white foregrounds on active-primary brand marks with `text-on-accent`.
- Modify `packages/ui/src/components/button/button.spec.tsx`, `packages/ui/src/components/card/card.spec.tsx`, and `apps/web/app/_components/sidebar/sidebar.spec.tsx` — pin the semantic foreground class.

## Task 1: Partition the root branding query by the verified active organisation

**Files:**
- Create: `apps/web/app/_features/organizations/active-organization-branding.queries.ts`
- Test: `apps/web/app/_features/organizations/active-organization-branding.queries.spec.tsx`

**Interfaces:**
- Consumes: `organizationsApi.branding(signal?: AbortSignal): Promise<OrganizationBrandingResponse>` and `organizationKeys.branding`.
- Produces: `activeOrganizationBrandingQueryOptions(organizationId: string | null, enabled: boolean)` and `useActiveOrganizationBrandingQuery(organizationId: string | null, enabled: boolean)`.

- [ ] **Step 1: Write the failing cache-partition and fetch tests**

```tsx
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { organizationsApi } from "./organizations.api";
import {
  activeOrganizationBrandingQueryOptions,
  useActiveOrganizationBrandingQuery,
} from "./active-organization-branding.queries";

vi.mock("./organizations.api", () => ({ organizationsApi: { branding: vi.fn() } }));

const organizationId = "11111111-1111-4111-8111-111111111111";

it("partitions branding cache by verified active organization without putting it in the request", () => {
  expect(activeOrganizationBrandingQueryOptions(organizationId, true)).toMatchObject({
    queryKey: ["organizations", "current", "branding", organizationId],
    enabled: true,
    retry: false,
    staleTime: 30_000,
  });
  expect(activeOrganizationBrandingQueryOptions(null, true)).toMatchObject({
    queryKey: ["organizations", "current", "branding", "none"],
    enabled: false,
  });
});

it("calls the existing current-branding gateway only when an active organization exists", async () => {
  vi.mocked(organizationsApi.branding).mockResolvedValue({ branding: {} } as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  renderHook(() => useActiveOrganizationBrandingQuery(organizationId, true), { wrapper: Wrapper });
  await waitFor(() => expect(organizationsApi.branding).toHaveBeenCalledOnce());
  renderHook(() => useActiveOrganizationBrandingQuery(null, true), { wrapper: Wrapper });
  expect(organizationsApi.branding).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `pnpm --filter web run test -- active-organization-branding.queries.spec.tsx`

Expected: FAIL because the module and its exported query helpers do not exist.

- [ ] **Step 3: Implement the minimal tenant-partitioned query helper**

```ts
import { queryOptions, useQuery } from "@tanstack/react-query";

import { ORGANIZATIONS_STALE_TIME_MS } from "./organizations.queries";
import { organizationsApi } from "./organizations.api";
import { organizationKeys } from "./organizations.keys";

export function activeOrganizationBrandingQueryOptions(
  organizationId: string | null,
  enabled: boolean,
) {
  return queryOptions({
    queryKey: [...organizationKeys.branding, organizationId ?? "none"] as const,
    enabled: enabled && organizationId !== null,
    retry: false,
    staleTime: ORGANIZATIONS_STALE_TIME_MS,
    queryFn: ({ signal }) => organizationsApi.branding(signal),
  });
}

export function useActiveOrganizationBrandingQuery(
  organizationId: string | null,
  enabled: boolean,
) {
  return useQuery(activeOrganizationBrandingQueryOptions(organizationId, enabled));
}
```

Do not alter `organizationsApi.branding`, its route, or the existing administration query key. The new key exists only to prevent root-theme cache reuse after a verified active-organisation change.

- [ ] **Step 4: Run the focused query test and typecheck**

Run: `pnpm --filter web run test -- active-organization-branding.queries.spec.tsx && pnpm --filter web run check-types`

Expected: PASS; the network spy sees no organisation ID in a request and the disabled null-ID hook makes no request.

- [ ] **Step 5: Review the task diff; leave it uncommitted**

Run: `git diff -- apps/web/app/_features/organizations/active-organization-branding.queries.ts apps/web/app/_features/organizations/active-organization-branding.queries.spec.tsx`

Expected: only the new root-query helper and its tests are present. Do not commit without explicit user authorisation.

## Task 2: Add the published-only document theme policy and provider lifecycle

**Files:**
- Create: `apps/web/app/_providers/organization-theme.ts`
- Create: `apps/web/app/_providers/organization-theme.spec.ts`
- Create: `apps/web/app/_providers/organization-theme-provider.tsx`
- Create: `apps/web/app/_providers/organization-theme-provider.spec.tsx`

**Interfaces:**
- Consumes: `ResolvedOrganizationBranding`, `useSession()`, and `useActiveOrganizationBrandingQuery()` from Task 1.
- Produces: `applyOrganizationTheme(root: HTMLElement, branding: ResolvedOrganizationBranding | null): void` and `OrganizationThemeProvider({ children }: { children: ReactNode }): ReactNode`.

- [ ] **Step 1: Write the failing pure policy tests**

```ts
// @vitest-environment jsdom
import type { ResolvedOrganizationBranding } from "@repo/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  ORGANIZATION_THEME_PROPERTIES,
  applyOrganizationTheme,
} from "./organization-theme";

const published = {
  source: "published", displayName: "Northwind", footerText: null, contactText: null,
  palette: { primary: "#123456", primaryText: "#FFFFFF", secondary: "#ABCDEF", secondaryText: "#000000" },
  logo: null, version: 1, publishedAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z",
} as const satisfies ResolvedOrganizationBranding;

afterEach(() => applyOrganizationTheme(document.documentElement, null));

it("applies only the resolved published palette", () => {
  applyOrganizationTheme(document.documentElement, published);
  expect(document.documentElement.dataset.organizationTheme).toBe("published");
  expect(document.documentElement.style.getPropertyValue("--organization-theme-primary")).toBe("#123456");
  expect(document.documentElement.style.getPropertyValue("--organization-theme-primary-text")).toBe("#FFFFFF");
  expect(document.documentElement.style.getPropertyValue("--organization-theme-secondary")).toBe("#ABCDEF");
  expect(ORGANIZATION_THEME_PROPERTIES).toHaveLength(4);
});

it.each([null, { ...published, source: "sentinel", version: 0, publishedAt: null }, { ...published, source: "draft_preview", publishedAt: null }])(
  "clears a prior tenant palette for %p", (branding) => {
    applyOrganizationTheme(document.documentElement, published);
    applyOrganizationTheme(document.documentElement, branding as ResolvedOrganizationBranding | null);
    expect(document.documentElement.hasAttribute("data-organization-theme")).toBe(false);
    for (const property of ORGANIZATION_THEME_PROPERTIES) {
      expect(document.documentElement.style.getPropertyValue(property)).toBe("");
    }
  },
);
```

- [ ] **Step 2: Run the policy test to verify it fails**

Run: `pnpm --filter web run test -- organization-theme.spec.ts`

Expected: FAIL because `organization-theme.ts` is absent.

- [ ] **Step 3: Implement the pure immutable policy**

```ts
import type { ResolvedOrganizationBranding } from "@repo/contracts";

export const ORGANIZATION_THEME_PROPERTIES = Object.freeze([
  "--organization-theme-primary",
  "--organization-theme-primary-text",
  "--organization-theme-secondary",
  "--organization-theme-secondary-text",
] as const);

function clearOrganizationTheme(root: HTMLElement): void {
  root.removeAttribute("data-organization-theme");
  for (const property of ORGANIZATION_THEME_PROPERTIES) root.style.removeProperty(property);
}

export function applyOrganizationTheme(
  root: HTMLElement,
  branding: ResolvedOrganizationBranding | null,
): void {
  clearOrganizationTheme(root);
  if (branding?.source !== "published") return;
  root.dataset.organizationTheme = "published";
  root.style.setProperty("--organization-theme-primary", branding.palette.primary);
  root.style.setProperty("--organization-theme-primary-text", branding.palette.primaryText);
  root.style.setProperty("--organization-theme-secondary", branding.palette.secondary);
  root.style.setProperty("--organization-theme-secondary-text", branding.palette.secondaryText);
}
```

- [ ] **Step 4: Write the failing provider lifecycle test**

```tsx
// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const useSession = vi.fn();
const useActiveOrganizationBrandingQuery = vi.fn();
vi.mock("./session-provider", () => ({ useSession }));
vi.mock("../_features/organizations/active-organization-branding.queries", () => ({ useActiveOrganizationBrandingQuery }));

import { OrganizationThemeProvider } from "./organization-theme-provider";

it("uses a new active-organization cache key and clears the root while loading or on error", async () => {
  useSession.mockReturnValue({ session: { organization: { id: "org-a" } }, isLoading: false, isError: false });
  useActiveOrganizationBrandingQuery.mockReturnValue({ data: { branding: { source: "published", palette: { primary: "#123456", primaryText: "#FFFFFF", secondary: "#ABCDEF", secondaryText: "#000000" } } }, isError: false });
  const view = render(<OrganizationThemeProvider>content</OrganizationThemeProvider>);
  await waitFor(() => expect(document.documentElement.style.getPropertyValue("--organization-theme-primary")).toBe("#123456"));
  expect(useActiveOrganizationBrandingQuery).toHaveBeenCalledWith("org-a", true);
  useActiveOrganizationBrandingQuery.mockReturnValue({ data: undefined, isError: true });
  view.rerender(<OrganizationThemeProvider>content</OrganizationThemeProvider>);
  expect(document.documentElement.style.getPropertyValue("--organization-theme-primary")).toBe("");
  view.unmount();
  expect(document.documentElement.hasAttribute("data-organization-theme")).toBe(false);
});
```

- [ ] **Step 5: Run the provider test to verify it fails**

Run: `pnpm --filter web run test -- organization-theme-provider.spec.tsx`

Expected: FAIL because the provider module is absent.

- [ ] **Step 6: Implement the provider lifecycle**

```tsx
"use client";

import { useEffect, type ReactNode } from "react";
import { useActiveOrganizationBrandingQuery } from "../_features/organizations/active-organization-branding.queries";
import { useSession } from "./session-provider";
import { applyOrganizationTheme } from "./organization-theme";

export function OrganizationThemeProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const organizationId = session.session?.organization?.id ?? null;
  const enabled = organizationId !== null && !session.isLoading && !session.isError;
  const brandingQuery = useActiveOrganizationBrandingQuery(organizationId, enabled);
  const branding = enabled && !brandingQuery.isError ? (brandingQuery.data?.branding ?? null) : null;

  useEffect(() => {
    applyOrganizationTheme(document.documentElement, branding);
    return () => applyOrganizationTheme(document.documentElement, null);
  }, [branding]);

  return <>{children}</>;
}
```

In the completed test fixture, use a full `ResolvedOrganizationBranding` object (including display name, logo, version, and timestamps) so TypeScript proves the provider only accepts the shared trusted shape. Add separate assertions for `session: null`, `isLoading: true`, `isError: true`, and rerendering from `org-a` to `org-b`: each must call the query with the matching ID and clear the old root values until `org-b` returns published branding.

- [ ] **Step 7: Run the focused policy/provider tests and typecheck**

Run: `pnpm --filter web run test -- organization-theme.spec.ts organization-theme-provider.spec.tsx && pnpm --filter web run check-types`

Expected: PASS; only a trusted published snapshot can set properties, all other states and unmount clear them, and a changed active organisation gets a distinct query key.

- [ ] **Step 8: Review the task diff; leave it uncommitted**

Run: `git diff -- apps/web/app/_providers/organization-theme.ts apps/web/app/_providers/organization-theme.spec.ts apps/web/app/_providers/organization-theme-provider.tsx apps/web/app/_providers/organization-theme-provider.spec.tsx`

Expected: a focused DOM lifecycle and pure policy only; no local storage, direct Supabase use, or authentication changes.

## Task 3: Compose the theme lifecycle inside the existing provider tree

**Files:**
- Modify: `apps/web/app/_providers/providers.tsx:7,77-85`
- Modify: `apps/web/app/_providers/providers.spec.tsx:10-18,70-86`

**Interfaces:**
- Consumes: `OrganizationThemeProvider` from Task 2 and existing `SessionProvider`.
- Produces: all children under `Providers` have QueryClient → mocks readiness → session → organisation theme ordering.

- [ ] **Step 1: Write the failing provider-composition assertion**

```tsx
vi.mock("./organization-theme-provider", () => ({
  OrganizationThemeProvider: ({ children }: { children: ReactNode }) => (
    <section data-testid="organization-theme-provider">{children}</section>
  ),
}));

it("places tenant theme resolution inside the session boundary", async () => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "false");
  const { Providers } = await loadProviders();
  render(<Providers>content</Providers>);
  expect(screen.getByTestId("session-provider")).toContainElement(
    screen.getByTestId("organization-theme-provider"),
  );
});
```

- [ ] **Step 2: Run the provider test to verify it fails**

Run: `pnpm --filter web run test -- providers.spec.tsx`

Expected: FAIL because `Providers` has no `OrganizationThemeProvider` composition.

- [ ] **Step 3: Compose the provider without changing the mocks gate**

```tsx
import { OrganizationThemeProvider } from "./organization-theme-provider";

// Preserve QueryClientProvider and MocksReadyContext unchanged.
<SessionProvider>
  <OrganizationThemeProvider>{children}</OrganizationThemeProvider>
</SessionProvider>
```

Do not move `SessionProvider` outside the mocks readiness context: its existing contract prevents live session requests while default mocks are active.

- [ ] **Step 4: Run focused provider tests**

Run: `pnpm --filter web run test -- providers.spec.tsx session-provider.spec.tsx organization-theme-provider.spec.tsx`

Expected: PASS; all previous readiness/session assertions remain true and the theme boundary is strictly inside session context.

- [ ] **Step 5: Review the task diff; leave it uncommitted**

Run: `git diff -- apps/web/app/_providers/providers.tsx apps/web/app/_providers/providers.spec.tsx`

Expected: one additional nested provider and a composition test, with no altered query-client or service-worker behavior.

## Task 4: Route semantic tokens and primary foregrounds through the organisation palette

**Files:**
- Modify: `apps/web/app/globals.css:16-27`
- Modify: `packages/ui/src/components/button/button.variants.ts:77-84,180-184`
- Modify: `packages/ui/src/components/card/card.variants.ts:29-36`
- Modify: `packages/ui/src/components/date-picker/calendar.tsx:108-116`
- Modify: `apps/web/app/_components/sidebar/sidebar.tsx:304-319`
- Modify: `apps/web/app/(auth)/_components/auth-chrome.tsx:20-28`
- Modify: `packages/ui/src/components/button/button.spec.tsx`
- Modify: `packages/ui/src/components/card/card.spec.tsx`
- Modify: `apps/web/app/_components/sidebar/sidebar.spec.tsx`

**Interfaces:**
- Consumes: document properties produced by Task 2 and existing design-system `--color-active-*`, `--color-accent`, and `--color-on-accent` utilities.
- Produces: active actions, selected navigation, focus rings, primary cards, and overlay/portal descendants inherit the published organization accent and its validated foreground.

- [ ] **Step 1: Write the failing semantic-foreground tests**

```tsx
it("uses the semantic on-accent foreground for a primary filled button", () => {
  render(<Button variant="fill" tone="primary">Save</Button>);
  expect(screen.getByRole("button", { name: "Save" })).toHaveClass(
    "bg-active-500", "text-on-accent",
  );
});

it("uses the semantic on-accent foreground for a primary card", () => {
  render(<Card variant="primary" data-testid="card">Content</Card>);
  expect(screen.getByTestId("card")).toHaveClass("bg-active-500", "text-on-accent");
});
```

Add a sidebar assertion that the organisation avatar/logo fallback has `text-on-accent`, not `text-white`. This proves the most visible shell brand mark is covered by the same contrast token.

- [ ] **Step 2: Run the focused UI tests to verify they fail**

Run: `pnpm --filter ui run test -- button.spec.tsx card.spec.tsx && pnpm --filter web run test -- sidebar.spec.tsx`

Expected: FAIL because primary surfaces still contain `text-white`.

- [ ] **Step 3: Add the CSS aliases and replace static primary foreground classes**

Add this rule within `@layer base` in `apps/web/app/globals.css`, after the default `:root` compatibility aliases:

```css
:root[data-organization-theme="published"] {
  --color-active-900: color-mix(in srgb, var(--organization-theme-primary) 55%, #000000);
  --color-active-600: color-mix(in srgb, var(--organization-theme-primary) 88%, #000000);
  --color-active-500: var(--organization-theme-primary);
  --color-active-300: color-mix(in srgb, var(--organization-theme-primary) 58%, var(--color-canvas));
  --color-active-200: color-mix(in srgb, var(--organization-theme-primary) 32%, var(--color-canvas));
  --color-active-100: color-mix(in srgb, var(--organization-theme-primary) 12%, var(--color-canvas));
  --color-accent: var(--organization-theme-primary);
  --color-accent-subtle: color-mix(in srgb, var(--organization-theme-primary) 12%, var(--color-canvas));
  --color-on-accent: var(--organization-theme-primary-text);
  --color-organization-secondary: var(--organization-theme-secondary);
  --color-on-organization-secondary: var(--organization-theme-secondary-text);
}
```

Then make these exact class substitutions, retaining all other variants and hover/focus behavior:

```text
packages/ui/src/components/button/button.variants.ts
  "bg-active-500 text-white" -> "bg-active-500 text-on-accent" (both primary fill variants)
packages/ui/src/components/card/card.variants.ts
  "bg-active-500 text-white" -> "bg-active-500 text-on-accent"
packages/ui/src/components/date-picker/calendar.tsx
  "[&_button]:bg-active-500 [&_button]:text-white" -> "[&_button]:bg-active-500 [&_button]:text-on-accent"
apps/web/app/_components/sidebar/sidebar.tsx
  "bg-active-500 text-white" -> "bg-active-500 text-on-accent" (both brand-mark occurrences)
apps/web/app/(auth)/_components/auth-chrome.tsx
  "bg-active-500 text-headline-semibold text-white" -> "bg-active-500 text-headline-semibold text-on-accent"
```

Do not override `--color-white` globally: it is used for non-brand surfaces. Do not make auth pages query branding; their inherited values remain sentinel without an authenticated session.

- [ ] **Step 4: Run focused package/web tests and CSS-aware type/lint checks**

Run: `pnpm --filter ui run test -- button.spec.tsx card.spec.tsx && pnpm --filter web run test -- sidebar.spec.tsx organization-theme.spec.ts organization-theme-provider.spec.tsx && pnpm --filter web run lint && pnpm --filter web run check-types`

Expected: PASS; primary foregrounds use the contract-derived on-accent token and all theme lifecycle tests remain green.

- [ ] **Step 5: Verify the real authenticated flow without mutating data**

Run: `curl -fsS http://127.0.0.1:3333/api/v1/health && pnpm --filter web run test -- organization-theme-provider.spec.tsx`

Then, in the already-running local browser stack, sign in with the existing seeded owner and inspect `document.documentElement` after the current published branding response: `data-organization-theme` must be `published`, `--color-active-500` must resolve from `--organization-theme-primary`, and signing out must remove `data-organization-theme`. Do not publish, edit branding, or write Supabase data as part of this verification.

- [ ] **Step 6: Run full repository gates proportionate to the cross-package styling change**

Run: `pnpm test:architecture && pnpm --filter web run test && pnpm --filter ui run test && pnpm lint && pnpm check-types`

Expected: PASS. If a pre-existing dirty-worktree failure occurs, record the exact command and failure separately; do not alter unrelated M1-v2 code.

- [ ] **Step 7: Final diff and security review; leave it uncommitted**

Run: `git diff --check && git diff -- apps/web/app packages/ui/src/components/button packages/ui/src/components/card packages/ui/src/components/date-picker`

Expected: no whitespace errors, no secrets, no persisted tenant theme, no direct client database access, and no mutation beyond approved source/test/document files.

## Plan Self-Review

**Spec coverage:** Task 1 prevents cross-tenant cache reuse; Task 2 enforces published-only root lifecycle/reset behavior; Task 3 preserves the existing mocks/session boundary; Task 4 maps inherited semantic tokens, makes primary foregrounds contract-accessible, and verifies the real session fallback. No API, database, contract, or light/dark-mode work is omitted because the approved design explicitly preserves them.

**Placeholder scan:** No TODO/TBD/later steps are present. Each implementation action has exact files, symbols, test command, and expected outcome.

**Type consistency:** Task 1 returns the existing parsed `OrganizationBrandingResponse`; Task 2 consumes its `branding: ResolvedOrganizationBranding` member and exports the exact `applyOrganizationTheme`/provider names used by Tasks 3–4. The CSS names written by Task 2 exactly match the aliases in Task 4.
