# M1 organization profile and resumable onboarding

## Scope and preserved contracts

- User outcome: an authenticated manufacturer can create a legally identifiable
  organization and resume its server-persisted onboarding across sessions and
  devices.
- In scope: organization legal profiles, atomic creation/owner membership,
  active-organization switching audit, persisted ordered onboarding evidence,
  and invitation resend/delivery reconciliation.
- Out of scope: Product and SBOM registries, tenant settings, retention,
  export, deletion, multi-entity support, and branding.
- Existing `/api/v1` routes, frozen auth-action signatures, session cookies and
  refresh path, authentication/MFA, invitation acceptance, RBAC merge order,
  and menu configuration remain unchanged. `organizations.name` remains the
  legal-name source consumed by existing session and invitation code.

## Concrete problem

The current `organizations` table contains only session-facing summary fields,
while organization membership and invitations already have independent,
tenant-scoped persistence (`apps/infrastructure/supabase/migrations/20260809090300_organizations_and_members.sql`
and `20260809091200_invitations.sql`). A browser draft would lose the legal
profile/onboarding state across devices and could claim Product or SBOM work
without an authoritative record. A create-then-membership sequence outside a
transaction can also leave an unusable organization on failure.

## Why not simpler?

The direct solution would add profile columns to `organizations` and retain a
wizard step in React state. It cannot atomically bind an owner, support
idempotent retries, retain ordered evidence across sessions, or accept future
Product/SBOM evidence without coupling onboarding to their tables.

## Selected patterns

- **Facade** — `OrganizationsService` is the compatibility-facing Nest entry
  point coordinating focused use cases. Controllers and pages otherwise would
  coordinate persistence, cookie writing, and error mapping themselves.
- **Adapter** — a Supabase adapter implements an inward-owned organization
  repository/evidence port because PostgREST RPC return shapes and provider
  failures differ from the application contract.
- **State** — database-owned immutable stage order represents the onboarding
  lifecycle. The trigger is ordered, concurrent transitions over more than
  three meaningful stages. Stage completion is reconciled only forward.
- **Command records** — immutable create, update, switch, and evidence
  commands carry actor identity and idempotency/concurrency inputs. They make
  retries and audit inputs explicit without a command bus.

Dependency direction is web presentation -> typed HTTP gateway -> API
controller/facade -> application use case/port -> Supabase adapter. Product,
SBOM, and invitation integrations call the onboarding-owned evidence port only
after their own authoritative commit. Remove the evidence port if all three
features converge on one owned transactional store; no factory, event bus,
global workflow state, or inheritance hierarchy is introduced.

## Rejected patterns

- A browser memento/local-storage draft is rejected because it is not durable
  or authoritative.
- A global event bus/outbox is rejected: Product and SBOM are not implemented
  yet, and security-critical stage/audit changes must be synchronous or in the
  same database transaction.
- A direct cross-feature Product/SBOM table query is rejected because those
  schemas do not exist and would reverse ownership/dependency direction.
- A new invitation model is rejected; resend augments the existing pending row
  and existing hash-only token/email flow.

## Data and tenant boundaries

- The global auth guard verifies the access token, active status/session epoch,
  and derives the selected membership from the signed `cra_org` cookie. The
  cookie remains a hint; it never grants a tenant scope.
- Service-role organization reads take `orgId` first and explicitly filter it.
  Creation/switch RPCs verify the authenticated `public.users.id` in their
  transaction before producing a result. Cross-tenant targets return a generic
  not-found outcome.
- One atomic creation RPC inserts `organizations`, the owner membership,
  profile, onboarding header/stages, creation idempotency record, and audit
  fact. The API sets `cra_org` only after it re-reads and verifies membership.
- A globally unique canonical legal-identity digest and per-actor idempotency
  digest prevent both parallel duplicate profiles and changed-payload key
  reuse. Updates use profile `expectedVersion`; evidence is deduplicated and
  only advances contiguous stages.
- The migration is additive. Existing organizations receive a compatible
  profile/onboarding backfill state; existing API code continues to use name
  and slug. Previous application versions can run while new tables exist;
  rollback disables new callers rather than deleting legal/audit data.

