# M13-05 completion evidence

Baseline: `milestone-1`, `144883d24b5c32167fbce0ec12466d96bfe78f30`. Changes remain local and uncommitted. [Design](../m13-05-siem-forwarding.md), [implementation plan](../../superpowers/plans/2026-10-07-m13-05-siem-forwarding.md), [deployment/recovery/rollback](../../runbooks/m13-05-siem-deployment.md), [transport/vault runbook](../../runbooks/m13-05-siem-transport.md).

## Requirement mapping

| Requirement | Concrete verification |
| --- | --- |
| FR-AUD-012 structural tenant subset | `packages/contracts/src/audit/schemas/siem.schema.spec.ts`, `apps/api/src/audit/siem/domain/*.spec.ts`, `apps/infrastructure/tests/m13-05-siem.test.sql`: closed action/resource catalogue, secret exclusions, malformed references, product/source checks and tenant forgery |
| Secure JSON/CEF delivery | `apps/api/src/audit/siem/infrastructure/node-siem-transport.spec.ts`, collector/vault suites: real disposable TLS, both formats/protocols, hostile escaping, UTF-8 framing, endpoint/private DNS rejection, pinned sockets, credential validation, safe response classification |
| Durable cursor/retries | SQL workflow tests and `apps/api/src/audit/siem/worker/siem-worker.spec.ts`: transactional receipts, cursor staging, stable IDs, leases, fenced completion, current authority and cross-tenant provider rejection before decryption/network |
| Reviewed lifecycle/replay | SQL, application/controller and `apps/web/e2e/m13-siem.spec.ts`: explicit future-start configuration, credential rotation, disable/re-enable, preview digest, current source reauthorization and linked replay |
| Authorization/read auditing | `apps/api/test/audit-siem.e2e-spec.ts`, denial-filter tests and SQL tests: live authenticated HTTP, forbidden viewer, durable reads/denials, cached-read scope checks |
| UI/compatibility | SIEM gateway/hooks/components, catalogue/middleware parity tests and browser journey: schema parsing, draft version preservation, secret clearing, organization reset, GET refresh, keyboard/mobile states |

All new trusted wire types derive from shared Zod outputs in `packages/contracts/src/audit/types/siem.types.ts`. The controller parses body/query/path and successful responses; provider schemas parse database results. Non-JSON transport bytes are separately formatted and bounded.

## Focused results

Contracts: 100% statements/functions/lines and 88.46% branches. API controller/repository/use cases/worker/denial/entry modules meet all four 80% gates; minimum reported statement coverage 90.24%, branch coverage 82.75%, function coverage 91.66%, line coverage 91.13%. Transport and vault checks passed 60 tests; transport 93.22/90/96/96.36 and vault 95.34/88.23/100/95.23 (statements/branches/functions/lines). Maintenance command/repository meet all four gates. UI focused modules meet all four gates; latest 29-test coverage 99.63/94.52/100/99.63. These are focused module reports, not whole-repository coverage claims.

## Browser and network evidence

Playwright MCP returned `Transport closed`; the installed Playwright runner was used against only owned CRA `localhost:3101`, with isolated browser contexts and `/tmp/cra-m13-05-playwright-results`. The comprehensive journey passed on Chromium, Firefox and WebKit. The real authenticated API/database and owned TLS collector verified HTTPS JSON/CEF and TLS syslog JSON/CEF, replay/deduplication identity, forbidden viewer, narrow refresh cookie, organization switching, secret clearing and keyboard/mobile presentation. Production public DNS validation remains enforced; the test-only fixture adapter redirects its logical hostname to owned loopback listeners. No external customer collector was contacted.

The fixture API/worker ran under macOS `sandbox-exec` denying outbound network except loopback. A real external HTTPS probe was blocked and local CRA HTTP remained reachable. This establishes loopback core operation under the tested process policy; it does not establish every deployment's firewall configuration.

Screenshots were captured with cleared credential inputs and structural fixture data. Generated images were removed at the user's request during repository cleanup; the written results remain:

