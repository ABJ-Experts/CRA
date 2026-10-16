# M11-01 integration catalogue, credential vault and diagnostics

## Scope and preserved contracts

Extend the existing connector module with a truthful BRD catalogue, write-only
credentials, safe connection diagnostics and versioned scope foundations.
Only `reference_conformance` is currently executable. Vendor cards describe
planned capabilities; existing SMTP and storage services remain infrastructure.
Vendor adapters, production agent ingress and notification channels belong to
their existing M11/M12 owners.

Preserve `/api/v1`, ES256/JWKS, refresh-cookie scope, frozen auth actions,
permission merge order, menus, MSW passthrough, M2 mappings/dry runs/conflicts,
and M1-M10 workflows. Existing connector list/get and mutation success shapes
remain unchanged. New overview endpoints own additional operational metadata.
Credential/test requests intentionally require optimistic version and idempotency
metadata; deploy their web/API callers together.

## Concrete problem and why not simpler

At baseline `a9a9f26`, secret replacement has no expected version, encryption
has one unversioned PGP key, tests have no durable attempt identity, the worker
substitutes an owner/admin during commit, and reference-adapter cache keys retain
plaintext secrets. A new catalogue card or best-effort audit cannot address
these races or provide recoverable rotation. The existing connector tables,
application/adapter seam and tenant-fair worker remain the direct solution.

## Selected and rejected patterns

- Inward-owned vault and authorization ports: API/worker encryption and effective
  permission checks have concrete external dependencies. AES-GCM/keyring and the
  existing permission resolver implement them; contract tests verify isolation,
  recovery and safe failures. Remove a port if the boundary disappears.
- Immutable catalogue and scope/configuration policies: no tenant state or
  provider calls. Only registered adapters can become configurable.
- Feature-owned durable command ledger: retries, tests and concurrent secret
  changes need retained operation identity and transactional audit. One table
  follows existing feature ledgers; no separate catalogue or general queue.
- Existing persisted run lifecycle: add revision and authorization fences rather
  than a new workflow engine. Test legal transitions and stale completion.

Reject a command/event bus, global orchestration system, vendor SDK placeholders,
new SQL RBAC algorithm, general secrets manager and production private-network
exception. Reuse the existing permission resolver and pinned HTTPS egress.

## Data, tenant and transaction boundaries

Verified request identity supplies organization and actor. Every service-role
lookup is organization-first and filters connector/run/secret identity. Jobs
retain their initiating actor and approver; they never borrow another member's
authority. Revalidate current permissions/product ownership before effects;
atomic SQL compares/locks the permission epoch and active identity.

Extend `connectors`, `connector_secrets` and `sync_runs`; add `connector_commands`
for idempotency, deadlines, fences and redacted results. Credential/configuration
state, command completion and audit share one transaction. Connection revision
changes invalidate previous tests/plans; encryption-only rewrap does not.
Disconnect/revoke stop future work. In-flight reads may finish but stale plans
cannot commit or advance cursors. Commits preceding disconnect remain committed.

AES-256-GCM authenticates organization, connector, secret identity, revision and
format. External keyring supplies 32-byte active/recovery keys. HMAC fingerprints
use purpose-separated material and retain digest-key identity for replay.
Ciphertext and ledger material remain excluded from tenant exports.

## API and frontend boundaries

Feature-first contracts own consumed bodies/queries/parameters and JSON success
responses; trusted types use `z.output`. Nest pipes/`@ZodResponse` and gateway
`inputSchema`/`schema` parse both directions. Legacy success shapes remain exact.
Provider failures map to fixed safe categories, never arbitrary payload text.
Tests are bounded, read-only adapter calls with durable reserve/finalize CAS.

Functional React renders catalogue/operational tables and forms. The existing
plain TypeScript gateway owns transport. Query keys and drafts are tenant scoped;
non-secret drafts survive refetch/conflict, credential input never persists,
and completed mutation variables are removed. Preserve keyboard focus, semantic
tokens, non-colour status, reduced motion and locale dates.

## Failures, tests and observability

Write failing tests before implementation. Cover tenant substitution, revoked
permissions, concurrent/duplicate commands, interrupted/out-of-order tests,
wrong/missing/recovery keys, tampered envelopes, secret canaries, scope changes,
unsafe URLs/redirects/DNS rebinding and provider outages. Unavailable scope
introspection means unknown; missing requirements block, excess warns.
Logs contain only safe categories/correlation identifiers. Core workflows remain
available during connector/vault outages.

Completion requires at least 80% branches/functions/lines/statements for changed
modules, focused and full `pnpm verify`, live SQL/API/auth regressions, measured
bounded read latency, accessibility/browser journeys and Supabase cross-checks.
Use Playwright MCP on the development server with seeded owner and scoped test
fixtures, retaining unrelated site/database/mail data. Make the auth shell test
recipient-scoped before running it; its baseline global Mailpit purge is unsafe.

## Deploy, recovery and rollback

CLI-generated additive schema comes first, generated types second, compatible
API/worker bridge third, UI fourth. New credentials use GCM. Migrate legacy PGP
through bounded maintenance tooling using GPG passphrase file descriptors, no
secret arguments/files/logs, compare-and-swap and verified recovery. Retire the
legacy plaintext RPC only after every active configuration is converted.
Retain old keys until references and recovery windows permit retirement.
Rollback after GCM activation targets the compatible bridge, never the pre-GCM
binary. No reset, deletion of user data or destructive rollback is allowed.

## Baseline residual risks

The reporting-obligations eight-argument RPC has a separately confirmed browser
EXECUTE grant exposure. It is outside this change and remains tracked separately.
M11 verification is not a claim that the whole repository is free of defects.
