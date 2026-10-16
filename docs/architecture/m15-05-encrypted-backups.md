# M15-05 encrypted backups and restoration assurance

## Scope and preserved contracts

Protect the whole deployment with customer-controlled encrypted captures and independently recorded clean-target verification. Tenant administrators see only scoped assurance. Execute only through freshly authorized, instance-bound private operator actions. Existing health schema version 1, metadata-only operator grants, authentication, cookies, permission merging, licensing protections and non-forced RLS remain compatible. Production cutover, arbitrary timestamps, archive downloads, source resets and unrelated cleanup are excluded.

## Concrete problem and why not simpler

The existing health projection deliberately reports backup authority as unknown. The M13 restore script validates only a subset of schemas in a disposable database; it does not protect Storage bytes or establish whole-deployment recovery. A database dump and a green shell exit cannot prove object integrity, external key recovery, isolation or audit continuity. Existing export/diagnostic jobs have tenant ownership and artifact semantics incompatible with whole-instance physical recovery.

## Selected and rejected patterns

Use a feature application facade, immutable policy functions, inward-owned repository/executor ports and native-tool adapters. These boundaries exist because private operator authorization, SQL transactions, off-host encrypted publication and isolated Docker recovery have different privileges and failure lifecycles. Persist capture/verification state transitions in exactly two tables. Keep the existing worker loop; no event bus, scheduling framework, global request state, provider hierarchy or new dependency. Delete an adapter boundary if its corresponding external execution boundary disappears.

## Data, authority and atomicity

Mounted runtime configuration establishes the local instance identity; replaceable operator observations do not. Fresh mTLS grants explicitly enumerate backup actions per instance; old grants confer none. Browser tenants cannot execute instance recovery. Operator control uses a narrowly granted RPC role; physical credentials stay in the executor. Every customer query starts with verified organization identity and returns no global inventory, mounts, keys, paths or raw process output.

`backup_policies` and `backup_runs` hold policy revisions, durable occurrence/idempotency keys, leases, optimistic versions, checkpoints and safe immutable results. Instance-bound composite references bind verification children to certified captures. Security audit append and mutations commit together. Different payloads under an existing key conflict; stale leases cannot publish. RLS is enabled, never forced; browser table access is denied; RPC search paths and grants are explicit.

## API and frontend boundaries

Feature-first schemas and `z.output` types live in `packages/contracts/src/backups/{schemas,types}`. Private routes are `/api/v1/operator/instances/:instanceId/backups`; tenant assurance routes are `/api/v1/system/backups`. All body/query/path input and successful responses are parsed. Focused gateways parse both directions; functional operator and System Health components render results. Health schema 2 is opt-in; schema 1 remains strict and unchanged.

## Capture, restoration and failure modes

Use PostgreSQL 17.6 physical base/WAL tools and mounted dedicated GPG AES-256 OCB keys. Plaintext staging requires private tmpfs or an explicitly provisioned encrypted mount. Repository manifests and journals are authenticated and external to the source database. No browser input can supply a path, command, URL or key. A certified point requires complete exact object versions, continuous WAL, audit heads and durable encrypted publication. Base preparation occurs outside the pause. Independent cancellation/watchdogs plus PostgreSQL transaction deadlines cap the write fence at 120 seconds; an expired cut cannot certify. Retain source WAL until encrypted durable acknowledgement.

Restoration exclusively provisions new target identities, directories, networks and volumes. Deny egress before PostgreSQL starts; disable ordinary workers and external delivery. Authenticate ciphertext before extraction, reject path/link/expansion attacks, verify schema/ACL/RLS/extensions/migrations/sequences, object hashes and independent audit heads. Only after historical integrity checks quarantine restored credentials, advance session epochs and rotate restored audit markers. The full object inventory is copied and hash-checked into a fresh Linux-native volume whose exact daemon has an explicit encrypted-backing attestation. This avoids unsupported Storage extended attributes on macOS bind mounts without weakening byte integrity. Target-only probes establish auth, tenant/product and private-artifact access. A command exit alone never means verified.

Fail closed on unknown runtime, missing keys/objects, insufficient space, broken WAL, source changes, audit failure, lease loss, cancellation or unsafe target reuse. Record bounded safe codes. Automatic cleanup touches only abandoned task-owned partials. Sealed deletion requires reviewed current protection authority, no holds, dependency preservation and multiple verified chains; unknown authority blocks it. Never delete the sole recoverable chain.

## Verification and observability

Characterize v1 health, old operator grants, durable audit and tenancy first. Observe RED then GREEN for strict contracts, action scope, policy/lifecycle, adapters and UI. Publish failure canaries and SQL/RLS/transaction tests, measure all four coverage dimensions at least 80%, run architecture gates, focused suites and `pnpm verify`. Use Playwright MCP and Supabase cross-checks without clearing other origins. Measure 10,000-run reads and a complete isolated workload of at least 1 GiB database plus 1 GiB objects. Report actual RPO/RTO only for that measured profile; original missing object bytes prevent a complete certificate until independently recovered.

## Rollout and rollback

CLI-created additive migrations precede generated type copies and compatible contracts/API/private UI/customer UI/executor deployment. Scheduling remains disabled until mounts, keys, escrow and first drill validate. Rollback disables new controls and executors while retaining policies, receipts, encrypted parts and historical keys. Production restore has a separate explicit-target authorization runbook. No historical migration-ledger repair or reset is part of this change.

## Review checklist

- Direct alternatives, concrete boundary triggers and compatibility constraints recorded above.
- Input/output parsing, inward dependency direction, functional rendering and fresh authorization required for every route.
- Security-critical effects are transactional; runtime failures cannot fabricate recovery authority.
- Coverage, real-stack, browser, load and recovery evidence must be recorded before completion claims.
