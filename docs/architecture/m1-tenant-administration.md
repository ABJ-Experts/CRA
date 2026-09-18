# M1 tenant administration and data lifecycle

## Scope and preserved contracts

- User outcome: an owner can configure an organization, understand the
  retention floor, request and download a verified export, and safely
  deactivate or schedule deletion with durable progress.
- In scope: versioned settings/catalogs, retention policy/floor reconciliation,
  export jobs and verified manifests, lifecycle transitions, session
  revocation, destructive reauthentication, purge work, and minimal deletion
  proof.
- Out of scope: changing legal-profile/onboarding behavior, changing frozen
  authentication-action signatures, browser-supplied tenancy, provider-specific
  settings semantics, and a general workflow engine.
- Existing `/api/v1` route prefix, access/refresh cookie names and paths,
  signed active-organization selection behavior, membership/invitation routes,
  RBAC resolution order, onboarding contracts, and the API-owned HttpOnly
  session model remain unchanged. `can_edit_organization` remains owner-only.
  The new export/delete keys are granted to owners by default; their destructive
  API routes also require the verified `owner` base role, so a custom-role grant
  cannot elevate another base role into destructive authority.

## Concrete problem

An organization now has more than the legal profile and onboarding state
introduced by M1. Settings change over time, retention can be constrained by
several authoritative records, exports span database and storage work, and
deletion transitions through six durable states. A boolean `is_active`, a
browser progress indicator, or a request-local job cannot distinguish a paused
export from a terminal failure, prevent a purge from regressing, or prove a
legal hold was checked immediately before deletion.

The existing organization profile feature already uses versioned writes and
server-owned organization selection. This feature extends those established
boundaries rather than introducing direct Supabase access from pages or
controllers. The relevant variations are real: notification/AI/artifact
providers have different availability, and product/evidence/obligation/hold
sources each impose a retention floor through a different store.

## Why not simpler?

The direct implementation would add mutable settings and lifecycle columns to
`organizations`, let an API handler enqueue a storage export, and use `active`
plus `deleted_at` flags. It cannot encode legal transitions among `deactivated`,
`purge_scheduled`, `purge_blocked`, and `purging`; safely resume leased work;
atomically check retention/holds before deletion; or keep external provider
failure behavior out of controllers. It also invites a browser to infer
timezone, provider, or region values that must be selected from the server
catalog only.

## Selected patterns

- **State and persistent transition table** — the trigger is behavior that
  varies across six durable lifecycle states and concurrent, destructive
  transitions. `active`, `deactivated`, `purge_scheduled`, `purge_blocked`,
  `purging`, and `purged` are persisted records with a monotonic version;
  lifecycle use cases ask the transition policy for allowed events and execute
  its atomic RPC. The shared contract is the lifecycle status/version/safe-error
  schema. Remove the State policy only if deletion reduces to a single,
  synchronous, transactionally reversible action.
- **Ports and adapters** — the trigger is four independently changing external
  authorities: product retention, evidence classification, legal obligations/
  holds, and notification/AI/artifact providers. The application owns
  `RetentionFloorPort`, `ArtifactStorePort`, `NotificationPort`, and
  `ProviderCatalogPort`; Supabase and provider-specific adapters implement
  them. Each returns validated records or a safe unavailable/malformed outcome.
  Remove an individual port if its data becomes transactionally owned by the
  tenant-administration repository.
- **Facade with focused use cases** — `TenantAdministrationFacade` coordinates
  settings, retention, export, and lifecycle use cases so controllers remain
  request/response adapters. Its concrete trigger is several atomic commands
  sharing verified organization identity, audit, and error mapping. Remove it
  when this surface becomes a single route/use case.
- **Durable command/job records** — settings/retention commands use expected
  versions; export/purge commands carry idempotency keys, leases, checkpoint
  versions, and safe failure state. The trigger is retries across process
  restarts and side effects outside the database. No global command bus or
  in-memory queue is introduced.

Dependency direction is web rendering -> typed HTTP gateway -> Nest controller
-> facade/use case -> inward-owned port -> Supabase/provider adapter. The
lifecycle transition policy and schemas are pure/portable; they import neither
Nest nor Supabase.

## Rejected patterns

- A mutable boolean/flag collection is rejected because flags permit impossible
  combinations and do not centralize terminal or blocked behavior.
- A browser state machine/local storage is rejected because browser state cannot
  authorize a transition, survive another device, or prove cleanup/purge facts.
- A global event bus is rejected because revocations, holds, and lifecycle
  transitions must be synchronous or transactionally durable; an outbox may be
  added later only for non-authoritative notifications.
- Direct cross-feature table reads are rejected because they couple the feature
  to product/evidence schemas and bypass the owner of each authority.
- A class hierarchy for provider selection is rejected; small adapters behind
  inward ports retain explicit selection and deterministic test doubles.

## Data and tenant boundaries

