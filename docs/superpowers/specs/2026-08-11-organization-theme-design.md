# Organization-wide published branding theme

## Scope

Apply the active organisation's **published** branding palette to the entire
authenticated web application. The palette changes semantic accent surfaces:
primary actions, selected navigation, focus/active indicators, accents, and
their contrasting foregrounds. Public/authentication pages and an
unauthenticated, loading, error, or switching state retain the existing
sentinel theme.

This work does not change the branding editor, persistence model, API
contracts, authentication, authorisation, colour-mode preference, or any
other tenant's displayed theme.

## Problem and evidence

`GET /api/v1/organizations/current/branding` already resolves a safe published
snapshot in the API, and `organizationBrandingResponseSchema` gives the web
application a parsed response. The Organization settings area consumes this
data, but nothing at the authenticated application root maps it into the
semantic CSS tokens used by the rest of the UI. As a result, publishing a
palette stores and returns organisation-specific data without visibly theming
the dashboard shell or other product surfaces.

Relevant evidence:

- `packages/contracts/src/organizations/schemas/organization-branding.schema.ts`
  defines the resolved published snapshot, including `primaryText` and
  `secondaryText` chosen for AA contrast.
- `apps/web/app/_features/organizations/organizations.api.ts` parses the
  response through that shared contract.
- `apps/web/app/_features/organizations/organizations.queries.ts` exposes the
  existing branding query.
- `packages/design-system/src/styles.css` defines the semantic CSS variables
  (`--color-accent`, `--color-on-accent`, `--color-active-*`) consumed by the
  product UI.
- `apps/web/app/_providers/providers.tsx` is the existing authenticated
  client-provider boundary, and `apps/web/app/layout.tsx` preserves the
  independent light/dark `data-theme` preference.

## Selected design

Add a narrow `OrganizationThemeProvider` inside the existing web provider
tree. Once the current authenticated session is available, it will use the
existing parsed React Query branding query. An effect maps only a
`source: "published"` snapshot onto explicit organisation CSS custom
properties at the document root. Global semantic-token aliases then make the
palette inherit through the authenticated app, including portal content.

The mapping is a small immutable policy function. It maps:

- published `palette.primary` to action, selected-navigation, and active
  accent tokens;
- published `palette.primaryText` to text on those primary surfaces;
- published `palette.secondary` and `secondaryText` to secondary accents;
- primary combined with the current canvas token through `color-mix()` for a
  subtle accent surface, rather than inventing an unvalidated text colour.

All non-brand semantic tokens, structure, typography, and the user's
light/dark preference remain owned by the existing design system. This is an
organisation accent theme, not a replacement design system.

The provider clears all organisation-specific properties and its marker before
each non-published result, when the query is disabled, and on unmount. The
fallback is therefore the existing sentinel palette; a stale previous tenant's
palette is never retained while a user signs out, changes organisation, loads,
or encounters a query error. Branding is deliberately not persisted in
`localStorage` or any other browser store.

## Rejected alternatives

1. **Patch individual screens/components.** Rejected because raw local edits
   cannot reliably cover navigation, dialogs/portals, future pages, or the
   product shell, and would duplicate a tenant-sensitive policy across the UI.
2. **Send branding in the authentication/session payload.** Rejected because
   the established branding endpoint already resolves the active organisation
   and supplies a runtime-parsed contract. Coupling mutable branding to session
   issuance would expand an auth compatibility surface without an auth need.
3. **A general strategy/plugin theme framework.** Rejected because there is one
   deterministic mapping and no demonstrated need for interchangeable theme
   algorithms. A pure function plus a focused provider is smaller and clearer.

## Architecture and boundaries

```
authenticated SessionProvider
  -> existing organizationBrandingQueryOptions
  -> organizationsApi.getBranding (input/output Zod parsing)
  -> GET /api/v1/organizations/current/branding
  -> API resolves verified active organisation and published snapshot
  -> OrganizationThemeProvider DOM effect
  -> semantic CSS variables inherited across the web app
```

The web app continues to call its gateway/API layer only; it does not access
Supabase. The existing API route remains responsible for verified identity,
tenant isolation, permission rules, and published-snapshot selection. The
theme provider receives no caller-supplied organisation ID and never selects a
tenant from browser state.

No migration, generated type, seed, database query, service-role call, or API
contract change is required.

## Failure and compatibility behavior

- **No session or switching/loading branding:** clear organisation tokens and
  use the existing sentinel design-system theme.
- **Query/API/schema error:** clear organisation tokens, show no cross-tenant
  stale theme, and retain existing UI error behavior.
- **Draft preview:** ignored at the application root. Only a published
  snapshot may affect whole-app rendering.
- **No published branding:** use the sentinel theme.
- **Light/dark mode change:** `data-theme` remains managed by the current
  theme code; the organisation variables inherit on top of either mode.
- **Logout/unmount:** remove all root organisation variables and marker.
- **Cached result after organisation change:** React Query updates the provider
  and the effect replaces the old values atomically in one render effect.

## Pattern selection

The existing React Query subscription supplies the observer lifecycle; no new
event bus or global singleton is introduced. The new provider is a justified
presentation boundary because it owns a real DOM lifecycle and must apply a
cross-cutting, tenant-derived rendering concern. The colour mapping remains a
pure, immutable function rather than a class hierarchy or strategy framework.
This preserves the documented dependency direction: presentation consumes an
existing application/gateway query and does not invert dependency ownership.

## Test and verification plan

Write tests before implementation for:

1. the pure mapping: published values produce the expected explicit properties
   and only expected properties;
2. reset behavior: sentinel, loading, error, unmount, and a different
   organisation all remove/replace previous properties;
3. provider behavior: it uses only a published parsed response and does not
   apply draft/unknown sources;
4. a focused authenticated UI check that a published branding response changes
   root semantic variables while an absent/error response falls back.

Then run focused web tests, `pnpm --filter web run check-types`, relevant web
linting, and the repository architecture gates. When the local stack is
available, verify with the seeded owner that publishing/selecting an
organisation palette changes the dashboard shell and that sign-out restores
the sentinel appearance.

## Rollback

Removing the provider and the organization-variable aliases restores the
current sentinel-only appearance. Since no persisted shape or API contract is
changed, rollback requires no data action.

## Design review

- [x] Uses the existing parsed branding contract and query.
- [x] Keeps tenant selection and authorisation on the API side.
- [x] Applies published data only; drafts cannot globally theme the product.
- [x] Clears state on every fallback path to prevent cross-tenant leakage.
- [x] Preserves colour mode, auth/session behavior, and existing API routes.
- [x] Avoids an unneeded framework, persistent browser state, and database work.
