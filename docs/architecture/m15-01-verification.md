# M15-01 verification record

Verification date: 2026-10-13. Implementation remains uncommitted on `milestone-1`, baseline `2748133fef6445a329236a2a276feb646007002b`, in the original CRA checkout. Observed local results and remaining rollout-only checks are distinguished below.

## Requirement-to-test mapping

Paths are repository-relative. API test paths abbreviated below are under `apps/api/src/licensing/`; SQL paths are under `apps/infrastructure/tests/`.

| Requirement                                                                            | Automated evidence                                                                                                                      |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Pinned EdDSA/Ed25519 trust, schema/headers, tampering/binding/input bounds             | `packages/contracts/src/licensing/schemas/license.spec.ts`; `infrastructure/local-license-verifier.spec.ts`                             |
| Exact expiry/grace, config intersection, clock rollback/offline restart                | `domain/license-policy.spec.ts`; `application/licensing.service.spec.ts`; `infrastructure/licensing-startup.spec.ts`                    |
| Authorized atomic replacement, durable audit failure, replay/sequence/version conflict | `m15-01-licensing.test.sql`; service/repository/controller specs                                                                        |
| Seats/invitations/products, downgrade, affected-tenant reactivation                    | `m15-01-growth.test.sql`; `m15-01-connector-quota.test.sql`; `m15-01-import-quota.test.sql`; source-admission specs                     |
| Server/worker classification, direct-RPC gates, tenant/product isolation               | `scripts/architecture/m15-01-operation-coverage.test.mjs`; operation registry/source integration specs; `m15-01-source-guards.test.sql` |
| Paused queues retain attempts, resume checks, bounded admitted steps                   | Worker-admission/feature-worker specs; import/connector SQL                                                                             |
| Existing reads/export under verified expiry, missing entitlement/exhausted cap         | Service/guard specs; source-guard/continuation SQL; owner browser/API journeys                                                          |
| Real existing M6 duty with human proof; rehearsal/unrelated workflow denied            | `m15-01-source-continuation.test.sql`; `m15-01-reporting-receipts.test.sql`                                                             |
| Upload bounds/scope/revocation/partial publication/completed receipt retry             | `uploads/*.spec.ts`; reporting evidence workflow spec; receipt SQL                                                                      |
| Reporting retains 403/409 rather than converting to 503                                | `apps/api/src/reporting/reporting-obligation.controller.spec.ts`                                                                        |
| Gateway parsing/draft/error/conflict/tenant switch                                     | Web `app/_features/licensing/*.spec.*`; organization licensing section spec                                                             |
| Existing auth/refresh/RBAC/navigation/source compatibility                             | Auth/public-route/permission coverage; shared permissions; legacy live SQL harness; auth shell/browser journeys                         |

The legacy SQL harness adds rollback-only synthetic licence fixtures so existing tests exercise their source authorities under enforcement. It does not disable production gates or fake API signatures. M15 suites own their fixtures. Existing queued export work is transactionally deferred during the fixture, then restored by rollback; no fixture rows commit or unrelated data resets occur.

## Observed runs and final gates

| Run                                                 | Observed result and qualification                                                                                                                                                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API full unit run before latest receipt integration | 480 suites/5,096 tests passed; scratch `api-tests-final.log`                                                                                                                                                                     |
| Receipt workflow/bounded-upload focused retry run   | 2 suites/59 tests passed; `receipt-retry.log`                                                                                                                                                                                    |
| Receipt SQL validation before CLI application       | Both assertion blocks succeeded then rollback; `receipt-sql-final.log`                                                                                                                                                           |
| Final integrated live SQL                           | 176 suites passed, including activation-receipt, quota, continuation and receipt suites                                                                                                                                          |
| Final architecture                                  | 142 tests passed; 3,314 modules/7,767 dependencies, no violation                                                                                                                                                                 |
| Real API/Supabase auth shell                        | 33 passed/zero failed; `auth-live-final.log`                                                                                                                                                                                     |
| Web full run before fixture correction              | 238/239 files and 1,666/1,667 tests passed; query-provider fixture corrected, focused 13-test regression passed; final full run required                                                                                         |
| Previous integrated `pnpm verify`                   | Passed: lint, types, 142 architecture tests, 486 API suites/5,179 tests, 239 web files/1,667 tests, 176 SQL suites, all builds. This previous run precedes the follow-up below.                                                  |
| Final follow-up `pnpm verify`                       | Exit 0 after explicit export fixture typing, scratch-build lint exclusion and fixed report-test clock: lint/types, 142 architecture tests, 486 API suites/5,187 tests, 239 web files/1,667 tests, 176 SQL suites and all builds. |
| Missing-source export regressions                   | RED: five intended failures before classification. GREEN: final focused run 4 suites/82 tests; adapter coverage 90.32% statements, 85.03% branches, 95.65% functions, 92.81% lines.                                              |
| Existing report preview regression                  | Full/focused RED after a hard-coded preview aged past 24 hours. Test-local clock pinned to the fixture plus button readiness: 7/7 GREEN, with unchanged report implementation/approval behavior.                                 |
| Tracked cross-browser follow-up                     | `apps/web/e2e/m15-licensing-read.spec.ts`: 9/9 passed across Chromium, Firefox and WebKit, with strict zero runtime-error assertions.                                                                                            |

