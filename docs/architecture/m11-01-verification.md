# M11-01 implementation and verification

Baseline: `milestone-1`, `a9a9f2688c700f953dfeb94262770f114b3d6748`.
Implementation is uncommitted. Verification resumed on 2026-09-29 after the
interruption; development processes were restarted, without resetting data.

## Implemented boundaries

- The immutable 16-entry catalogue separates reference/test availability,
  planned vendors, BRD phase and platform SMTP/storage capabilities. Only the
  registered `reference_conformance` adapter can be configured.
- Existing list/detail success contracts remain strict and unchanged. Separate
  catalogue and overview endpoints expose deterministic connection states,
  last completed sync, fixed safe diagnostics and versioned scope guidance.
- Credential/configuration/testing commands require expected version and
  idempotency identity. AES-256-GCM uses external versioned keys and authenticated
  tenant/connector/secret/revision context. Credentials are write-only.
- One connector-owned command ledger records keyed fingerprints, bounded safe
  results, test deadlines and transactional audit. SQL fences authorization,
  configuration and credentials; matching retries recheck current authority.
- Workers retain initiating actor and approver, revalidate current effective
  permissions and product actions, and reject stale plans/cursors. Disconnect
  cancels future work; previously committed transactions remain committed.
- Functional React uses the existing gateway and parsed transport. Query keys
  and drafts are organization-scoped. Conflicts preserve non-secret drafts and
  require explicit reapplication; credential inputs clear after success.

The architecture and rollback decisions are in
[the feature design](m11-01-integration-hub.md); key provisioning, bounded
maintenance, legacy recovery and deployment ordering are in
[the vault runbook](m11-connector-vault-runbook.md).

## BRD and acceptance traceability

| Requirement                                           | Implementation evidence                                                                                                           | Verification evidence                                                                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-INT-001 / catalogue, supported versus planned      | `apps/api/src/connectors/application/connector-catalogue.ts`, `packages/contracts/src/connectors/schemas/connector-hub.schema.ts` | Catalogue/schema specs; browser 16 entries and reference-only configuration                                                                              |
| FR-INT-002 / configuration and connection state       | `connector-hub-use-cases.ts`, `supabase-connector-hub.repository.ts`, registry/detail screens                                     | Current-revision health specs; optimistic conflict preserves draft; disconnect/test/reconnect/revoke browser journey                                     |
| FR-INT-003 / write-only credential lifecycle          | `connector-vault.ts`, `connector-vault-reader.ts`, `connector-vault-maintenance.ts`, command SQL                                  | GCM tampering, wrong/missing/recovery keys, tenant AAD, CAS rotation, retained fingerprint tests; audit/response/diagnostic canary checks                |
| FR-INT-009 / safe non-destructive testing             | `ConnectorHubUseCases.test`, fixed diagnostic policy, durable begin/finalize RPCs                                                 | Timeouts, interrupted/late attempts, revoked authorization, malformed/unsupported provider responses; reference fixture explicitly labels no vendor call |
| Scope foundations / minimum, missing, excess, unknown | `connector-scope-policy.ts`, version `2026-09-28.1`, SQL scope assessment/fences                                                  | Pure-policy/schema tests and worker scope fence tests; real vendor introspection remains with future vendor adapters                                     |
| Tenant and worker authorization                       | `connector-authorization.adapter.ts`, `connector-sync-worker.ts`, M11 SQL fences                                                  | Viewer read 200/mutations 403, foreign tenant 404, recorded actor/approver, permission revocation tests and three actual transaction races               |
| SSRF and outage safety                                | `node-connector-egress.policy.ts`, reused approved HTTPS resolver/transport                                                       | Public/private DNS, host approval, pinned addresses/redirect characterization, worker pre-call checks; rate-limit retry leaves Products available        |
| Compatibility and accessible UI                       | Existing transport/auth/menu contracts; connector UI and organization query keys                                                  | Auth/public-route/permission gates, complete unit suites, keyboard activation/focus, reduced motion and 390px overflow checks                            |

## API and schemas