- The global auth guard verifies the Supabase ES256/JWKS token and derives the
  signed active selection. The selection is a hint, not authority: repository
  operations reverify membership, active lifecycle state, user, session, and
  organization identity. The recovery exemption re-verifies ownership from the
  signed selection and is unavailable to ordinary inactive-tenant requests.
- Every service-role method takes `orgId` first: settings/catalog reads and
  writes, retention reconciliation/cleanup, export request/claim/checkpoint,
  lifecycle/reauth/purge transitions, tenant session revocation, and deletion
  proof reads all explicitly filter that organization. Cross-tenant targets use
  the same generic not-found result.
- Settings/retention writes, deactivation, reauth-grant consumption, purge
  scheduling, state transition, revocation, and audit fact are one RPC
  transaction. Export/purge workers claim persisted work under a lease; each
  checkpoint and final eligibility check is an atomic RPC. Holds/floors are
  checked in the final cleanup/purge transaction, never only when work is
  queued.
- An idempotency key is bound to actor, organization, command type, and payload
  digest. Reuse with a changed payload conflicts safely. Expected versions
  prevent lost settings/retention writes; destructive lifecycle commands carry
  an expected lifecycle version; leases and checkpoint versions prevent two
  workers from completing the same work.
- Migrations are additive and deploy before API/web code. New tenant tables get
  RLS enabled (not forced), grants, indexes, and generated types through the
  approved command. Existing organizations backfill as `active`, retaining
  legal-profile/onboarding fields. Rollback disables new callers; it never
  deletes audit, job, or proof data.

## API boundary contracts

- Contracts live in `@repo/contracts/organizations/{schemas,types}`. Settings
  have explicit `unconfigured` and `configured` variants with a version;
  configured values include IANA-shaped timezone, unique non-empty working
  days, unique local-date holidays, unique notification ids, nullable staged
  MFA date, bounded session age, AI provider id, and residency id. No value is
  defaulted from browser locale, profile, IP, or deployment region.
- Every settings read includes the authoritative PII-free MFA rollout summary:
  enrolled and unenrolled member counts plus `safeToEnforce`. The API derives
  this from verified factors, rather than browser state, and only allows a
  scheduled MFA date when the authoritative summary permits it.
- The `get_organization_settings` database RPC returns stored settings only;
  it never queries factors or fabricates readiness. The API composes and parses
  the strict `{ settings, mfaRolloutReadiness }` response from that RPC and a
  verified-factor query, and rejects a future MFA enforcement date unless the
  authoritative summary is safe to enforce.
- The server catalog returns strict, unique timezone/channel/provider/residency
  identifiers and session-age bounds. Shared Zod validates stable grammar and
  uniqueness only; capability/allowlist decisions remain server-side.
- Retention updates identify one lower-snake-case evidence class and return a
  versioned requested/effective policy. The read response returns the complete
  unique policy set, one policy for every evidence class, with its effective
  floor and every product, evidence-class, obligation, or legal-hold reason.
  Shared Zod enforces the strict identifier grammar; the API validates it
  against the server-owned evidence-class catalog.
- Exports require a UUID idempotency key and return status, bounded progress,
  safe errors, and a verified SHA-256 manifest. An owner-authorized latest
  export read returns either that organization-scoped durable job or an explicit
  empty value, so a browser restart never needs to persist an export identifier.
  Attachment responses limit link
  lifetime to 900 seconds. Lifecycle responses expose state/version/time,
  generic safe error, and every strict product/evidence-class/obligation/legal
  hold blocker when (and only when) the state is `purge_blocked`. A blocked
  state may instead contain a non-secret `unavailable` or `worker_failure`
  blocker with its constrained generic code only; it exposes no provider,
  storage, job payload, or raw failure detail.
  Reauthentication grants expose identifiers and expiry, never password/MFA
  material.
- A destructive reauthentication request carries the fresh password and an
  optional bounded six-digit MFA code. The API requires that one-time challenge
  only when the owner has a verified factor; both values are consumed by the
  existing auth flow and are never logged, audited, persisted, or queued.
- Purge scheduling accepts only the structural confirmation `DELETE <slug>`,
  where `<slug>` uses the canonical lowercase hyphenated slug grammar. The API
  and final database RPC compare it exactly to the verified organization slug;
  the browser-provided phrase never selects an organization and is not logged.
- Controllers use `zodBody`/`zodParams`, parse adapter results, and declare
  `@ZodResponse` (or `@NonJsonResponse` for a non-JSON stream). Browser
  gateways pass both `inputSchema` and response `schema`. Unknown keys fail;
  no defaults are inferred; malformed provider output becomes a safe error.
  Trusted TypeScript types are `z.output<typeof schema>` types in the feature
  type barrel.

## Frontend logic and rendering

- Functional pages render settings, retention, export, and deletion states:
  unconfigured, loading, retryable error, forbidden, blocked, queued/running,
  verified download, deactivated, recoverable, and terminal. Saved timezone is
  the only timezone used for display.
