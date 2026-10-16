# M15-06 installation, qualification and recovery runbook

Execution ships disabled. This change does not qualify any production upgrade
path. Use a separately provisioned Linux reference host and authentic N/N−1/N−2
artifacts before enabling a path. Never use the original development deployment
as the qualification or restore target.

## Deployment and authority

The reviewed deployment is `deployment/compose.yml`; classify every executable in
`deployment/service-inventory.json`. API, agent ingress and application workers
share the signed API image; web uses the signed web image. The independent
supervisor, operator ingress/assets, edge and Supabase infrastructure stay pinned.
A separately installed remote agent remains a compatible fixed client. Unknown
writers, direct customer access to Auth/REST/Storage, absent positive drain ACKs
or unclassified entry points block preflight.

Provision the fixed Compose project/network, exact local image IDs, runtime env
files, private mTLS ingress and certificate grants before execution. Application
containers receive no Docker socket, migration credential or journal key. The
backup-control lane requires its existing separately reviewed authority. Do not
mount the inbox or journal into ordinary applications.

Host service entry: `apps/api/src/upgrade-supervisor.ts` (compiled via the API
build), `pnpm --filter api run upgrade:supervisor`. It returns disabled unless
`UPGRADE_SUPERVISOR_ENABLED=true`; enabled execution requires Linux and a private
`UPGRADE_SUPERVISOR_CONFIG_PATH` mount. The authoritative configuration schemas are
`upgradeSupervisorMountSchema`, `upgradeSupervisorCompositionSchema`,
`nativeUpgradeInspectionConfigSchema`, `upgradeBackupRuntimeConfigurationSchema`
and `upgradeAuditRuntimeConfigurationSchema`. Keep credential values in reviewed
private files, never command arguments or version control.

Provide separate private roots for journal, staging, maintenance control, image
selection and backup repository. Journal/staging must be non-symlink directories
with owner-only permissions, disjoint from media, source data/object volumes and
recovery targets. Provision stable HMAC keys and retained minimum journal/trust
versions. Back up independent authority checkpoints separately. Authentication
of local journal records cannot detect coordinated rollback of the entire host
and its authority storage; this is not hardware-backed rollback protection.

The operator mounts `UPGRADE_CONTROL_SOCKET_PATH`, `UPGRADE_CONTROL_KEY_PATH` and
the matching `LICENSING_INSTANCE_ID`. Its Unix IPC is authenticated, bounded and
instance-bound. Mounted mTLS grants default to no upgrade permissions; authorize
`upgrades.view`, `upgrades.stage`, `upgrades.apply` and `upgrades.rollback`
individually. Tenant owners and backup grants confer no upgrade authority.

## Signed release production

Follow `deployment/README.md` for fixed image construction and
`tools/upgrades/package-release.mjs` for bounded local-media packaging. Release
trust is a versioned mounted Ed25519 issuer/keyring, separate from licence/feed
trust. Only the approved inbox supplies candidate media; a bundle cannot install
its own root, Compose file, hook, shell command, path or mount.

The strict manifest binds source version/manifest/schema tuples, target schema,
fixed infrastructure/supervisor identities, platform, image config IDs, every
migration checksum, archive bytes/expansion limits, required SBOM/artifacts,
licence effects, outage estimate and tested image-only compatibility. The
signature purpose is `CRA-RELEASE+JWS`. Stage copies are private and immutable;
current trust and staged content are revalidated before execution.

Installed and qualification receipts independently bind the exact observed
source API/web IDs and platform. Qualification also binds the target full ledger
(version/name/statements digest), target schema, previous-image compatibility
and pinned CLI atomic-ledger behavior. Never create receipts from assumptions,
unit tests or manually asserted pass flags. No authentic receipt means blocked.

## Qualification order

1. Provision a dedicated Linux runner with the protected self-hosted workflow
   labels/environment described in `deployment/README.md`. Supply actual signed
   source/target artifacts for N, N−1 and N−2, isolated seed/config templates,
   fixed infrastructure images and private test authority. No cloud Supabase or
   remote Docker endpoint is allowed.