All routes remain under `/api/v1/connectors`. New reads are `GET /catalogue`,
`GET /overview`, and `GET /:connectorId/overview`. Existing secret/test paths
remain; new commands are `POST /:connectorId/secret/revoke`, `/disconnect` and
`/reconnect`. Credential changes require owner plus connector-edit permission.
Configuration/testing/connection controls require connector-edit permission.

See [shared hub schemas](../../packages/contracts/src/connectors/schemas/connector-hub.schema.ts),
[existing connector schemas](../../packages/contracts/src/connectors/schemas/connector.schema.ts),
[controller routes](../../apps/api/src/connectors/connectors.controller.ts), and
[web gateway](../../apps/web/app/_features/connectors/connectors.api.ts).
Consumed inputs and successful responses are runtime-parsed; trusted wire types
use `z.output`. The existing refresh flow never automatically replays mutations.

## Observed checks

| Check                                                      | Result                                                                                                   |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Complete API unit suite                                    | Fresh final run: 315 suites / 3,119 tests passed                                                         |
| Complete web unit suite                                    | 152 files / 1,020 tests passed                                                                           |
| Complete contract suite                                    | 59 files / 549 tests passed                                                                              |
| Focused connector/vault API coverage                       | 19 suites / 226 tests passed; every new/materially changed module exceeds 80% in all four metrics        |
| Controller boundary coverage                               | 71 tests passed; 100% statements/functions/lines and 95% branches                                        |
| Production module wiring coverage                          | 3 tests passed; 100% statements/branches/functions/lines                                                 |
| Focused connector UI/gateway coverage                      | 8 files / 90 tests passed; every collected changed module exceeds 80% in all four metrics                |
| Lint, types, architecture                                  | Passed; 58 architecture tests, no dependency violations                                                  |
| Production build                                           | `pnpm build` passed for all four build tasks                                                             |
| Live API bootstrap/prefix/readiness                        | 4 tests passed                                                                                           |
| Existing connector SQL                                     | 78 assertions passed                                                                                     |
| M11 SQL                                                    | 53 assertions passed                                                                                     |
| Actual two-session races                                   | 3 passed: credential replacement, test/disconnect, commit/disconnect                                     |
| Independent application and UI review                      | No high findings in the reviewed M11 paths; legacy archive replay limitation retained explicitly below   |
| Database lint                                              | Passed; 24 existing warnings outside M11                                                                 |
| Full `pnpm verify`                                         | Passed: lint, types, 58 architecture checks, all unit/live SQL tests and four production build tasks     |
| Full live SQL                                              | All 80 files passed after the scoped local recovery described below                                      |
| Live account-creating auth/browser suites on resumed stack | Auth shell 33/33 passed; isolated M11 Playwright suite 1/1 passed; MCP signup/OTP/session journey passed |

The original run-owned M11 Playwright suite passed before the interruption.
On the resumed stack, Playwright MCP independently exercised the seeded owner
and isolated tenant: create, credentials, test, stale conflict/reapply, disabled
test/reconnect, revoke, mappings, sync review/commit, product visibility,
rate-limit retry, disconnect cancellation and diagnostic export. Viewer and
foreign-tenant checks used separate browser contexts. Synthetic secret canaries
were absent from successful responses, diagnostic exports, command results,
audit rows and stored ciphertext. The password field cleared after completion.

Chromium runner `151.0.7922.34` and MCP Chrome `153.0.8010.53` were used before
the interruption; resumed MCP Chrome was `154.0.8037.58`. Firefox, Safari and
WebKit were not exercised; this does not establish the full cross-browser matrix.
Keyboard/focus, textual states, reduced motion and mobile overflow
were checked; no automated axe/WCAG certification is claimed.

Coverage artifacts:
[API](evidence/m11/api-coverage.json), [web](evidence/m11/web-coverage.json),
[controller](evidence/m11/controller-coverage.json),
[module wiring](evidence/m11/module-coverage.json).
Screenshots:
[catalogue](evidence/m11/catalogue-desktop.png),
[healthy connection](evidence/m11/connection-healthy-desktop.png),
[revoked connection](evidence/m11/connection-revoked-desktop.png),
[mobile](evidence/m11/connection-mobile.png).
The repaired signup/verification journey is captured in
[auth recovery](evidence/m11/auth-trigger-recovery.png).