- Draft (generated artifact removed during repository cleanup)
- HTTPS JSON (generated artifact removed during repository cleanup), HTTPS CEF (generated artifact removed during repository cleanup)
- TLS syslog JSON (generated artifact removed during repository cleanup), TLS syslog CEF (generated artifact removed during repository cleanup)
- Reviewed replay (generated artifact removed during repository cleanup), denied access (generated artifact removed during repository cleanup), mobile (generated artifact removed during repository cleanup)

## Database inspection

Read-only local Supabase MCP reconfirmed `http://127.0.0.1:54321`. Three new tables have RLS enabled without FORCE and no anon/authenticated SELECT grants. A final catalogue query found zero M13-05 functions with anon/authenticated execution or an unpinned search path. The owned browser destination was confirmed disabled after testing; retained fixture deliveries showed HTTP acceptance and distinct syslog unconfirmed-send states. Catalogue inspections covered relationships, constraints, indexes, RPC grants/search paths, triggers, extensions and migration ledger. Existing historical ledger discrepancies were preserved. Security advisor returned intentional INFO for private RPC-only RLS tables and five pre-existing security-definer WARN entries; The performance advisor initially returned HTTP 502, then recovered (762 INFO, eight pre-existing WARN entries); four SIEM foreign-key index findings were addressed additively. PostgreSQL logs still returned HTTP 502. MongoDB is not used by CRA and its MCP is unavailable. Unrelated cloud projects were untouched.

## Interpretation and residual limits

HTTP acceptance is not proof of collector indexing or durability. TLS syslog is sent with receipt unconfirmed. At-least-once delivery can duplicate; stable event IDs support receiver deduplication. Authority changes and already dispatched traffic cannot be recalled. No source records are changed by delivery failure. No authenticity, exactly-once, legal certification or zero-bug claim is made.

Full verification and measured load results are recorded below after the final runs. Synthetic scan measurements must not be presented as end-to-end TLS/outbox throughput, production latency or worker RSS.

### Contended development read measurement

120 authenticated destination-list requests at concurrency 2, paced below the preserved 60/minute route limit, ran concurrently with repository lint/tests and SQL fixtures. p50 128.73 ms, p95 405.50 ms, p99 1,464.64 ms: **the stated latency gate was missed**. This measures a seeded development tenant on the fixture API, including durable read receipts; it is not production-size tenant evidence. Keep this result even if an isolated run passes. The initial unpaced attempt was stopped after hitting throttling and is not a valid latency sample.

The same full journey passed on Chromium (47.9 seconds), Firefox 153.0 (32.0 seconds), and WebKit 26.5 (41.9 seconds). Generated Firefox/WebKit screenshots were removed during repository cleanup. This is engine-level development verification; branded Edge/Safari, previous-major versions and comprehensive WCAG certification remain unverified.

### Database scan measurement

Disposable synthetic databases contained 10,000/100,000/1,000,000 source events, excluded by the registered selection predicate. Real 250-row staging RPC batches took 340.29 ms / 3,963.27 ms / 49,054.81 ms (40/400/4,000 batches). Audited database read p95/p99 were respectively 4.41/5.21 ms, 16.50/22.47 ms and 214.94/237.90 ms. These timings exclude HTTP authentication, selected-payload staging and TLS collector delivery. Fixtures were analyzed for realistic planner statistics; the earlier un-analyzed run was cancelled and is not a valid result.

Independent review findings were resolved with regression coverage: emergency disable/revoke without vault access; current mutation/owner permissions before cached command replay; advisory serialization of duplicate denial receipts. All infrastructure SQL regression files passed against local CRA after isolating owned API writers. Test fixtures roll back; retained development evidence is preserved.

The final schema benchmark is documented in [database results](m13-05/database-results.md): latest scan times 1,076.75 / 4,948.96 / 33,892.51 ms; audited DB read p95/p99 8.78/12.13, 18.20/27.13 and 95.25/166.87 ms. A dense authorized 10,000-delivery fixture staged in 2,241.97 ms and health reads measured p95 150.94 / p99 198.56 ms (20 samples). The 10,000 outstanding cap retained its cursor, two active claims belonged to separate tenants and a third global claim was rejected. A two-connection disable/stale-completion test passed. These are database-level results, not collector wire throughput.

