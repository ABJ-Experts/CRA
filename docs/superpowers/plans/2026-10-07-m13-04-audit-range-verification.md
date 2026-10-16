# M13-04: Audit-chain range verification implementation plan

> For agentic workers: use independently owned contracts, database, engine/API and UI slices. Every slice follows failing tests, implementation, coverage and independent review. Keep changes uncommitted until requested.

**Goal:** Verify an authorized bounded contiguous audit-chain range, resume or cancel long checks, and disclose precise integrity breaks without hidden evidence.

**Architecture:** Functional React -> focused gateway -> authenticated transport -> feature-first Zod -> thin Nest controller -> application policy/port -> Supabase RPC adapter. Reuse M13-02 canonicalization/hash rules and M13-03 source authorization; do not overload selected-event verification.

**Tech stack:** Existing Next/React, Nest, Zod, PostgreSQL/Supabase, Node crypto, Jest, Vitest and Playwright. No new dependencies.

**Spec:** FR-AUD-011 and the user-approved plan; feature design `docs/architecture/m13-04-audit-range-verification.md`. BRD source: CRA-Sentinel-Technical-BRD-v2.0-ABJ-Experts.pdf pages 36-37, 54-56, ADR-012, lifecycle/verification.

## Global constraints

- Baseline `milestone-1` at `cbcb296ea95b8a5d54e12718faf7654348b1f0e2`, clean and remote-matched. Preserve M13-01/02/03 and M1-M12.
- Source access is mandatory. Hidden/deleted/unknown/unresolved sources return generic scope_unavailable, no hidden sequences/counts.
- Frozen database boundary plus optional saved checkpoint; no authenticity or verified-complete-ledger claim. An audited operator marker identifies restored datasets.
- Preserve /api/v1, narrow refresh cookies, ES256/JWKS, frozen auth-actions, zero session skew, permission merge order, approvals, navigation and MSW. No POST replay after refresh.
- Preserve AuditService.log/recordV2 and existing CLI contracts/canonical bytes. RLS enabled, never FORCE; org first on service-role queries; private RPC grants and pinned search paths.
- CLI-create migrations and regenerate both type copies through the existing command. Do not reset, replay historical missing migrations, repair/hash history, restore live data, delete evidence, upgrade containers, push or commit.
- Node20+, pnpm, installed dependencies only. Functional UI, semantic tokens, cn(), shared UI subpaths, keyboard/focus/reduced-motion support.

## Review focus

- Corrupt tenant head blocks tenant audit appends: independent security-scope receipts must remain durable and atomic with job effects.
- Writers started before authorization may commit afterward: top-level xid8/pg_snapshot checks must invalidate cached access, including subtransactions.
- Resume/cancel/expired leases race: stale workers must never publish or expand the frozen range.
- Source deletion/move/relationships or revocation invalidate already-completed results before disclosure; no hidden progress/aggregates.
- Restored snapshot transaction IDs are not portable: dataset epoch/database identity comparison precedes any reuse, and restore requires quiescence.

## Public interfaces and semantics

Four routes at /api/v1/audit/chain-verifications: POST create, GET /:jobId status, POST /:jobId/cancel and POST /:jobId/resume. Require can_view_audit, verified org/requester, shared input/output parsing. Creation: requestId, fromSequence default1, optional toSequence (captured upper), optional compact or existing M13-02 checkpoint normalized by Zod. Controls: requestId/expectedVersion. Status: logical requestId. Replay identical requests, conflict changed inputs/versions. Checkpoint binds org, activation, version, sequence and hash; foreign/malformed/unsupported input rejects, ahead checkpoint gets distinct comparison.

Workflow queued/processing/completed/failed/cancelled/stale is separate from outcome consistent/integrity_break/empty/legacy_unchained/checkpoint_unavailable/scope_unavailable/incomplete. Results contain SHA256/chainVersion1, requested/checked/verified-prefix boundaries, check time, inspection completeness, bounded break summaries and dataset context. Always authenticityProven=false and completeLedgerVerified=false; UI says Range internally consistent only after actual successful checking.

