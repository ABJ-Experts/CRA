# M15-03 feature design: scoped operator administration and system health

## Scope and preserved contracts

- User outcome: customers can inspect authorized local health; operators can inspect explicitly scoped fleet metadata through a separate private realm.
- In scope: health contracts/probes/source aggregates, read-only operator registry/listener/collector, operational UI, tests and rollout evidence.
- Out of scope: backup creation/restore evidence before M15-05, content browsing/impersonation, registry/trust UI CRUD, diagnostics bundle, upgrades, deletion, production access and recovery of the previously missing bytes.
- Preserve public health shapes, `/api/v1`, narrow refresh cookie, ES256/JWKS, zero epoch skew, frozen auth actions, permission resolution, source-domain approval/retention/legal holds, manual evidence exports, menu/mock namespaces and all existing data.

## Concrete problem

`HealthController.readiness` checks database, audit and M6 readiness without explicit cancellation/time budgets. Source-owned M6/feed/licence/usage projections exist, but no customer health composition or platform-operator identity does. Ordinary tenant owner/admin privileges are not an operator trust boundary. Offline fleet metadata needs retained source observations when private instances cannot be reached.

## Why not simpler?

Extending public readiness would disclose metadata and change frozen contracts. Reusing a tenant owner role would enable escalation. Synchronous fleet fan-out would cascade remote failures and violate read latency targets. Existing organization/profile/license/meter tables cannot represent remote instances/tenants or independent observation provenance without coupling unrelated authorities. One latest-observation table is sufficient; no event/history/job framework is needed.

## Selected patterns

- Adapter: Supabase/source probes and private HTTPS transport differ from inward health/registry ports. Direction is presentation -> application -> domain; infrastructure implements ports. Port contract tests pin nulls/redaction/scope/cancellation. Remove a port only if its external boundary disappears.
- Facade: one health use case composes existing independently failing sources; one focused gateway owns injected typed transport. No provider queries in controllers/pages. Remove composition only if the feature stops combining sources.
- Explicit security chain: the operator composition root owns mTLS/scope/throttle checks, independently of the existing tenant chain. Tests enumerate both route sets and deny cross-realm credentials.
- Bounded polling/latest-observation persistence: offline fleet reads need last-known timestamps and independent transport failure. This cache is diagnostic only, never an authorization/licence/regulatory source.

## Rejected patterns

No global command/event bus, generic health plugin framework, singleton tenant state, provider hierarchy, universal operator console or separate backup job authority. Fixed source mappings and immutable functions are sufficient. No new framework/dependency is required.

## Data and tenant boundaries

- Customer identity: live Supabase session/user/tenant guard plus `can_view_system_health`; source metrics separately retain source permission/product filters.
- Service-role adapters accept organization first and apply explicit tenant joins/filters. Internal source observer reads only fixed projections, not arbitrary tables selected by request data.
- Operator identity: authorized raw TLS certificate fingerprint -> mounted strict grant file -> stable UUID and explicit metadata scopes. Tenant JWT/cookies/roles and forwarded headers never grant operator authority.
- Operator ingress backend credential: narrow role, fixed metadata/audited-read RPCs only. No service-role client or tenant content modules.
- One `operator_registry_observations` table stores approved metadata/latest source state and attempt/success timestamps. Remote IDs have no FK to unrelated local organizations. Non-forced RLS/browser denied.
- Publication ordering/idempotency: configured instance binding, revision/digest and per-source timestamps prevent out-of-order/duplicate freshness. Failed polling preserves last good source times.
- Audited disclosures: fixed RPC commits M13 security-scope evidence with operator UUID; failure denies disclosure. These receipts are not presented as tenant hash-chain entries. Existing best-effort `AuditService.log` stays compatible.
- Additive CLI migrations, explicit grants/pinned search paths and both generated type copies. No reset, historical migration replay or production migration.

## API boundary contracts