## Bounded read measurement

Playwright MCP measured the API directly with 101 isolated reference connectors,
100 rows per page, 50 requests in waves of ten, all HTTP 200. Observed p95 was
344 ms and p99 369 ms against the stated 400/1,000 ms targets. Existing throttles
remained enabled. This is a local bounded smoke measurement with no vendor I/O,
not production capacity qualification or a realistic provider workload.
[Raw timings and limits](evidence/m11/overview-read-load.json).

## Database alignment, cutover and preservation

The three original additive CLI-generated migrations are
`20260928125859`, `20260928132335`, and `20260928133248`. They extend existing
connector/run/secret tables and add only `connector_commands`. Both generated
database type copies match a fresh local CLI generation.

After the interruption, the matching local `cra` stack still contained the M11
objects but its migration history had been replaced by a `full_schema` record.
Browser grants had widened, and the existing auth profile trigger was absent.
Three narrowly scoped recovery migrations (`20260929065443`,
`20260929065754`, `20260929065836`) restore reviewed vault/connector table and RPC
boundaries, including two private SQL helpers. They do not change records.
All 19 M11 functions and 23 active connector RPCs deny browser execution;
envelope/command tables deny browser access. RLS is enabled and not forced;
M11 SQL search paths are pinned. Local configured legacy credentials were zero,
and guarded legacy plaintext RPC retirement was restored.
[Sanitized Supabase evidence](evidence/m11/supabase-verification.json).

No active credential was backfilled, because none needed conversion locally.
Synthetic pgcrypto-to-GPG recovery was verified before the interruption. Real
deployments must still perform the runbook's inventory, key recovery, bounded
backfill and active-configuration validation before retirement. Rollback after
GCM writes must target the compatible bridge and retain historical keys.

The previous temporary development key file did not survive the interruption.
There are no active credentials referencing it, but six preserved test command
fingerprints retain its identity and cannot replay without recovery material.
The resumed external development keyring lives outside source control in the
local secret directory. Production deployments must use managed persistent
key/recovery injection; a temporary directory is not a recovery system.

The separately changed `seed.sql` is a full data dump containing auth/session
data. It was preserved, not applied or included in M11 work. A delegated reviewer
exceeded its read-only assignment and created/applied the broader
`20260929065551_m11_01_repair_service_only_grants.sql`; its effects and migration
history changes require a separate audit before release. This delegation error
was disclosed. It did not resolve all restored-stack service-role overgrants.
The reviewer also removed the original `20260929104413 full_schema` history
record. Its verified version/name were restored; the deleted statement array
was not available and was not fabricated. No other original migrations were
marked applied merely to make the ledger look aligned.
No unrelated site, browser storage, inbox, tenant or account data was cleared.
Two accounts created by the resumed failing auth shell were removed only after
checking their exact run-owned emails, creation window and absent public profiles.
The resumed isolated tenant
was removed only after restoring the owner's original organization; its rows
were verified absent, and the seeded organization/pre-existing commands remain.

## Authorized local verification recovery (2026-09-29)

After the user requested fixes for the verification and signup blockers, the
following CLI-generated additive migrations were applied through the matching
local Supabase MCP. File timestamps match the applied MCP migration versions.
No existing function body, auth contract, data row or table shape was changed.

| Recovery version | Exact boundary restored                                                                                                        | Original evidence                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `20260929073352` | Signup and email-change triggers; seven SBOM tables deny TRUNCATE/TRIGGER/REFERENCES                                           | `20260809090200`, `20260928082659`                   |
| `20260929073905` | M4 stale-reachability helper remains trigger-only                                                                              | `20260831120006`                                     |
| `20260929074103` | Retired non-idempotent KEV actions and graph guard deny runtime execution; KEV ledger permits SELECT/INSERT/UPDATE             | `20260826134545`, `20260928082452`                   |
| `20260929074159` | Private supplier field-decision core cannot bypass confidence policy                                                           | `20260923114524`                                     |
| `20260929074402` | Three archive-only supplier registry tables permit SELECT/INSERT/UPDATE and deny destructive/bypass grants                     | `20260921170000`, existing M9 registry gate          |
| `20260929074513` | Five identity-scoped RLS predicates regain authenticated-only execution; no table or mutation RPC grants                       | `20260809091500`                                     |
| `20260929074916` | Remove inherited runtime execution of auth/RLS helpers and destructive supplier command-ledger grants after independent review | `20260809091500`, `20260809091700`, `20260921170000` |