Categories distinguish predecessor, missing interval, duplicate/reordered provider rows, canonical/hash/previous-link mismatch, unsupported version, frozen-boundary/head mismatch and prior-checkpoint mismatch. Compress gaps, retain <=100 breaks and <=100 samples including first affected sequence; hitting limits ends incomplete. Failure/cancellation/scope does not become corruption. Empty/legacy-only/unavailable/restored are distinct non-green cases. Chained ranges ignore explorer actor/action/date filters and label this explicitly; legacy remains excluded from chained claims.

## Persistence and security

Exactly one new audit_verification_jobs table. Keep audit_export_jobs unchanged. Store immutable request identity/digest, tenant/requester, frozen anchors, permission/policy version, dataset identity, authorization snapshot/cursor, crypto checkpoint, bounded breaks, outcome/state, lease/retry/version/timestamps. No event-ID array, artifact table, bucket or external checkpoint service. Private grants, nonforced RLS, tenant indexes and deployment-local tenant-export classification.

Use action-specific append-only SECURITY audit_logs receipts (organization_id=NULL) for create/claim/checkpoint/finish/fail/cancel/resume/status/verified denials, atomically with effects. Strict structural projection, generic metadata and old canonical bytes unchanged. Receipts are explicitly unchained. Internal scans never call public read usecases. Tolerant private diagnostics capture corrupt head safely instead of turning every mismatch into read_failed.

Authorize every existing row and required boundary before canonical material/progress disclosure using existing M13-03 source predicates. Scope changes append security receipts containing org/epoch/dependency-policy version/top-level pg_current_xact_id. Job stores authorization-start pg_snapshot. Current identity/RBAC plus committed relevant receipts NOT visible in that snapshot invalidate before batches/resume/finish/status. Index org/epoch/unsigned transaction ID. Source effect rolls back on receipt failure. Exhaustive dependency registry/parity covers existence, insert/delete, old/new-org moves, references, products/releases/evidence links, owners and active targets. Never update common permission/job rows from invalidation triggers or use row xmin/subxids.

Add audit_dataset_epoch UUID and audit_dataset_context unknown|live|restored (defaultunknown) to organizations. Operator-only expected-epoch/requestUUID helper rotates UUID and writes security receipt atomically. Guard originating session_user=postgres; API definer functions must not gain authority. Keep marker columns out of org response projections. Jobs store database identity/epoch; mismatch invalidates before snapshot reuse. Restore runbook pauses/fences writes/workers, drains transactions, rotates marker, then reopens; hashes cannot identify an unmarked identical restore.

Worker: <=1,000,000 events; <=250 rows/16MiB batch; 2 global slots/1 per tenant; round-robin requeue between batches; 120s leases; 3 failed/recovery attempts; <=2 pending per requester/10 per tenant. Replay consumes no extra capacity. Cancel immediately fences version/lease. Resume retains range, reauthorizes and revalidates checkpoint/anchors. Never compare against newly appended live head or publish partial work as completed.

### Task 1: Contracts and characterization

Ownership: new audit range schemas/spec/types/barrels in @repo/contracts. Produces parsed create/control/status/checkpoint/job/result contracts shared by all slices.

- [x] Write failing decimal/range/checkpoint/result-invariant/hidden-scope tests.
- [x] Run and observe RED; implement minimal Zod normalization and z.output types.
- [x] Run focused schema coverage/build/lint and 23 old verifier characterizations.
- [x] Independent spec/quality review, fix findings.

### Task 2: Database workflow and authorization projection

Ownership: CLI-created additive migrations and SQL/concurrency/load/restore tests. Produces private create/read/control/claim/batch/checkpoint/denial/operator RPCs implementing shared job semantics.

