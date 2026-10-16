# M14-04 verification evidence

## Scope and environment

Development branch `codex/m14-04-scheduled-reports` starts at `59093a2`. Verified local Supabase project `cra`, API `http://127.0.0.1:54321`. Real CRA web/API used ports 3002/3334 with mocks disabled. The unrelated port-3000 site, other browser site data and sibling worktrees were preserved. No reset, historical migration replay, commit or push occurred.

Read-only Supabase MCP verified run/recipient/export/dispatch state, enabled non-forced RLS and revoked browser table grants. New tables are service-only: the security advisor's RLS-without-policy INFO entries reflect intentional default denial, not browser access. See [Supabase advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Five new foreign-key index recommendations were addressed through the additive index migration.

## Acceptance to verification

| Acceptance or invariant | Evidence |
| --- | --- |
| Bounded definitions and approved sources/columns | `packages/contracts/src/reports` schema tests cover all 117 member sources plus readiness, reject portal sources/arbitrary fields/internal context, and normalize native filters. |
| Versioned recurrence and fixed/rolling windows | Contract policy tests cover DST gaps/folds, half-hour changes, month-end/leap-year clamping, timezone aliases, activation boundaries and bounded latest catch-up. Core SQL tests exercise recurrence and frozen definition snapshots. |
| Preview before activation and selected-recipient eligibility | `m14-04-preview-eligibility.test.sql`, editor/workspace tests; owner-only generation, safe eligibility statuses, immutable diagnostic and fresh activation checks. |
| Owner/recipient current authorization and tenant isolation | Core/source-intersection/delivery SQL tests cover forged tenant, cross-tenant/inactive/unverified recipients, scope intersection, removal/re-addition, owner loss and current frozen-snapshot authority. |
| Stable occurrence and overlapping workers | `m14-04-concurrency.e2e.py` uses two real connections in a disposable schema-only database: one occurrence per definition, fair recipient claims, one running scheduled job per tenant, expired-lease takeover and stale-worker rejection. Clone cleanup verified. |
| Independent completed artifact evidence | Core SQL capture/render completion/publication and transactional audit checks; immutable companion checksum and M13 publication fact commit together. No notification or download before publication. |
| Recovery without duplicate generation/delivery | `m14-04-publication-recovery.test.sql` and worker tests: publication-only recovery preserves ready artifacts; safe failed recipient replay leaves accepted/uncertain siblings untouched; expired artifacts cannot regenerate. |
| Email uncertainty and outages | M12/mail tests and delivery rollback tests cover ambiguous expired send leases, acceptance checkpoint failure, generic retry rejection, known-safe pre-send errors, opt-out and quiet hours. |
| Protected downloads | Delivery SQL tests and Playwright MCP: current session/epoch, source scope, wrong/repeated grants, expiry and missing manifest. Stream adapter rechecks after storage open and during chunks. |
| Compatibility | Existing exports 201 API tests, auth-route/permission 14 tests, source export SQL compatibility, notification legacy defaults and cursor scopes, tenant archive security exclusions, and the scheduled-report audit predecessor/fingerprint amendment. |
| Browser flow and egress-blocked inbox | Live Chromium spec passed preview → activation → controlled scheduled run → inbox → single-use CSV download, viewer denial and replay rejection; external browser HTTP requests blocked. |
| Accessibility and responsive UI | Visible labels/focus/semantic status, reduced-motion styles, one-main-landmark tests; MCP desktop/mobile screenshots and 390px no-overflow check. No axe dependency introduced. |

## Live observations

The owner/admin two-recipient schedule generated two distinct ready exports and companion manifests. Each M12 dispatch was accepted once; Mailpit contained two fixed-subject messages with zero attachments. Owner CSV response was HTTP 200, 2,883 bytes; repeated grant returned 404. After pause, manifest/grant/download remained 200/201/200 until expiry. The owner response exposed no artifact from the other recipient. The admin recipient received one own-recipient row and downloaded their artifact, while owner-definition access returned 404. A viewer received 404 for definition, run and manifest.

Opt-in notification feed returned the report notice; legacy feed returned zero report notices. Completed replay returned HTTP 409 in 105 ms after business conflicts were moved from retry-inducing SQLSTATE `40001` to `P0001`. Native transaction serialization failures retain their existing database semantics. Both live test definitions were archived after verification, preserving history/artifacts and preventing recurring test mail.

Screenshots: [schedule](evidence/m14-04/m14-04-schedule-desktop.png), [desktop run](evidence/m14-04/m14-04-run-desktop.png), [mobile run](evidence/m14-04/m14-04-run-mobile.png), [preview eligibility](evidence/m14-04/m14-04-preview-eligibility-desktop.png), [final desktop](evidence/m14-04/m14-04-final-e2e-desktop.png), [final mobile](evidence/m14-04/m14-04-final-e2e-mobile.png).