Recorded focused policy/verifier coverage reached 100%; service/guard/startup/source/upload/UI/error-mapping checks met their focused 80% four-metric thresholds. Final focused licensing API coverage: 97.57% statements, 90.66% branches, 97.82% functions, 97.41% lines (205 tests). Contract runtime schemas: 100% all four metrics. UI: 94.34% statements/lines, 93.47% branches, 95.83% functions. The bounded controller has 100% statements/functions/lines but 75% Istanbul branches from two unreachable generated decorator metadata alternatives; executable logic is covered. A separate V8 check also counted those fallbacks (66.66% branches), so neither instrumented branch report meets 80%. Both reports and their failing coverage exits are retained; no exclusions or artificial runtime substitutions were added. The shared evidence inspector has 98.18% statements, 96.36% branches and 100% lines/functions; its combined focused upload/helper run passed 69 tests. This does not claim every changed legacy worker has a newly collected 80% report.

## Browser and real API evidence

Playwright MCP exercised the seeded local owner against the real API/matching CRA database. Valid activation, invalid replacement preserving the active licence, stale-version conflict, concurrent replacement (one success/one 409) and identical successful replay were observed. Viewer policy returned 200; management/history returned 403.

A signed grace fixture crossed the read-only boundary. Policy reported `expired_read_only`, writes false. Existing products remained readable (GET 200, 21 products); creation returned 403 `license_read_only`. Manual audit-export grant/download returned 200 with a 17,758-byte ZIP. Export creation was accepted under expiry/exhausted storage. A finite product cap blocked growth with 409 `license_product_limit`. Final production owner renewal restored active version 9/issuance sequence 10. These are test fixtures, not production licensing. The final production run also replayed an earlier successful activation after grace (200/replayed), rejected an upload overrun (400), and published an upload admitted before expiry (204) then finalized it under expiry (201/scan_pending). MCP confirmed exact object/ledger size, SHA-256 and text/plain MIME. Live tests first exposed Postgres timestamp-offset parsing and generic evidence MIME incompatibility; both received failing regression tests and fixes using incumbent content inspection before publication. Failed/ambiguous test uploads remain charged until normal reconciliation; no retained objects were deleted.

Tracked Playwright 1.62.1 follow-up (`apps/web/e2e/m15-licensing-read.spec.ts`):

| Engine   | Actual version |      Cases | Qualification                                                                                 |
| -------- | -------------- | ---------: | --------------------------------------------------------------------------------------------- |
| Chromium | 151.0.7922.34  | 3/3 passed | Owner desktop/read/navigation/refresh/sign-out, owner mobile, viewer policy/management denial |
| Firefox  | 153.0          | 3/3 passed | Same bounded journeys                                                                         |
| WebKit   | 26.5           | 3/3 passed | Same bounded journeys; strict zero page-runtime errors                                        |

The earlier WebKit errors were reproduced by tearing down an active Next navigation/prefetch request and resizing mid-navigation. Four diagnostic arms isolated the cause: external-only interception plus settled navigation produced zero errors and zero cancelled local requests. The tracked test waits for full-document navigation to settle, creates the mobile context at its target size, and rejects only external requests. It neither suppresses errors nor replaces local API responses. The earlier error-bearing scratch results are superseded by this tracked green run.

MCP journeys also used installed Chrome 155.0.8059.40. Mobile screenshots use 390×844 viewport emulation. Native Safari/Edge/previous-major versions and physical devices were not exercised. This is not a full WCAG 2.2 AA audit.

Browser routing rejects non-loopback requests. Separately, process-scoped macOS sandbox verification denied external outbound TCP with `EPERM` while allowing loopback Supabase. The realistic HTTP licensing/current/history/quota checks ran under that policy. A healthy tenant's complete export worker and API download-grant path also ran in separate sandboxed processes; actual browser download used local storage. Host firewall rules and the whole browser/storage process tree were not changed or globally sandboxed. Verifier tests separately cover offline renewal/restart; do not interpret these as a live browser renewal under denied process egress.

Screenshots:

- [Final active desktop](m15-01-evidence/licence-desktop.png)
- [Final active mobile](m15-01-evidence/licence-mobile.png)
- [Expired state](m15-01-evidence/licence-expired.png)
- [Existing products after expiry](m15-01-evidence/expired-retained-products.png)
- [Completed tenant export without a licence](m15-01-evidence/tenant-export-without-licence.png)

## Matching Supabase inspection