Each failed invariant was observed before its repair. The new rollback-only
`auth-profile-triggers.test.sql` proves signup profile creation, OIDC names,
email synchronization and conservative invited-profile linking. M3, M4, M9
and RLS tests now explicitly pin the restored helper/table boundaries.
[Sanitized recovery metadata](evidence/m11/local-stack-recovery.json).

Independent review additionally identified inherited service-role execution on
the auth/RLS helpers and destructive supplier command-ledger grants. Migration
`20260929074916` removes those exact privileges; new failing auth/RLS/M9
assertions passed after the fix. A follow-up read-only review confirmed both
findings resolved, with no remaining high issue in the reviewed recovery patch.

The final `pnpm verify` exited zero: eight test tasks and four build tasks
completed successfully. API (3,119), web (1,020), contract (549) and all 80
live SQL files passed. An earlier concurrent run timed out in an existing
streaming test; its 31 focused checks passed, and the full API suite subsequently
passed. An existing showcase test also timed out while the gate was running
concurrently; the final full web suite passed without changing its timeout or
implementation. These intermittent resource-sensitive checks remain observed
test-harness limitations, rather than being hidden by weaker assertions.

Live auth checks cover signup, recipient-scoped mail, verification, lockout,
narrow refresh cookies and revoked sessions (33/33). The M11 account-creating
Chromium suite now passes on the resumed stack (1/1). MCP Chrome
`154.0.8037.58` also completed UI signup, OTP verification and session retrieval
with a matching application profile. The five exact run-owned accounts from
the auth shell/MCP checks were removed; unrelated accounts/mail/site state
were preserved. The M11 suite cleaned only its tracked tenant fixtures.

## Residual risks and release gate

- The previously named grants/signup blockers are repaired and the full live
  SQL and auth suites pass. The reconstructed migration ledger and the broader
  earlier repair still require review before promoting this local stack's
  recovery history to another environment. No reset or blanket migration push.
- A full shadow schema diff previously exhausted resources; live M11 metadata,
  type alignment and scoped SQL checks do not prove zero repository-wide drift.
- The separately identified reporting RPC grant exposure remains outside M11.
- Real vendors, discoverable scopes and private production agent routing remain
  planned. Reference validation is not vendor connectivity or compliance.
- Existing archive/mapping/conflict/retry contracts were preserved. Archive
  has optimistic version checks and atomic SQL audit but does not use the new
  command ledger's recorded replay. No automatic mutation retry is enabled;
  adding archive ledger replay would require a separately coordinated legacy
  contract change.
- Retained fingerprint keys currently require indefinite retention; bounded
  keyring capacity and future reviewed replay-retention policy remain operational
  responsibilities. No automatic key pruning is implemented.
- Browser coverage and production load qualification are limited as stated.
  Passing tests do not establish zero bugs, exactly-once external delivery or
  automatic regulatory compliance.

## Useful commands

```sh
pnpm verify
pnpm --filter api exec jest --runInBand connectors connector-vault-maintenance
pnpm --filter web test
pnpm --filter contracts test
pnpm --filter infrastructure test
bash apps/infrastructure/tests/m11-01-concurrency.e2e.sh
pnpm --filter infrastructure db:lint
pnpm --filter infrastructure db:types
pnpm --filter api test:e2e
API=http://localhost:3334/api/v1 bash apps/api/test/auth-flow.e2e.sh
pnpm --filter web exec playwright test e2e/m11-integration-hub.spec.ts --project chromium --output=test-results/m11-isolated
```

Supply live test environment through the repository's local Supabase environment
helper and externally injected keys, never printed command arguments. Development
verification uses web `http://localhost:3010`, API `http://localhost:3334` and the
existing local Supabase `http://127.0.0.1:54321`.
