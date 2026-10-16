# M13-02 tenant audit chain and retention protection

## Scope and preserved contracts

Deliver FR-AUD-002, FR-AUD-003 and FR-AUD-010 using the existing audit sink.
Add tenant hash chains, retention protection and an operator verifier. No new
tenant endpoint, audit UI, automatic purge, blockchain or signature claim.
Preserve AuditService.log and recordV2 signatures, durable event-key replay,
/api/v1, refresh cookies, ES256/JWKS, zero epoch skew, permission merge order,
M1-M12 source approvals and non-forced RLS. Security events without an
organization remain append-only but do not enter a shared global chain.

## Concrete problem

At 1933cfb audit_logs has redaction and durable replay but no cryptographic
sequence. The organization FK cascades deletion; the user FK changes retained
rows on actor deletion. Existing retention authorities span M1, M2 and M8.
Service-role privileges bypass RLS and therefore need explicit ledger guards.

## Why not simpler?

A BEFORE INSERT sequence allocation advances on ON CONFLICT DO NOTHING.
A database sequence also burns values on rollback. A second event table would
duplicate M13-01 and miss source-owned transactional writers. One head per
organization plus deferred finalization protects actual committed inserts.

## Selected patterns

- Adapter: Supabase paging differs from the application verification port.
  The infrastructure adapter implements the inward-owned port and parses shared
  contracts. Provider errors and malformed pages are contract-tested. Remove
  the adapter only if the provider boundary disappears.
- Native bounded iteration: verify a fixed upper sequence with keyset pages;
  no global iterator state or event bus. Empty, truncated, concurrent and
  corrupted pages are tested at the same port seam.
- Database transaction: redaction, accepted insert, chain finalization and head
  advancement share a transaction. This is durable evidence, not an observer.

## Rejected patterns

No command bus, framework, global singleton, outbox, class hierarchy, second
storage strategy or event table is justified. Pure verification stays a
function; only injected provider/lifecycle boundaries use classes.

## Data and tenant boundaries

Verified source-owned callers continue owning actor/product authorization.
Every service-role ledger query/RPC takes organization_id explicitly. The
private NOLOGIN finalizer owns chain updates; application roles cannot assume
it. Per-tenant advisory locks precede head locks. Multi-tenant transactions
take tenant locks in stable order. No domain scan or external call runs while
finalizing a chain. Duplicate inserts do not finalize; rollback restores both
event and head. A constraint check may be forced before commit, so application
transactions must retain deferred timing through their final work.

Extend audit_logs with nullable chain_version, chain_sequence, previous_hash,
content_hash and canonical_content. Add only audit_chain_heads. Existing rows
remain byte-for-byte unchanged and explicitly legacy/unchained. Activation
metadata is a checkpoint at migration time, not proof of earlier protection.
Actor UUIDs become retained snapshots; organization deletion becomes RESTRICT.
Preserve service-role INSERT for compatibility but reject caller chain fields.

Canonical version 1 uses UTF-8 without Unicode normalization, UTF-8-byte key
ordering, explicit nulls and deterministic JSON escaping. Decimal numbers
retain exact values without exponent/trailing zeros, including normalized -0.
UTC timestamps use six fractional digits. Sequence is a decimal string in wire
contracts. Genesis is 32 zero bytes. Hash is SHA-256(previous hash bytes ||
canonical UTF-8 bytes). Hash only fixed versioned retained/redacted fields.

Retention consumes existing M1 policies/facts/availability, M2 protection and
M8 evidence protection/holds. High-watermarks only extend. Incomplete/stale
sources block eligibility. Reconciliation computes before the chain lock.
No automatic deletion exists. Tenant purge requires archival and is blocked
at claim and completion before destructive work; suspension/export remain.

## API boundary contracts

New operator contracts live under audit/schemas and audit/types in
@repo/contracts, with z.output trusted types. Snapshot/page RPCs require an
explicit organization and bounded decimal-string sequence range. Successful
provider results are parsed before use. No new Nest/browser JSON route is
introduced. The existing lifecycle blocker union gains audit_archival_required
and the current lifecycle presentation gains its safe explanatory text.

## Frontend logic and rendering

No new rendering surface. Existing functional lifecycle presentation renders
the additional blocker with current semantic tokens and accessibility behavior.
The verifier has an injected port, Supabase adapter and explicit CLI composition
root. Hash verification is pure and independent of Nest/provider dependencies.

## Failure modes

Bad ranges fail validation. Missing/duplicate/out-of-order pages, unknown
versions, mismatched canonical bytes, gaps and corrupt heads fail verification.
Database failure fails durable writes/verification; best-effort auth exceptions
remain as documented in M13-01. Forged metadata, indirect mutations and tenant
purge fail closed. Retention uncertainty never grants deletion eligibility.
Network/AI are not needed for append. No automatic replay of browser mutations.

## Tests and observability

First add SQL characterization and canonical golden tests and observe the
missing chain failure. Cover duplicates, rollback, actual grants/RPC paths,
actor deletion, old-row preservation, concurrent/mixed-tenant appends, holds,
retention extension, source uncertainty and corruption. Operator tests cover
bounded pages, checkpoint-only output and nonzero failures with >=80% coverage.
Run pnpm verify, focused/live SQL and API tests, local Playwright MCP owner
journeys and Supabase verification. Test backup/restore only in a disposable
database. Record contention, pagination and API latency measurements.

## Rollback

CLI-create migrations and regenerate both generated-type copies through the
existing command. Apply only new migrations to confirmed local CRA; preserve
the pre-existing 97/537 migration ledger discrepancy. Never reset development
data. Once a chain exists preserve rows, heads and mutation guards; recover
using a reviewed forward migration. Application rollback must keep physical
purge blocked. Future archival requires full verification, approved evidence
retention/hold checks, external checkpoint custody and verified isolated restore.
An administrator can rewrite a full chain without an external trusted anchor.

## Review checklist

- [x] Direct solution and nearby alternatives considered.
- [x] Inward dependency direction and provider contract seam defined.
- [x] Tenant-local state and explicit organization scope defined.
- [x] No controller/page database query or new route.
- [x] Boundary schemas and parsed types assigned to shared contracts.
- [x] Security-critical effects transactionally durable.
- [x] Focused coverage and live-stack checks pass.
- [x] Independent review has no unresolved high/critical findings.
- [x] Deployment, archival and recovery runbooks match tested behavior.

Completion evidence: [Operations and validation](evidence/m13-02-audit-chain-retention.md).
