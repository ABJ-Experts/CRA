# M15-01 Locally verified licensing

Completed feature-design record for [the approved plan](../superpowers/plans/2026-10-13-m15-01-local-licensing.md). See the [runbook](m15-01-runbook.md) and [verification record](m15-01-verification.md) for operational procedures and actual results.

## Scope and preserved contracts

Tenant licences bound to a stable deployment UUID are verified locally. Signed entitlements, concurrent growth limits, thirty-day grace, safe expiry, renewal and operator warnings are in scope. Billing, issuer signing, call-home, destructive lockout, generic metering and implementing backups are excluded.

Preserve `/api/v1`, the narrow refresh-cookie path, ES256/JWKS sessions, frozen auth actions, zero session epoch skew, permission merge order, public-route/permission coverage, menu/mock namespace and existing successful wire shapes. Licensing supplements authorization; it does not approve reports, replace M6 deadline authority, weaken retention/legal holds or alter immutable technical-file snapshots.

## Concrete problem

Configuration cannot prove a licensed capability. A route guard alone cannot govern worker effects or concurrent service-role RPCs. Existing Supabase signed upload URLs accept bytes before the application validates their declared size, so they cannot enforce a hard ingress quota. These require local signature verification, source-owned transaction admission and bounded API uploads.

## Why not simpler?

A direct POST/PATCH denial also stops session maintenance, audited reads, manual export creation and regulatory filing. Browser visibility cannot govern workers/public source identities. A customer-editable organization flag would grant entitlements without signed authority. A post-upload count admits concurrent overrun and leaves uncertain effects unaccounted.

## Selected patterns

| Pattern and present trigger                                                   | Participants and contract                                                                                                                            | Dependency direction                                                            | Removal trigger                                                                   |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Adapter: local trust/JWS and Supabase are external boundaries                 | `LocalLicenseVerifier` implements `LicenseVerifierPort`; `SupabaseLicensingRepository` implements `LicensingPort`/`LicensePolicySynchronizationPort` | Controller → application-owned ports; adapters depend inward                    | Collapse a port only when its external boundary disappears                        |
| Pure policy: deterministic time/config/state decisions                        | `calculateTrustedTime`, `evaluateLicensePolicy`, shared parsed claims                                                                                | Application → framework-free policy → contracts                                 | Retain while decisions exist; no interchangeable provider hierarchy is introduced |
| Existing durable transaction/idempotency authority: concurrent source effects | Tenant-ordered SQL locks, source functions/triggers, M13 append and request-bound replay                                                             | Adapters invoke source-owned SQL authority                                      | Remove an admission hook only when its source mutation is removed                 |
| Focused gateway/upload lifecycle: injected transport and staged I/O           | `LicensingGateway`, `BoundedUploadService`, private staging/storage adapters                                                                         | Functional React → gateway → transport; upload controller → workflow → adapters | Collapse a class if its injected I/O/lifecycle disappears                         |

Contract, policy, repository, controller, upload and gateway specs provide test seams. Process-local verifier caching/monotonic timing contain configuration/time only; request/session/tenant authority is explicitly scoped.

## Rejected patterns

No billing framework, issuer-key database, activation-history table, command/event bus, generic metering engine, speculative backup service, signing tool, new sidebar taxonomy or animation dependency. M13 owns durable history; existing feature/source transactions own customer effects.

## Data and tenant boundaries

Identity comes from authenticated current membership or verified supplier/CI/source credentials. Global guards do not read raw request bodies. Mixed/public-source intent resolves after parsing and rechecks at the source authority.

`SupabaseLicensingRepository` passes organization UUID first to tenant RPCs. State/history/checkpoints/activation/reservations/source references are tenant-qualified. Maintenance enumeration uses bounded keyset pages and supplies no customer grant. Existing product restrictions remain authoritative. Service-role bypasses RLS; explicit scope remains the primary boundary.

Only `organization_license_states` and `organization_storage_admissions` are new public tables. RLS is enabled/non-forced; browser table privileges are absent. Functions pin `search_path` and grants. Current JWS and previous immutable artifact references use private `licence-artifacts` storage; M13 safe history excludes raw artifacts.

Activation rechecks live permission, optimistic version and increasing sequence under a tenant lock. Replacement and M13 append commit together; invalid/audit failure preserves previous authority. Idempotency binds actor/tenant/request digest. Seats/live invitations/product growth/storage serialize with source effects. Reactivation checks every affected tenant in UUID order.

Unknown ownership/size blocks customer admission. Uploading/uncertain bytes remain charged until exact reconciliation proves their outcome. Generated exports/protective inputs are separately accounted. Real pre-cutoff M6 receipt continuation still requires normal approval, session proof, exact path/content and live authorization; rehearsal inputs remain customer uploads.

Migrations are additive/CLI-created and both type copies CLI-generated. Destination/catalog inspection precedes application. Deployment and compatibility rollback preserve historical ledger drift and data; see the runbook.

## API boundary contracts

Runtime schemas live in `packages/contracts/src/licensing/schemas/index.ts`; trusted types in separate `licensing/types/index.ts` derive from `z.output`.

