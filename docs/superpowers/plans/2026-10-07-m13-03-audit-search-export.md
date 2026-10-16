# M13-03 implementation plan

Goal: deliver FR-AUD-004/005/006 with immutable audited search snapshots and
private bounded CSV/JSON export, preserving all existing auth/source contracts.
Design authority: `docs/architecture/m13-03-audit-search-export.md`.
Baseline: milestone-1 at 7d686f18a15f9f0c26408273b406a11d8c7f67cf.

- [ ] Contracts: failing schemas first; strict filters/cursors/legacy variants,
  export status, manifest/proof coverage, z.output types and boundary parsing.
- [ ] Database: failing SQL first; additive CLI migration, action-specific
  durable receipts, source authorization, one export job table, private bucket,
  bounded leases/idempotent transitions/grants; no reset or ledger repair.
- [ ] API: failing policy/controller tests first; opaque snapshot tokens,
  audited read/detail/verification, thin scoped routes and verified download.
- [ ] Export: failing archive/worker tests first; streaming CSV/JSON/ZIP and
  hashes, offline verifier, private upload, lease/restart/partial failure checks.
- [ ] Web: failing gateway/UI tests first; functional explorer/detail/export,
  shared menu/protected route parity, keyboard/focus/status/retry behavior.
- [ ] Integration: focused coverage >=80%, SQL/RLS/live auth, architecture gates,
  pnpm verify, current CRA owner/restricted Playwright journeys and screenshots.
- [ ] Evidence: requirement links, independent corruption checks, performance,
  bounded memory/tenant fairness, egress-blocked operation and rollout runbook.
- [ ] Review: independent security/correctness check; resolve high/critical issues
  before completion. No commit/push/deletion is part of this task.

## Requirement-to-test map

| Requirement | Required checks |
| --- | --- |
| FR-AUD-004 | Receipt replay/conflict, no recursion, own read excluded, failed append denies disclosure |
| FR-AUD-005 | Each filter/parity, stable sequence/legacy paging, UTC/DST, concurrent appends, source isolation |
| FR-AUD-006 | CSV hostile cells, typed JSON, manifest/files/proofs corruption, independent verifier |
| Tenant/security | Forged org, revoked identity/access, unknown scope, denied detail/count/job/download |
| Operational | Lease/restart/attempt caps/fairness, upload/completion ambiguity, expired/interrupted grant |
| Compatibility | Auth/cookies/JWKS, org switch, RBAC merge order, menu/mocks, M1-M12 regression gates |

## Chosen defaults

Recent 30 days, maximum 366 days, half-open UTC range; pages 50/max200; snapshots
30 minutes; exports 100000 events/256MiB; worker batches 250 with byte bounds;
two worker slots/one active per tenant/three attempts; grants five minutes.
Legacy included but never chain-verified. Offline hashes/proofs cannot establish
filtered completeness or authenticity without a trusted external checkpoint.
