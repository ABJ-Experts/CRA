# M5 bulk assessments and controlled propagation

## Scope and preserved contracts

- **User outcome:** an authorized tenant editor can preview, confirm, execute,
  retry, and safely undo a bounded bulk VEX assessment operation; they can also
  preview propagation of a current VEX assessment to matching component
  versions in other releases.
- **In scope:** server-captured selection snapshots, bounded execution,
  attributable target results, propagation blast-radius preview, compensating
  undo, and feature-local Findings UI.
- **Out of scope:** mass approval, publication/export, M2 graph propagation,
  assignment, suppression, a background workflow framework, and changes to M4
  human verdicts.
- **Preserved:** `/api/v1`, M4 document-scoped routes, M5 queue keyset reads,
  M5-02 VEX approval semantics, cookie/JWKS/session behavior, permission merge
  order, menu contracts, and mock passthrough.

## Concrete problem and direct solution

A browser list is neither an exact durable selection nor safe under concurrent
assessment changes. A selection may exceed the visible page, source facts may
change between preview and confirmation, and an assessment can be revised or
decided while a command is in progress. The direct solution is a focused
operation record plus target rows, captured by the database using the existing
M5 queue/filter and VEX tables.

The M2 source/job/graph tables are rejected: they model relationship impact
fanout, not immutable VEX revisions or a human-confirmed selection. Reusing
them would couple unrelated lifecycles and introduce a worker dependency.

## Selected patterns

- **Direct composition with a persistence adapter:** React -> typed Findings
  gateway -> Nest controller -> focused use-case/port -> Supabase RPC. The
  adapter is retained only while Supabase is the external boundary.
- **Frozen operation snapshot:** a bulk-operation row and child target rows are
  required because the request must name exactly what will change and later
  prove why an item was skipped. This is not a general workflow engine.
- **Transactional command record:** M5-02's command ledger deduplicates preview,
  execute, retry, and undo commands. Database state, target result, VEX history,
  and parent audit evidence commit together per bounded RPC transaction.
- **Compensating projection:** VEX content remains append-only. Undo marks only
  a still-current bulk target as undone and the read projection restores its
  captured predecessor (or absence); it never deletes evidence or overwrites a
  later revision or decision.

## Data and tenant boundaries

All RPCs receive verified organization then actor IDs, verify active membership,
and apply organization filters to findings, assessments, evidence, snapshots,
targets, releases, components, and audit entries. Read and preview require
`can_view_findings`; create, execute, retry, propagation, and undo require the
existing `can_edit_findings`. Approval remains a separate M5-02 AAL2 action.

An operation captures at most 500 targets and expires after 30 minutes. One
explicit execute/retry call processes at most 100 targets. A stale/archived or
changed target is surfaced as an attributable result; initial execution stops
for changed scope, and a second explicit confirmation can apply only unchanged
targets. Cross-tenant identifiers return safe unavailable/not-found results.

Propagation requires a current source VEX assessment and matches active tenant
findings by vulnerability identity, canonical component identity, and exact
canonical component version. It copies submitted content only; each target
resolves and snapshots its own approval policy. Decisions are never copied.

## API and UI boundaries

The `vulnerability-assessment-bulk` contract defines strict preview, operation,
target outcome, confirmation, retry, undo, and propagation input/output shapes.
Nest parses all path/body values and validates successful responses. The browser
validates outgoing commands and responses through the authenticated transport;
POST commands are never replayed automatically.

The existing Findings queue/detail receive code-split, keyboard-accessible
controls for selected rows versus all matching findings, preview scope and
exclusions, explicit confirmation, bounded progress, per-target results, retry,
undo, and propagation blast radius. Existing semantic tokens, focus return,
virtualized queue focus, and reduced-motion behavior remain intact.

## Failure modes and rollback

Invalid VEX inputs, evidence, or selection data fail before persistence.
Duplicate commands replay only an exact idempotent result; mismatched payloads
and stale versions return actionable conflicts. Provider failures are safe
unavailable errors. Partial chunks remain visible and retryable; no silent
success is reported.

Deploy in expand order: additive migration and generated types, API, then web.
Roll back web/API first; retain immutable VEX, snapshot, target, and audit data.
No destructive down migration is introduced.

## Verification

Characterize M4/M5 compatibility first. Cover contracts, permissions, tenant
isolation, idempotency, changed scopes, component/version matching, retries,
concurrent revision/undo, transaction rollback, RLS/grants, keyboard behavior,
and the local browser flow. Add indexes only after `EXPLAIN (ANALYZE, BUFFERS)`
proves they are required.