| Boundary                | Schemas                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| Activation              | `licenseActivationInputSchema`, `licenseActivationResponseSchema` |
| Authenticated policy    | `licensePolicyResponseSchema`                                     |
| Permissioned management | `licenseCurrentResponseSchema`                                    |
| History query/response  | `licenseHistoryQuerySchema`, `licenseHistoryResponseSchema`       |
| Upload path             | `uploadPathSchema`                                                |
| Signed claims           | `licenseClaimsSchema`                                             |

`LicensingController` uses `zodBody`/`zodQuery` and `@ZodResponse`. `BoundedUploadController` parses the path and declares its non-JSON response; raw bytes are bounded/staged/hashed/inspected. Existing `{uploadUrl, expiresAt}` and XHR PUT callers retain their contract.

`LicensingGateway.activate` supplies outgoing `inputSchema` and response `schema`; reads supply response schemas and history parses its query. Shared transport never automatically replays POST after refresh. Strict artifact/input schemas reject unknown claims/capabilities, duplicate entitlements and unsafe values. History defaults to 20/max 100. Internal stored-state parsing accepts additional persistence fields without granting authority from them.

## Frontend logic and rendering

`OrganizationLicensingSection`/`LicensingBanner` are functional. `LicensingGateway` owns injected transport; scoped query hooks compose it and expose test seams. `licensing-status.ts` contains pure display decisions. Incumbent workspace/organization composition uses semantic tokens, Poppins, `cn()` and shared UI subpaths.

Drafts survive validation/network failure/conflict; tenant change clears scope. Current licence and last rejected attempt are separate. Text statuses, visible keyboard focus, mobile table overflow and locale dates support accessible operation. Warnings stay subordinate to regulatory countdowns. Policy change does not erase unrelated unsaved work.

## Failure modes

| Failure                                                  | Behavior                                                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Malformed/tampered/unsupported/wrong binding/unknown key | Reject replacement; safe reason/digest evidence; preserve prior state                                             |
| Missing/invalid/clock-untrusted licence                  | Deny customer use; normally authorized security/renewal/protected evidence remain                                 |
| Verified licence beyond grace                            | Preserve existing reads/manual export; deny ordinary writes/computation; narrow source-authorized M6 continuation |
| Concurrent replacement/changed replay payload            | Conflict, no silent overwrite                                                                                     |
| Database/audit outage                                    | Critical activation/effects fail closed                                                                           |
| Missing size/unknown ownership/downgrade                 | Block additional growth; retain data/reads/exports                                                                |
| Revoked member/source, wrong scope, used upload token    | Reject admission/publication under current source authority                                                       |
| Partial publication/filing failure                       | Retain uncertain charge; exact hash reconciliation; matching completed receipt reused without republishing        |
| Queued grant/capacity loss                               | Pause before new effect, preserve retries, release lease, fresh resume checks                                     |
| Already admitted bounded step                            | Finish/reconcile only its original authority                                                                      |
| Clock rollback > five minutes                            | Safe mode without automatic high-water rewind/M6 changes                                                          |
| Forward jump/restored old snapshot                       | Premature expiry/lost rollback evidence possible; explicit recovery, no hardware-resistance claim                 |
| JWKS/SMTP/network failure                                | Existing auth/mail handling remains; issuer verification needs no network                                         |

## Tests and observability

RED/GREEN signature/schema/binding/time/config tests precede activation/audit/replay/concurrency, quotas/uploads, source/worker/UI checks. Receipt tests demonstrate 403/409 preservation and publication-success/filing-failure retry without duplicate upload.

Checked route/worker/mutation classification supplements independent public-route and permission gates. Focused coverage target is at least 80% in statements/branches/functions/lines. Final integrated results and limitations belong in the verification record; old green runs are not final evidence.

Reason codes/digests/versions/M13 summaries distinguish rejection from infrastructure failure. Diagnostics omit raw JWS/private keys/cookies/upload tokens/unnecessary identities. Offline and load tests are bounded evidence, not certification.

## Rollback

Expand schema, verify backfill, configure stable instance/public trust, provision signed tenants, drain legacy upload TTLs, deploy consistent API/workers, then web. Retain tables/artifacts/audit/reservations/time/sequence. Use an enforcement-compatible executable rollback; an old ungated build is not safe. If none exists, isolate customer writes while preserving reviewed maintenance/renewal/evidence/protective operations. No reset/destructive down migration/environment bypass.

## Review checklist

- [x] Direct solution and present-tense pattern triggers/contracts considered.
- [x] Request/user/tenant/session authority is not global.
- [x] Controllers/pages contain no provider query or domain grant decision.
- [x] Domain policy does not import frameworks/concrete adapters.
- [x] Feature-first schemas and parsed `z.output` types are separate.
- [x] JSON and binary boundaries are classified/parsed.
- [x] Functional rendering and injected lifecycle seams documented.
- [x] Critical effects use synchronous/durable transactions.
- [x] Compatibility/live-stack/coverage gates and limitations listed.
- [ ] Final integrated verification and all materially changed-module coverage accepted; consult verification record.