Local metadata after the final additive migrations: 282 public tables, 131 ledger entries (109 baseline plus 22 owned M13-05 entries), zero unsafe browser-executable/unpinned M13-05 RPCs. Both type copies were generated using the existing normalization/copy command.

## Repository gates

`CRA_E2E_DIST_DIR=node_modules/.cache/cra-siem-build pnpm verify` exited 0. The isolated Next output avoids disturbing the existing development server. Lint/types/build passed; 72 architecture tests passed and dependency-cruiser found no violations across 2,117 modules/6,309 dependencies. Unit tests: API 4,460 (419 suites), web 1,406 (203 files), contracts 650 (73 files), shared UI 98, design system nine, docs five and agent 24: 6,652 total. Infrastructure ran all 122 SQL files successfully. `pnpm --filter api run test:e2e` passed seven suites/21 tests, including the new live SIEM HTTP workflow.

The full suite caught and fixed a SIEM catalogue compatibility issue: its configured entry is now included in the expected catalogue and its scope array uses the existing frozen-array convention. Earlier failed verification runs are retained as session logs; the successful final run is `/tmp/cra-m13-05-verify.log`.

### Isolated authenticated API measurement

The final built API (`node dist/main.js`, owned port 3334, loopback-only egress policy, no fixture transport or worker loop) served 120 paced authenticated reads at concurrency two: p50 88.13 ms, p95 98.52 ms, p99 121.72 ms. This passes the stated read gate for the seeded development tenant. The helper's static output scope calls it a fixture API; the actual process was the compiled normal API, not the browser harness. Five warmups were excluded. The helper output is `/tmp/cra-m13-05-read-benchmark-isolated.json`. An observed API-process RSS near the end was 243,040 KiB (about 237 MiB); this is neither a peak nor an isolated SIEM-worker measurement.

Sustained collector wire throughput, long outage recovery at production load, a sustained tenant-fairness SLA, isolated worker peak RSS and HTTP latency against a million-row selected tenant are not established by these fixtures. The measured database limits and small real TLS journeys cover functional boundedness, not those production capacity claims.

`API=http://127.0.0.1:3334/api/v1 pnpm test:live` exited 0: all SQL files, seven API E2E suites/21 tests and the real auth/mail script (33 passed, zero failed). The compiled API remained under loopback-only egress enforcement. Owned ports 3334/3101 were stopped after verification; pre-existing 3000/3100/3333 processes were preserved. No commit, push, customer collector enablement, destructive rollback or production deployment occurred.

### Final fixture maintenance check

The browser harness now validates/reuses its saved keyring and exclusively publishes a new 0600 keyring only when missing. Four restart/invalid-file/concurrent-create regression tests pass with 96.29% statements, 88.88% branches and 100% functions/lines. The final standard API E2E rerun passed eight suites/25 tests; final architecture rerun passed all 72 tests. Fixture lint and API types pass after this test-only change; production code is unchanged from the successful full verification run.

The owned temporary plaintext collector-credential copy was removed after tests; the current recovery keyring remains protected with mode 0600. Earlier harness launches had overwritten previous synthetic fixture keys before this fix, so those earlier inactive fixture envelopes/fingerprints are not recoverable. Retained fixture rows/receipts were not deleted or rewritten. Production keyrings use externally managed retained key material and were unaffected.

## Follow-up Playwright MCP verification

The user-requested MCP retest succeeded through a separate owned local Playwright MCP server, while the original configured bridge continued reporting Transport closed. [MCP retest evidence](m13-05/playwright-mcp-retest.md) records all four transport/format combinations, replay, refresh, viewer denial, organization switching and HTTP 429 recovery. No application changes were required. The isolated web/API/MCP services were left running on ports 3101/3334/8945; the owned destination is disabled with zero pending deliveries.