- Focused plain `.ts` API gateway classes own authenticated transport and the
  input/output schema pair. A lifecycle polling gateway owns cancellation and
  refetch lifecycle only when a real long-running export/purge page needs it;
  its constructor receives transport and clock/test seams from the composition
  root.
- Pure query-key, transition-label, confirmation, and display policies are
  immutable functions. React components never select provider/residency,
  decide authorization, or query Supabase. Browser state is form/presentation
  state only and never a tenant scope or authorization source.

## Failure modes

| Failure                                                   | Handling                                                                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Invalid settings/catalog identifier or duplicate date/day | Shared schema fails closed before a command; values remain on the form.                                           |
| Settings/retention stale version                          | RPC returns a stable conflict; no partial update; client reloads safe current state.                              |
| Catalog/provider unavailable or malformed                 | Adapter returns safe unavailable/malformed outcome; no inferred fallback.                                         |
| Product/evidence/obligation/hold lookup fails             | Cleanup and purge fail closed; job records safe error and retries under policy.                                   |
| Duplicate export/purge command                            | Same idempotency key/payload returns durable prior command; changed payload conflicts.                            |
| Export storage/hash/ZIP failure                           | Checkpoint fails safely, manifest is not downloadable, worker retries or dead-letters.                            |
| Manifest verification mismatch                            | Never mint attachment link; record `verification_failed` safe error.                                              |
| Attachment link expiry/authorization loss                 | Download endpoint rejects and requires a new authorized short-lived response.                                     |
| Lifecycle invalid/stale transition                        | Transition policy/RPC rejects with generic safe invalid-state result; state never regresses.                      |
| Deactivation/purge transaction failure                    | Atomic RPC rolls back state, revocations, and audit fact together.                                                |
| Session revoked or organization inactive                  | Guard fails closed before normal tenant work; recovery verifies signed selection and owner repository membership. |
| Reauthentication/MFA failure or lockout                   | Existing password/MFA lockout flow fails closed; no grant is issued and secrets are absent from logs/audits/jobs. |
| Notification delivery failure                             | Durable business transition remains visible; non-authoritative notification retries separately.                   |

## Tests and observability

- Characterize first: frozen cookie paths/auth-action signatures, active-org
  selection, RBAC merge order, permission coverage, and existing onboarding/
  invitation behavior.
- Contract tests cover strict unknown fields, explicit unconfigured settings,
  duplicate calendar values, identifier grammar, catalog uniqueness/bounds,
  evidence-class policy-set uniqueness and versioned retention floor
  calculations/reasons, idempotent export requests,
  progress, SHA-256 manifest verification, short attachment lifetime,
  authoritative MFA-rollout readiness, all six lifecycle states with blocking
  reason invariants, structural `DELETE <slug>` confirmations, exact verified
  slug comparison, and generic errors.
- Unit tests cover every lifecycle state/event pair, retention-floor merge,
  idempotency digest behavior, worker checkpoint transitions, and provider-port
  safe failures. API tests cover authorization (`view`, `edit`, owner plus
  export/delete), response parsing, generic cross-tenant 404s, and recovery.
- Live Supabase tests cover RLS/grants/search paths, atomic audit/revocation,
  idempotency/concurrency, legal-hold/floor recheck immediately before cleanup,
  paused export/purge resume, artifact/hash failures, and deletion-proof
  survival. Browser/E2E tests cover owner/admin/viewer behavior, field
  retention, MFA/reauth, recovery, blocked deletion, and persisted progress.
- Structured logs/metrics record operation type, state transition, safe error
  code, lease/checkpoint outcome, retry/dead-letter count, and provider class.
  They exclude passwords, MFA codes, tokens, raw confirmations, provider
  credentials, presigned URLs, and unnecessary personal data. Focused coverage
  for changed modules stays at or above 80%.

## Rollback

Use expand/deploy/contract sequencing: deploy additive migration and generated
types, then API/worker, then web. A rollback returns traffic to the prior
application while new tables, lifecycle/audit/job facts, and private artifacts
remain inert and compatible. Disable affected provider configuration or worker
claims if needed; do not delete tenant data, manifests, audit records, or
minimal deletion proofs during rollback. A later, separately reviewed contract
migration can retire unused structures only after all callers are gone.

## Review checklist

- [x] The direct solution was considered first.
- [x] Every selected pattern has a present-tense trigger and contract test.
- [x] No request, user, tenant, or session state is global.
- [x] Controllers/pages contain no provider query or domain decision.
- [x] Domain/application layers do not import frameworks or concrete adapters.
- [x] Boundary input and external responses are schema-validated.
- [x] Wire schemas and parsed `z.output` types live in separate feature folders.
- [x] Every JSON route and browser request parses both applicable directions.
- [x] JSX is functional; any logic class has a real dependency or lifecycle trigger.
- [x] Security-critical effects are synchronous or transactionally durable.
- [ ] Focused coverage and live-stack verification complete in Tasks 2-5.
- [x] Compatibility and live-stack gates are listed.