## API boundary contracts

- Contracts live under `@repo/contracts/organizations/{schemas,types}`. Create
  input requires an idempotency UUID, legal name, complete structured address,
  a separate ISO-3166 alpha-2 main-establishment country, contact name and
  email, and optional E.164 phone. Update requires `expectedVersion`.
- Controllers parse every body/parameter with `zodBody`/`zodParams` and declare
  strict `@ZodResponse` schemas. Successful adapter results are parsed before
  return; provider failures and malformed provider data become distinct generic
  server errors.
- Web gateways use the same outgoing input schemas and incoming response
  schemas. Unknown fields and unsupported countries are rejected, never
  defaulted from browser, user, IP, or deployment data.

## Frontend logic and rendering

- Functional dashboard onboarding components render loading, empty, retryable
  error, forbidden, and completed states. React state is only an editable form
  draft; progress is fetched from the organization API.
- `OrganizationsApi` is a focused class because it owns authenticated transport
  and request/response schema pairing. Immutable query helpers own React Query
  keys. Successful create/switch invalidates `sessionKeys.all`.
- The route is off-nav to preserve menu parity. It redirects a dashboard user
  with no selected organization to creation and presents a resume link for an
  incomplete organization. Forms retain their values after server validation
  failures and provide native sequential controls/announcements.

## Failure modes

| Failure | Handling |
| --- | --- |
| Invalid country/address/contact | Shared Zod validation fails closed with field errors; no RPC runs. |
| Identical or concurrent create retry | Same key/payload returns the prior organization; global identity conflict returns no identifier. |
| Changed payload with reused key | Stable idempotency conflict, no mutation. |
| Membership/profile insert failure | Atomic RPC rolls back all organization state and audit fact. |
| Permission/session loss | Guard and permission guard reject before the controller; active request cannot supply another tenant. |
| Stale profile tab | Expected-version conflict returns current-safe retry guidance; no lost update. |
| SMTP failure | Invitation remains distinguishable as persisted but undelivered; no onboarding invitation evidence is written. |
| Delivery/evidence retry | Token stays hash-only; evidence identity is deduplicated and reconciliation never regresses a completed stage. |
| Product/SBOM unavailable/deleted | Stage remains blocked until authoritative evidence; previously completed history is not erased. |
| Supabase/malformed provider response | Application maps it to a generic provider-unavailable/malformed-provider error without tokens or contact data. |

## Tests and observability

- Characterize frozen cookies/refresh path, auth route coverage, permission
  merge order, existing invitation acceptance, and menu parity first.
- Add contract, unit, API, SQL/RLS/concurrency, live-stack, web, and E2E tests
  for whitespace/Unicode/case duplicate identity, country/address/contact
  validation, atomic rollback, retries, tenant 404s, stale updates, active-org
  switch audit, out-of-order evidence, duplicate evidence, SMTP failure, and
  keyboard/validation states.
- Audit rows synchronously record organization creation/update, onboarding
  stage/completion, switch, and delivery evidence. Contact values are represented
  only by domain-separated keyed digests and changed field names; tokens, OTPs,
  recovery codes, and raw contact duplicates are never logged.

## Rollback

Deploy the additive migration before API/web code. If API/web is rolled back,
the new tables and audit rows remain inert and existing organization/session/
invitation behavior continues. Do not drop data as rollback. A later explicit
contract migration may remove unused objects only after all callers and
generated types are retired.

## Review checklist

- [x] The direct solution was considered first.
- [x] Selected patterns have a present-tense trigger and contract tests.
- [x] No request, user, tenant, or session state is global.
- [x] Controllers/pages contain no provider query or domain decision.
- [x] Domain/application layers do not import frameworks or concrete adapters.
- [x] Boundary input and external responses are schema-validated.
- [x] Wire schemas and `z.output` types live in feature folders.
- [x] Security-critical effects are synchronous or transactionally durable.
- [ ] Focused coverage and live-stack verification complete.