- Shared `system/schemas` and `operator/schemas`, corresponding `types` derived with `z.output`.
- Customer GET `/api/v1/system/health` rejects forged/unknown tenant inputs and returns only verified current-tenant data.
- Private operator session/instance/detail/tenant/source-metadata GET routes use strict bounded query/path/cursor schemas, default50/max100 pages and configuration/scope-bound cursors.
- Nest Zod pipes and `@ZodResponse` parse JSON both directions; static assets use explicit non-JSON declarations where applicable.
- Customer gateway uses incumbent transport; operator gateway parses same-origin mTLS GET input/success schemas without tenant refresh/session credentials.
- Unknown/withheld values are null, not zero. Safe reason codes replace provider/internal errors. Strict schemas exclude content, secrets, raw licences and internal hostnames from customer views.

## Frontend logic and rendering

- Functional SystemHealth content/components serve Organization entry and independent full-page route; operator static functional React UI is a separate app/origin.
- Focused plain `.ts` gateways own injected transport; composition roots expose test seams. Pure health/queue/freshness policies are immutable functions.
- Identity/tenant/permission revision query keys and cancellation prevent switched/revoked access from retaining visible data. Preserve unrelated licence/settings drafts.
- Incumbent Poppins, semantic tokens, `cn()`, UI subpaths, accessible tables, focus/status labels, reduced motion and locale display dates. No new customer sidebar category or marketing redesign.

## Failure modes

- Each detail probe has cancellation/bounded timing; independent failure returns degraded/unreachable/unknown with source times, not global outage or false sign-out. Public health bodies remain frozen.
- M6 detailed freshness120s and source-owned feed thresholds do not rewrite deadline/licence authority. Empty queue is not worker liveness; storage accounting is not byte integrity/free disk.
- Unknown backup execution/verified restore until M15-05; unknown build identity is never fabricated.
- Wrong CA/certificate/scope/role/headers/cursor/binding fail closed. Grant removal and cert expiry are checked on keepalive requests; CA replacement requires restart.
- Configured private polling rejects redirects/unexpected bindings/oversized/malformed/future/out-of-order data and retains last known timestamps on failure. Fair bounded cycles do not overlap.
- Diagnostic routes remain normally authorized under expiry; health never grants customer writes, regulatory approval or evidence access. Protective processing and existing exports remain independent.

## Tests and observability

Characterize public health first; observe failing schema/policy/scope/certificate/audit/cancellation tests before implementation. Test real local SQL/PostgREST ACLs, tenant/product filters, revoked authority, unknown sources, replay/order races, partial provider failure, offline restart, audit rollback and expiry-export compatibility. Require >=80% all four metrics for touched modules and independent security/code review.

Run focused suites then `pnpm verify` and applicable live-stack/auth/navigation regression suites. Use local-owner Playwright MCP plus isolated certificate contexts/Chromium/Firefox/WebKit, Supabase MCP grant/receipt cross-checks, screenshots, keyboard/accessibility and egress-blocked core checks. Load fixtures live only in task-owned disposable resources; measure200 samples/read endpoint with realistic10k registry tenants/100k queue rows and concurrent small-tenant traffic, unchanged rate limits. Targets p95<400ms/p99<1000ms are measured, not asserted without evidence.

Safe logs distinguish invalid input/authorization from dependency failures without credentials or tenant contents. Record actual source/attempt/success times, receipt IDs and reason codes. Runtime and backup assurance are distinct.

## Rollback

Expand locally -> regenerate types -> configure stable identity/build/mTLS/scopes/narrow credential -> observe retained metadata -> deploy customer and private operator code. On rollback disable only the new listener/collector and revert new presentation; retain registry observations/audit and all source data. Prior API remains compatible with additive schema. Preserve M15-01/02 enforcement and existing evidence export; no destructive data rollback or silent authorization bypass.

## Review checklist

- [x] Direct solution considered before new boundary/persistence.
- [x] Patterns have concrete triggers, contract tests and removal paths.
- [x] No request/user/tenant/session state is global.
- [x] Controllers/pages have no provider query or domain decision by design.
- [x] Application/domain do not import concrete provider frameworks by design.
- [x] Inputs/success responses use shared schemas/parsed types.
- [x] Functional JSX and focused logic gateways.
- [x] Audited disclosure/publication boundaries are explicit.
- [x] Coverage/live-stack/compatibility/deploy/rollback gates specified.
- [ ] Implementation/tests/independent review verified.
