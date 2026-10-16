# M13-02 Audit Chain Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Append-only tenant audit evidence with deterministic hash chaining and conservative retention.

**Architecture:** Extend the existing audit sink and add one tenant head table. A deferred private writer finalizes accepted inserts; a bounded operator verifier uses shared contracts and an inward-owned port.

**Tech Stack:** PostgreSQL 17, pgcrypto, Supabase CLI, TypeScript, Node crypto, Zod, Jest/Vitest, pnpm.

**Spec:** docs/architecture/m13-02-audit-chain-retention.md; approved user plan; BRD pp14,24,36-37,54-56,64-65.

## Global Constraints

No data reset, unrelated project mutation, historical event rewrite or automatic purge. Preserve auth, permission, API, source-domain and non-forced RLS contracts. CLI migrations/types only. No new dependencies, tenant endpoint or audit screen. Service-role INSERT remains compatible; only the private writer mutates chain metadata.

## Review Focus

Duplicate inserts must not burn sequence values. Forced constraint checks and mixed-tenant transactions must remain atomic. Actor deletion must retain canonical identity. Incomplete retention sources must block eligibility. Restore must retain canonical bytes and checkpoint identity.

## Task 1: Ledger

Files: new infrastructure migration, canonical/chain SQL tests and concurrency harness.
Interfaces: audit_chain_heads; nullable audit chain columns; snapshot/page RPCs with organization UUID and decimal-string sequence values.

- [x] Add failing golden, grants, mutation, duplicate, rollback and actor tests.
- [x] Observe failure before introducing chain functions.
- [x] CLI-create additive migration; implement canonicalization, private deferred finalizer and guards.
- [x] Prove concurrency, unchanged legacy rows and head corruption handling.

## Task 2: Retention/lifecycle/export

Files: subsequent infrastructure migration; existing lifecycle contracts/presentation; export registry and tests.
Interfaces: audit_archival_required lifecycle blocker; organization-scoped raise-only retention reconciliation.

- [x] Add failing extension, uncertainty, hold and purge characterization tests.
- [x] Reuse M1/M2/M8 sources and head high-watermarks; block claim/completion before destruction.
- [x] Export canonical events and head activation metadata.
- [x] Verify suspension/reactivation/export compatibility.

## Task 3: Operator verification

Files: audit contracts, API application policy/port, infrastructure adapter and CLI composition root/tests.
Interfaces: m13_02_audit_chain_snapshot(p_organization_id); m13_02_audit_chain_page(p_organization_id,p_after_sequence,p_upper_sequence,p_limit).

- [x] Add failing range, malformed-page, gap, canonical/hash and head tests.
- [x] Implement bounded fixed-upper paging and checkpoint-only output.
- [x] Test all failure exits and >=80% new-module coverage.

## Task 4: Integration and review

- [x] Apply only new reviewed migrations to local CRA; regenerate both type copies.
- [x] Run focused/live SQL, concurrency, isolated restore, pnpm verify and applicable API tests.
- [x] Playwright MCP owner journeys/screenshots plus Supabase chain cross-check.
- [x] Measure contention/pagination/API latency and independently review changes.
- [x] Publish requirement-to-test mapping, rollout/recovery/archival runbooks and residual risks.

## Execution record

2026-10-06: baseline clean milestone-1 at 1933cfb. Local CRA confirmed; 276 public tables, all non-forced RLS. Existing migration ledger has 97/537 entries; leave unchanged. Ledger, retention and verifier workers assigned disjoint ownership. No commit/push requested.

Completion evidence: [M13-02 operations and validation](../../architecture/evidence/m13-02-audit-chain-retention.md).