## Coverage and load

Focused coverage exceeded 80% for statements/branches/functions/lines on new and materially changed modules: contracts ~99% lines/93% branches, report API ~98% lines/87% branches, source integrations above80% each metric, M12/mail ~96% lines/90% branches, reports UI ~91% lines/81% branches. Final broad totals: API 460 suites/4,889 tests, web229 files/1,613 tests, contracts79 files/855 tests. All passed.

Rollback SQL load fixture: 100 definitions, 10,000 runs, 100,000 recipient history rows, 10,000 completed export metadata rows and 1,100 verified members. Each RPC had 10 warmups and 200 samples; no persistent ANALYZE or existing-row changes. p95/p99 milliseconds: definition .217/.443; definition page1.017/1.758; runs6.033/7.493; detail5.730/6.570; administration .320/.687; roster66.163/89.445. All met400/1000ms targets. These measure authorized SQL/JSON assembly, not HTTP, rendering or storage throughput; export fixtures contain zero-row CSV metadata.

Live authenticated HTTP through Next proxy, 40 sequential samples/route on the verification fixture: definitions90/115ms, runs70/78ms, roster51/73ms, detail61/71ms p95/p99; all responses200. This is a separate small-fixture network measurement, not a production capacity certification.

## Commands and residual constraints

- `pnpm verify` (lint, types, architecture, unit/SQL tests, builds): passed (exit 0), including all infrastructure rollback tests.
- `pnpm --filter infrastructure run test`: passed within pnpm verify; run once at a time because existing tenant-export fixtures acquire broad table locks.
- `python3 apps/infrastructure/tests/m14-04-concurrency.e2e.py`: passed; disposable database removed.
- Realistic performance fixture and focused SQL tests: passed with rollback.
- `API=http://localhost:3334/api/v1 bash apps/api/test/auth-flow.e2e.sh`:33passed/0failed.
- `pnpm --filter api exec jest --config ./test/jest-e2e.json --runInBand`: passed:8suites/25tests after the final SMTP browser journey. Parallel shared-owner suites are unsuitable for zero-skew revocation tests.
- `E2E_WEB_ORIGIN=http://localhost:3002 E2E_REPORTS_LIVE=true pnpm --filter web exec playwright test e2e/m14-04-scheduled-reports.spec.ts --project=chromium`:final journey with explicit SMTP acceptance passed in2.7minutes; scoped cleanup archived its own definition.

The historical migration ledger mismatch remains. Rollout/rollback is in `m14-04-deployment-runbook.md`; no destructive down migration or automatic cleanup is supported. SMTP cannot guarantee exactly-once acceptance; uncertain delivery remains terminal. Artifacts remain retained under existing authorities and storage growth needs monitoring. JWT epochs preserve the existing whole-second issuance semantics and zero configured skew. Browser evidence covers Chromium desktop/mobile only; previous-major Chrome/Edge and native Firefox/Safari/WCAG audit were not certified. No zero-defect or legal-certification claim is made.

Final preview diagnostic in Playwright MCP displayed Owner Account · Eligible and Viewer Account · Ineligible · Source access denied. Supabase confirmed a succeeded preview with exactly one owner artifact recipient. Mixed eligibility left activation enabled, and the page had one main landmark. The test definition was archived without activation.

Known pre-send email failures use the existing bounded M12 automatic retries (up to 12 attempts). Manual report replay resumes failed generation/publication only; exhausted email is not blindly resent. Accepted or uncertain email is never replayed.

Final SMTP/browser case: definition `208e2bda-7d4f-4655-ba0e-522306eb2003`, scheduled occurrence `a07aefae-8874-4d11-9f0c-3424c920b330`. Supabase MCP confirmed succeeded run, ready recipient, matching manifest checksum and provider_accepted dispatch with attempt_count1. The definition was archived after the test. Mailpit confirmed exactly one corresponding fixed-subject message, zero attachments, an authenticated application link on port3002 and no bearer download grant in the message.

Final applied ledger:196versions versus637repositorymigrations; latest20261012080211. Baseline mismatch is preserved, not repaired. Advisor checks found no missing FK indexes for the three report tables. Service-only table grants and non-forced RLS were reconfirmed. No disposable concurrency database remains.

Final pagination boundary regression: request and response cursors are UUID keysets for definitions, runs, administration and recipient roster. Malformed cursors are rejected by the shared schema before SQL UUID casts; the UI mock fixtures use actual UUID cursor shapes.

After pagination hardening, `pnpm verify` passed again (exit0): contracts855, API4,889, web1,613 plus136 other package tests; all7,493 unit tests, infrastructure SQL tests, architecture gates and builds passed. The two updated cursor UI fixtures passed9focused tests. Fresh owner sign-in returned200 and malformed definition/recipient cursors returned400 from the real API. No production changes followed these checks.
