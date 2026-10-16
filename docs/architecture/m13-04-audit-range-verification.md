# M13-04 bounded audit range verification

## Scope and preserved contracts

FR-AUD-011 exposes audited contiguous range checks with precise bounded breaks and resumable/cancellable work. Preserve M13-01 writers, M13-02 exact canonical bytes/operator CLI, M13-03 selected hashes/explorer/export and all authentication, source-domain and menu invariants. No repair, deletion, external notarization, public diagnostic portal or regulatory decision changes.

## Concrete problem

At cbcb296 the CLI verifier owns in-memory progress and stops at first failure. The explorer checks selected event hashes, not links across an interval. A corrupt tenant tail blocks both normal snapshot RPC and tenant receipt insertion. Long source-scoped checks need stable anchors, durable independent receipts, cancellation and current-source reauthorization.

## Why not simpler?

A request-thread loop cannot survive restart or fairly serve long ranges. Export jobs require CSV/JSON/storage/delivery semantics, so reusing that table breaks deployed worker contracts. Filtering hidden rows destroys sequence coverage. Shared permission/job invalidation updates introduce writer lock inversions with deferred chain finalization. Append-only scope receipts plus native transaction snapshots avoid those cycles.

## Selected patterns

- Native bounded iteration/pure policy: exact SHA256 over binary predecessor and canonical UTF8; no JSON numeric reserialization, no event bodies in results. Contract tests cover both old CLI and new kernel; remove only if chain verification is removed.
- Existing DI adapter/port: Supabase wire parsing differs from inward-owned worker/usecase contracts. Adapter has provider failure/schema/tenant tests; no unused second implementation.
- Persisted state/optimistic fencing: concrete queued/processing/terminal/cancelled/stale lifecycle, expiring leases and restart. SQL transition matrix and race tests enforce version fences.
- Transactional independent evidence: security-scope receipts atomically commit with job/source-invalidating effects; no dependency on corrupt tenant chain. Explicitly unchained, not a cryptographic authenticity anchor.

## Rejected patterns

No framework, event bus, outbox, hierarchy, external checkpoint service, per-event result table, new bucket, shared singleton state or generic jobs abstraction. Only one new audit_verification_jobs table; organizations supplies epoch/context.

## Data and tenant boundaries

Verified RequestUser supplies organization/user/session. can_view_audit is mandatory and source permissions remain intersected. Every service-role operation is org-first or explicitly self-scoped internal queue claim. Authorization scans every present event and boundary before returning canonical material/progress; unknown/deleted/hidden scope yields generic outcome without counts or sequences.

Freeze committed head/observed boundary before independent receipt creation. Creation UUID/digest replays or conflicts. Version/lease/request UUID fences transitions, cancellation and ambiguous retries. Batch sizes250/16MiB; max1m events; two global slots/one tenant; 120s leases/three recoveries; requester2/tenant10 pending caps. Round-robin batch yielding.

Scope receipt triggers write org/epoch/top-level xid8/policyversion, with transactionally required immutable projection. Job pg_snapshot detects late committed changes with pg_visible_in_snapshot; no source invalidation takes chain/job row locks. Dependency-registry parity covers every actual M13-03 visibility source/reference. Current identity/RBAC remains separately checked.

Organization UUID epoch/context is operator-only metadata, absent from browser org projection. Jobs compare epoch/database identity before snapshot reuse. Restore requires stopped writes/workers, drained transactions, epoch rotation and security receipt before reopening. Unmarked identical restore is not detectable.

## API boundary contracts

Feature schemas/types live in @repo/contracts/audit. Four /api/v1/audit/chain-verifications routes parse body/query/path/success with existing Nest decorators and web authenticated JSON inputSchema/schema. No GET mutation beyond logical audited access; no automatic POST refresh replay. Prior compact/CLI checkpoint normalization is strict; malformed/foreign/unsupported input fails safely. No user-supplied org/provider permission/progress/result.

## Frontend logic and rendering

Separate functional range panel beside existing explorer, focused injected gateway plus React Query lifecycle. Pure formatting/request identity policies remain immutable. Existing semantic tokens/cn/shared UI, accessible table, labels/focus/status/reduced motion and locale timestamps. No new navigation or marketing design. Drafts survive failures; org changes discard old jobs/results and query state.

## Failure modes

Corrupt diagnostic returns precise category after authorization, not generic outage. Provider outage/read/byte/event limits/cancel are incomplete, not corruption. No claims until checked. Missing intervals compressed and bounded100breaks/100samples. Result tracks checked range vs verified prefix; partial range and legacy cannot prove complete ledger. Hash/anchor consistency is not authenticity. Durable receipt failure rolls back effects and prevents disclosure. Stale workers cannot complete; dataset/source/RBAC changes suppress old results and require reauthorization.

## Tests and observability

First schema/kernel/SQL/UI RED tests; old23CLI characterizations. >=80allmetrics. Unit/contracts/live SQL/RLS/transactions/source dependency parity/current-cache authorization/race/restart/corruption/restore/fairness; browser owner/restricted/local-origin screenshots; root verify/live-stack. Synthetic tamper/restore only isolated database. Measure10k/100k/1m workload, foregroundp95<400/p99<1000, memory/fairness/cancel and old-transaction polling. Logs contain safe codes/job IDs only, no canonical content, cookies/secrets or hidden identities. Validate actual egress-blocked operation with loopback permitted.

## Rollback

Expand with CLI additive migrations and regenerate both type copies; apply only reviewed new migrations on confirmed CRA, never repair historic440-ledger gap. Deploy API/worker then web. Disable range UI/routes/worker for rollback while retaining new schema/jobs/markers/receipts. Keep M13-03 running, no data reset/removal or history repair.

## Review checklist

- [x] Direct solution and concrete alternatives evaluated.
- [x] Real provider/lifecycle boundaries and inward direction specified.
- [x] No browser/controller provider access or trusted browser authorization.
- [x] Shared parsed input/output schemas and no POST replay specified.
- [x] Tenant scopes, transactional evidence and corruption-independent auditing specified.
- [x] Lease/idempotency/cancel/restore and safe disclosure requirements specified.
- [x] Final integrated repository verification and live-stack repeat completed after all corrections; focused coverage/browser/load/egress evidence is recorded.
- [x] Independent spec and quality review has no unresolved high/critical findings.

Executed evidence and deployment limits are recorded in `docs/architecture/evidence/m13-04/verification.md`. Local schema has five additive migrations and exactly one new persistent table. Scope invalidation compares fields actually read by the source predicate; the registry/parity checks cover old/new tenant relationships and top-level transaction visibility. Private dataset markers are excluded from portable tenant JSON exports. No original audit bytes were rewritten.