Local MCP URL `http://127.0.0.1:54321` matches repository `project_id=cra`; unrelated remote ERP projects were excluded. Baseline catalog had 289 public tables; M15 adds exactly two, totaling 291. MCP confirmed both new tables enable non-forced RLS and deny authenticated SELECT. All 44 inspected M15 functions pin search paths and deny browser execution. Service-only access explains the new-table INFO no-policy notices; it is intentional. Advisor totals were 259 security (254 INFO/5 WARN) and 778 performance (770 INFO/8 WARN), not all introduced by M15. The new ledger actor-FK covering index was added in `20261013081806`.

Receipt migration `20261013073500` and activation-receipt migration `20261013081806` were applied additively through CLI after rollback-only validation; both generated types refreshed. Successful activation receipts replay independently of later expiry/trust/clock policy, with current actor and request binding rechecked. Licence audit content hashes match the M13 chain formula, with no missing chain fields. Historical migration-ledger mismatch is preserved.

Final Supabase MCP read-only cross-checks confirmed local database `postgres`, 291 public tables, all 16 M15 migrations through `20261013081806`, and exactly two new public licensing tables. `organization_license_states` and `organization_storage_admissions` have RLS enabled, forced RLS disabled, no `authenticated` SELECT/INSERT, and service-role table access. All 44 inspected `m15_01_%` functions pin `search_path=pg_catalog, public`; `authenticated` cannot execute any of them; service execution exists only for the service-facing functions. Storage admissions had 29 completed rows, and `audit_logs` contained eight `licensing.activation` events. The query returned only aggregate/catalog data and did not expose licence artifacts, keys, object bytes, tokens or identities.

The original retained-source export remains blocked by absent file bytes, independently of licensing. Read-only inspection of its frozen 229-item inventory found **101 unavailable sources**: 4 evidence documents, 23 SBOM originals, 5 technical-file declarations and 69 technical-file snapshot exports. Storage metadata exists but download fails with backend `ENOENT`; no matching verified tenant-export copy was found. No source was deleted, fabricated, substituted with zero bytes or omitted to produce a partial-success archive.

The adapter now classifies explicit source 404/not-found/`ENOENT` as internal nonretryable `artifact_source_missing`, preserving existing generic unavailable wire responses. Transient 503/network failures remain retryable `provider_unavailable`. Regression tests retain source identity/version checks and prove failure before publication. Recovery requires an authoritative backup/original; its location has been requested from the user. Existing failed/queued records are retained.

A separate already-existing healthy owner tenant, with **no licence activated**, completed its full export: **49/49 parts**, 49 manifest files, verified format 1. Playwright MCP obtained the normally authorized grant and downloaded a **43,136-byte ZIP**. Its SHA-256 `158067ccb810a095d2c0d6d7c5e704207114a841b7634f96084bcd05c1145950` exactly matched Supabase's export ledger. Manifest SHA-256 was `0734601c56ae500b0e84ec2434f529f2d7341e199048efa03ec645c25d6d03b3`. The scoped worker processed only this task-owned export; it did not invoke purge or unrelated jobs. A final Playwright MCP check attempted an original-tenant export download while scoped to the healthy tenant and returned 404. The owner session was restored to the original tenant afterward (switch/session verification succeeded). This proves the full healthy export flow, not recovery of the original tenant's missing bytes.

Final byte comparison confirmed all 16 applied migration files match their frozen CLI staging copies, and generated API/database types match after the expected two-line API header. Final MCP catalog checks confirmed 291 public tables, non-forced RLS/no browser SELECT or INSERT on the two new tables, 44 M15 functions with zero authenticated execute grants, and absence of both disposable benchmark databases. All 16 M15 migrations remain applied through `20261013081806`. No reset or retained-data deletion occurred.

## Performance and remaining rollout checks

[Load verification](m15-01-load-verification.md) records both the earlier SQL-only measurements and a fresh all-16-migration HTTP run against a disposable schema clone. The latter used 10,000 members, 10,000 products, 100,000 accounting rows, 10,000 finalized licence events, real Nest guards/JWKS/contracts and genuine locally verified signed fixtures. Each of five workloads had 200 measured requests, with concurrent small-tenant traffic and unchanged rate limiting. All **1,000 requests** returned expected statuses, with no 429/5xx. Large current p95/p99: **278.139/398.241 ms**; large history: **151.625/291.688 ms**; product quota denial: **250.122/459.974 ms**. Small current/history also met p95 <400 ms and p99 <1,000 ms. Successful admission throughput, remote-network latency and arbitrary saturation are not covered.

Both disposable databases and the task-owned REST container were removed after measurements; original application data/containers remained. An earlier burst that hit the existing throttler and an initial wrong quota-status expectation were discarded; their scratch logs are retained and are not passing measurements.

Before rollout, recover the original tenant's missing storage bytes and rerun that export. Confirm signed existing tenants, accounting readiness, actual legacy upload-token drain and consistent API/worker revision. Production host-wide egress/browser/device coverage and clock snapshot/forward-jump limitations remain explicitly scoped. No zero-bug/legal-certification/untested-browser claim is made.

Private scratch evidence is in `.superpowers/sdd/2026-10-13-m15-01/`. Never package it: it also contains dynamic test signing material/local credentials.
