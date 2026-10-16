# Published organization dashboard theme

## Scope and preserved contracts

**User outcome.** The signed-in CRA dashboard uses the active organization’s
published branding. Initially, the Branding screen presents the existing
design-system palette. Saving a draft never changes the dashboard; publishing
changes the active organization’s dashboard immediately.

**In scope.** Published primary and secondary colors, contrast-safe foreground
colors, published brand display name, and published logo in the dashboard
shell. The effect follows a server-verified active-organization switch.

**Out of scope.** The authentication screens, public pages, docs, raw status
semantics (danger/success/warning), a new branding API, direct browser
Supabase access, and browser-persisted branding.

The current `/api/v1/organizations/current/branding` API, Zod response schema,
cookies, active-organization selection, RBAC, theme/dark-mode behavior, and
the private logo-render endpoint remain compatible.

## Concrete problem

`OrganizationBrandingSection` currently paints a local preview with four
`--organization-brand-*` variables, but no dashboard-shell consumer exists.
The sidebar has a fixed `CRA Sentinel` label and `bg-active-500` mark. The resolved
fallback is also independent of the design-system accent: the contract and
the live SQL resolver return `#0167FF` and `#00A39B`, while the design system’s
base active token is `#595FE5`.

Therefore a valid saved or published branding record does not yet affect the
organization’s application shell, and an initial Branding form does not show
the product’s normal default accent palette.

## Why not simpler?

Styling only `OrganizationBrandingSection` cannot affect navigation, buttons,
focus rings, links, or other dashboard pages. Overwriting global design-system
variables would accidentally recolor unauthenticated/public surfaces and can
retain the previous tenant’s palette after an organization switch. A
dashboard-scoped lifecycle is needed, but no global application state or new
backend endpoint is required.

## Selected design

### Published-brand query and lifecycle

A client-side `OrganizationThemeProvider` wraps the existing dashboard shell,
the narrowest common mount point for all authenticated dashboard routes. It
derives the active organization ID from the server-verified session response
and uses the existing typed organization branding gateway. The organization ID
partitions only the React Query cache key and is never sent as an authority
input. The API continues to determine the active tenant from authenticated
cookies.

While loading, on an error, with no session, after logout, after unmount, or
when the resolved source is `sentinel` or `draft_preview`, the provider removes
all organization CSS properties from the dashboard shell. Thus the
design-system default remains visible and no previous organization’s color
leaks into the next one.

Only a `source: "published"` response writes the four trusted values supplied
by the shared Zod contract:

| Brand value                   | Dashboard role                                                         |
| ----------------------------- | ---------------------------------------------------------------------- |
| `primary` / `primaryText`     | primary action fill, links, selected navigation, focus ring, logo mark |
| `secondary` / `secondaryText` | complementary branded surfaces and decorative accent areas             |

Danger, success, warning, neutral surfaces, and content text retain their
semantic design-system roles. This prevents a brand color from falsely
signalling a security/status condition.

### Design-system token mapping

The dashboard wrapper uses custom properties that alias the current semantic
accent tokens to the organization properties when a published theme is active.
Existing components therefore keep using semantic Tailwind classes rather than
receiving organization-specific prop drilling. Primary-filled components use
the existing contract-derived `primaryText` foreground instead of fixed white,
preserving the palette’s WCAG validation. The default properties continue to
resolve to the current design-system values. Structural readability tokens
(`canvas`, `surface`, `border`, and `fg`) and status tokens do not change.

The branding fallback constants are aligned additively in two existing sources
of truth: `CRA_SENTINEL_BRANDING` in the shared contracts and the SQL
`m1_v2_sentinel_branding_json()` resolver. They adopt the current design
system defaults: active-500 (`#595FE5`) as the primary and active-300
(`#ADB0ED`) as the secondary; their black-or-white foregrounds are confirmed
by the existing contrast policy. Because that SQL function is already deployed
locally, the latter must be updated through a new additive migration; existing
published version rows are not rewritten.

### Dashboard identity

The sidebar uses the same resolved published snapshot. A published display
name replaces the fixed `CRA Sentinel` label. A published logo is rendered only through
a published-logo-safe endpoint; the existing `logo/preview` endpoint is not
reused because it can select a draft asset. When a published brand has no
logo, its mark is the first Unicode character of its trimmed display name; it
is not always `C`. The published optional footer text is rendered beneath the
sidebar sign-out control. If no publication exists, or the request is
unavailable, the sidebar retains the neutral `CRA Sentinel`/`C` fallback and shows no
tenant footer. The underlying organization `name`, legal profile, slug,
memberships, and authorization state never change.

## Rejected designs

- **Global document theme:** violates tenant isolation and changes sign-in and
  public pages.
- **Draft-powered theme:** makes unreviewed owner edits visible to every
  member and contradicts publishing semantics.
- **Local storage/session storage theme:** can show stale or cross-tenant
  values and is not a server-authoritative source.
- **New branding endpoint or browser Supabase client:** duplicates the
  authenticated API boundary without a need.

## Data and tenant boundaries

Identity comes from `useSession()` and ultimately the API’s verified
`cra_org`/membership selection. The provider passes no organization identifier
to the branding request. The current-branding controller stays guarded by the
existing active-organization tenant scope. No new table, table query, storage
operation, or runtime authority is introduced.

The additive database migration changes only the safe, presentation-only
fallback JSON function. A small existing API extension exposes a
published-logo-safe binary rendering path (or the existing resolver is made
explicitly source-aware) without ever returning a draft asset. Both changes
are backward compatible: old API versions still accept the same response shape,
and published branding versions remain immutable.

## Failure behavior

- Invalid branding is rejected at the existing shared Zod/API/SQL boundaries.
- A fetch failure, missing session, logout, and organization switch clear the
  applied properties and fall back to the default theme.
- Drafts are deliberately never applied outside the editor, even if a cache
  contains a draft preview.
- A stale response cannot establish authority; it is confined to the
  cache-partitioned active-session query and is cleared when the active ID
  changes.
- The existing output schema continues to reject malformed provider data.

## Tests and observability

Tests begin with failing characterization coverage for:

1. default fallback colors in contracts and SQL resolver;
2. published-only CSS property application and full cleanup paths;
3. cache partitioning across organization switches, with no organization ID in
   the browser request;
4. sidebar fallback versus published name/logo/initial/footer behavior;
5. semantic primary foreground classes using `text-on-accent`;
6. browser flow: draft save has no shell effect; publish recolors the active
   dashboard and changes sidebar identity; switch restores the target
   organization’s theme.

Run focused web, contracts, API/migration SQL, and Playwright tests, followed
by the applicable root architecture, type, lint, test, and production build
gates. No theme value, token, identifier, or logo URL is written to logs.

## Rollback

Removing the dashboard provider and CSS aliases returns all surfaces to the
design-system defaults. The fallback resolver migration can be superseded by a
new `CREATE OR REPLACE FUNCTION` migration restoring its prior values. No
published tenant records, memberships, credentials, or session data require
rollback.

## Review checklist

- [x] The direct local-preview approach was considered and rejected.
- [x] The new provider has a real active-organization/query lifecycle trigger.
- [x] Theme state is derived from verified server session and API output.
- [x] No controller, page, or shared UI directly calls Supabase.
- [x] Existing shared Zod response contracts remain the only wire shape.
- [x] Security-critical tenant scope remains server-side.
- [x] Draft, error, logout, and switch cleanup paths are explicit.
- [x] Tests and rollback are defined.