2. Run `tools/upgrades/qualify-release.mjs` with the reviewed request and a new
   result path. The repository-owned native fixture creates unique task projects,
   internal networks and private roots; it never adopts source volumes. Images
   must already be local; Compose uses `--pull never --no-build`.
3. Inspect native forward/rollback/restart, drain refusal, lost acknowledgement,
   egress-denied and owner-auth/navigation evidence for each source generation.
   Prove candidate bootstrap writes and committed additive schema remain readable
   by the recorded previous images. Prove migration SQL and history bookkeeping
   commit atomically, including commit-before-acknowledgement interruption.
4. Record actual monotonic durations against the 30-minute target and metadata
   p95/p99. A failed/missing scenario does not produce a qualified path. Retain
   journals and fixtures for independent review; cleanup is a separate scoped
   operator action.

The native fixture requires externally provisioned authentic artifacts and an
isolated installation template. Repository fixture/unit tests do not establish
native recovery, resource sufficiency, zero egress or the 30-minute target.

## Operator execution

Select the authorized instance, choose mounted media and verify/stage it. Run
preflight and review every check, remediation, outage/effect and rollback
boundary. Preflight verifies actual source/target/runtime/platform, resources,
exact schema/history, licence implications, verified backup/key availability,
authenticated repository hold, complete writer inventory and current authority.
The reviewed fingerprint expires and is rechecked immediately before execution.
A changed instance/principal/grant/media/version/fingerprint invalidates approval.

Acknowledge the effects and explicitly initiate once. Commands use durable
idempotency identity and optimistic versions; a transport failure does not imply
failure or authorize a new mutation. Refresh status, inspect the retained run and
use the permitted reconciliation action. Do not automatically replay a POST.
The private status/control plane stays available during customer maintenance.

The supervisor journals intent before effects and observed results afterward.
It closes customer and agent admission (including direct backing-service paths),
stops claims and requires fresh generation/process-specific positive drain ACKs.
Uncertain provider work, disconnected requests or an unresponsive writer block
advancement; leases, signals and process exit do not prove drain. Source-owned
notification/submission/webhook identities and queues remain intact.

After quiescence, revalidate the selected backup and capture/verify a new
consistent checkpoint using the existing M15-05 lane. Its short capture fence is
not extended across migrations and its disposable restore target is never
promoted. Authenticated repository holds protect ciphertext and historical keys
under publication/cleanup locking.

Only signed pending forward-compatible migrations are eligible. The exact
canonical local migration inventory and explicit password-free target URL must
match the pinned CLI environment. The conservative SQL admission rejects
unsupported transaction constructs, including PL/pgSQL bodies containing BEGIN;
provide a separately reviewed supported release instead of bypassing admission.
No down migration, history repair, broad include-all or destructive restore is
part of this workflow.

Before invoking the pinned CLI, validate the complete historical and signed
pending SQL inventory. Publish only missing signed files through private fsynced
temporary files and no-overwrite hard links, then recheck the final inventory.
Restart accepts matching published bytes; conflicting or unexpected files block.
The signed bootstrap identity anchors authenticated terminal journal transitions.
Successful runs advance the installed images/version and schema/history; compatible
rollback retains the previous images/version with committed expanded schema/history.
These facts and committed migration hashes become the next upgrade's baseline.
Actual Docker images, database schema and ledger must still match that baseline.
An incomplete or inconsistent transition cannot establish an installed identity.

Candidates start behind maintenance with workers disabled. Readiness checks
actual selected images, build identity, application/database/audit/licence
semantics and signed target schema/history. Exposure intent is durable before
workers start or ingress opens. Post-activation checks require completed healthy
worker cycles for the exact new image and generation; boot liveness alone fails.
Critical operational facts are projected idempotently into the existing durable
M13 RPC; an audit outage retains the host facts and prevents unsafe progress.
`AuditService.log` remains compatible for existing callers.

## Recovery and rollback boundary