- [x] Write/run RED SQL/RLS/transaction tests in isolated synthetic fixture database.
- [x] Implement single table, marker columns, security receipts, source parity/invalidation, bounded diagnostics and transitions.
- [x] Test replay/conflict, private grants, receipt rollback, scope changes, pre-existing/late writers/subtransactions, source moves, cancel/lease races and restore epoch.
- [x] Review before live additive application; DB lint and existing CLI type regeneration, preserve 440 historical ledger discrepancies.

### Task 3: Engine, worker and API

Ownership: pure shared row checks, range engine/worker/ports, entrypoint; separate API/application/Supabase adapter/controller/filter wiring. API consumes Task1 contracts and Task2 RPCs; adapter implements actual worker port.

- [x] Write/run RED exact-byte/large-number/all-break-category/byte-short-page/partial/concurrent-append/bound tests.
- [x] Extract shared pure checks preserving old CLI; implement bounded persisted worker and --once composition.
- [x] Implement four thin routes, sanitized errors, independent denial receipts and provider parsing.
- [x] Test authorization-before-read, failure-before-disclosure, restart/cancel races, corrupt-head receipts, stale/denied results; focused coverage/review.

### Task 4: Explorer range panel

Ownership: new gateway/hooks/panel/helper tests and /audit mount; do not grow existing 800-line explorer. Consume Task1 contracts and Task3 routes.

- [x] Write/run RED gateway/hook/component tests.
- [x] Implement explicit sequence range, bounded16KiB checkpoint import, progress/cancel/resume/result table, draft/requestUUID preservation, org-scoped cleanup.
- [x] Test loading/empty/legacy/checkpoint/restored/stale/forbidden/failure/retry, hidden suppression, keyboard/focus/status announcement, GET refresh/no POST replay.
- [x] Focused coverage/review; no new fonts/GSAP/marketing imagery.

## Acceptance/deployment/evidence

At least80% statements/branches/functions/lines for each new/materially changed module. Focused suites, architecture gates, pnpm verify and applicable live-stack checks. Test tampering, gaps/truncation, order/duplicate, invalid boundary, coherent rollback vs saved checkpoint, unknown versions, tenant forgery, source/access revocation, duplicate events, partial failure/restart/fairness and receipt rollback. Tamper/restore only disposable synthetic DB, never retained evidence.

Playwright MCP only CRA dev origin, owner/restricted accounts; range/progress/cancel/resume/checkpoints/refresh/org switch, screenshots; integrity UI response fixtures labelled injected. Preserve all other site storage. Benchmark10k/100k/1m mixed-tenant ranges, memory/cancel/oldtxn-polling and foreground latency; targets p95<400ms/p99<1000ms. Record actual results. Verify actual outbound-egress blocking permitting loopback services.

Deploy additive schema/types, API/worker, web; confirm CRA identity, preserve historical ledger/runtime. Rollback disables panel/routes/worker and retains jobs/metadata/receipts; no purge/backfill/repair. Record requirement-test links, coverage/screenshots/load/migration/restore/rollback and residual limitations. No zero-bug/legal-certification or authenticity/complete-ledger claim.

## Execution status (2026-10-07)

All four implementation slices and independent review are complete. Five additive migrations and generated types are applied locally. Full live-stack checks passed (six API suites/18 tests; auth33/0); Chromium/Firefox/WebKit journeys, actual egress-blocked workflow, 10k/100k/1m database-worker checks and bounded scheduler fairness evidence are recorded in `docs/architecture/evidence/m13-04/verification.md`. A complete repository verification passed; the final live and repository repeats passed after the real existing export writer/read-stream race was fixed and covered by deterministic RED/GREEN regressions. Production concurrent mixed-tenant HTTP load, named-browser previous-major coverage, exhaustive accessibility evaluation and cloud/MCP advisor validation remain explicitly qualified deployment checks. Changes remain uncommitted.
