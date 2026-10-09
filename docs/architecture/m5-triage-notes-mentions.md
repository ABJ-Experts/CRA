# M5-07 Tenant-safe triage notes and mentions

## Intent and boundaries

FR-TRI-016 adds internal plain-text notes to a finding. Notes are operational collaboration records; they are not assessment reasons, VEX statements, evidence, or a general chat feature. The maximum body is 4,000 trimmed characters and a note has at most 20 distinct mentioned members.

## Design

The feature follows presentation -> typed gateway -> shared contract -> thin controller -> use case/port -> Supabase adapter. The three note tables retain a current tombstone, immutable revision ledger, and one lifetime mention record per note-recipient. Immutable display-name snapshots preserve attribution after account disablement, removal, or deletion.

The existing `vulnerability_triage_commands` ledger is extended for create/update/delete idempotency. Each SQL mutation verifies the org first, locks the note version, writes revision/tombstone/mention state, stores the idempotency result, and writes metadata-only audit evidence in one transaction. `AuditService.log()` is not used for these facts because it is not durable with the mutation.

## Authorization and delivery

Read and candidate lookup require `can_view_findings`; create also requires `can_edit_findings`; the database independently limits edits and deletes to the original author. Every finding, note, recipient, and query is constrained by the verified organization id. Candidate lookup reveals only active users with active organization membership and finding-view permission.

Mention emails contain only a generic mention message and permission-checked finding link. The queue claim/delivery RPC revalidates the recipient, membership, permission, finding, and non-tombstoned note immediately before email. Failed revalidation cancels delivery. The worker uses bounded leases, retry, and dead-letter state.

## Rejected alternatives

No generic event bus, chat framework, rich-text editor, client Supabase access, new base role, or automatic promotion to evidence was introduced. Plain text is rendered as text nodes, keeping HTML and links inert.

## Compatibility and operations

The migration is additive. Export source registration includes notes, revisions, and mention delivery records; command ledger rows remain intentionally excluded. Roll out migration/types, API plus worker, then web. Roll back API/web before any separately approved retention migration; retain the durable ledger and audit facts.