Restart the independent supervisor against the same authority mounts. It
reconciles actual containers, authenticated journal and migration identities;
it never blindly reruns SQL or rewrites historical migration records. Preserve
all roots and staged artifacts until reconciliation is reviewed.

Before exposure, automatic rollback may switch only to the operation's exact
qualified previous images. All committed migrations, customer data, audit,
objects, licence authority and queue state remain. Verify previous-image
semantics against the signed target schema/ledger. A completed rollback retains
maintenance for review; do not interpret `rolled-back` as customer ingress open.

After exposure, uncertain migration state, incompatible previous images or failed
rollback, retain maintenance and export the redacted result. Rollback is
prohibited when effects may have occurred. Emergency ingress closure uses the
already durable execution authority even if the initiating grant is revoked;
reports claim maintenance only when positively observed. Investigate and qualify
an explicit forward recovery. Never restore a source snapshot, erase newer
writes, reverse migrations, reset queues or clear security/licence evidence.

There are no new application migrations, generated types, backfills, tables,
columns or foreign keys in this change. Rolling back this feature disables its
control configuration while retaining journal/evidence/holds and the last
maintenance decision. Do not delete authority mounts or unpin backup material as
a code rollback step.

## Evidence and commands

Contracts: `packages/contracts/src/upgrades/{schemas,types}/index.ts`. Private
HTTP inputs and successful responses are parsed; web supplies `inputSchema` and
`schema`. Exported results are strict allowlists of versions/digests/timestamps,
checks, safe remediation and outcomes, with no secrets, tenant payloads, raw logs
or host paths.

Use focused Jest/Vitest/Node tests first, then `pnpm verify`. SQL tests need an
explicit disposable target for qualification; the repository default historically
addresses `supabase_db_cra`. Do not run a reset to make tests pass. Evidence and
remaining qualification limits are recorded in `m15-06-verification.md` and
`evidence/m15-06/`.

## Current admission and compatibility matrix

| Source generation | Forward images and additive SQL                               | Pre-exposure image rollback                                              | Production status    |
| ----------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------- |
| N                 | Requires real signed source/target and qualification receipts | Requires exact signed previous image set and target schema/history proof | Unqualified; blocked |
| N−1               | Same artifact and native scenario requirements                | Candidate-written records must remain readable                           | Unqualified; blocked |
| N−2               | Same artifact and native scenario requirements                | No database or queue rewind                                              | Unqualified; blocked |

Image admission supports one uncompressed Docker-save image per archive, including
its supported uncompressed OCI-compatible layout. It validates config/platform,
layer diff IDs and complete inventory before any Docker mutation. Compressed
archives/layers (even renamed `.tar`), sparse/special records and unsupported
extended headers fail closed. Normal links inside a container rootfs are parsed
without following or extracting them; host-media archive links remain forbidden.
Use an explicitly supported export format and rerun actual qualification when
admission rejects an artifact. Do not rename or strip validation to bypass it.

Read-only preflight and apply both enforce decoded byte/entry/deadline limits;
apply rechecks local Docker data-filesystem free bytes, inodes and reserve before
import. The supervisor must see the actual local daemon's `DockerRootDir`
filesystem; an inaccessible root or remote daemon blocks execution. A containerized
supervisor needs the reviewed read-only host filesystem visibility. Staging only
verifies private media; it does not import images. A current preflight approval,
execution lock and durable image-load intent precede import.

After import, an authenticated result binds the exact run, manifest and approved
fingerprint. Revalidation checks archive bytes, loaded image identities and the
remaining Docker filesystem bytes/inodes. It accounts for the verified import's
own allocation without reserving the full import space twice. Every remaining
resource threshold and all source, trust, schema, licence, backup and authority
checks must still pass; unrelated fact changes invalidate the approval.

The fixed control recipe requires `POSTGRES_TOOLS_IMAGE` to name the reviewed
PostgreSQL 17 Supabase image by digest. It copies its self-contained Nix tool
closure and verifies `psql`/`pg_dump` major 17. The base image's PostgreSQL 15 client
is not a supported fallback for this PostgreSQL 17 deployment. Control and native
tool images remain independent of the replaced API/web release.
