# M15-05 backup and recovery operations

## Authority and safety boundary

This workflow captures a whole deployment. Tenant ownership grants access to scoped assurance metadata only; it never grants execution, ciphertext, keys or deployment inventories. The private mTLS listener requires a fresh mounted instance grant for each action: `backups.view`, `backups.configure`, `backups.run`, `backups.verify` or `backups.cleanup`. Existing metadata grants default to no backup actions. Unsafe requests require JSON and an exact matching HTTPS Origin. The registry reader remains read-only; `cra_backup_control` can execute the feature control RPC but cannot read its tables directly. Physical source credentials belong to the separate executor.

The product has no production restore, cutover, archive download or arbitrary timestamp endpoint. A capture certificate refers to an exact database/WAL/object checkpoint. A successful capture is not a verified restoration. Consult separate timestamps, integrity checks and overdue status before making a recovery claim.

## Deploy without resetting existing data

1. Preserve the current database, Storage volumes, external recovery keys and authenticated repository checkpoints. Inventory the deployed PostgreSQL, Storage and GPG versions, available space, pending migrations and mounted instance binding. Compare the existing migration ledger without repairing historical entries.
2. Review the additive migrations `20261014112426_m15_05_encrypted_backups.sql`, `20261014171300_m15_05_backup_validation_contract.sql` and `20261015052219_m15_05_capture_assurance_projection.sql` in `apps/infrastructure/supabase/migrations/`. The first two introduce exactly `backup_policies` and `backup_runs`, non-forced RLS and explicitly granted RPC access. The third keeps capture attempts separate from restore attempts and advances the source timestamp when a verification starts; it replaces only the assurance function and preserves its authority and response shape. Already registered migration files are immutable. Apply only the reviewed pending additive migrations with the repository Supabase CLI workflow. Do not use `db:reset`; stop deployment if unrelated ledger drift would require additional changes.
3. Regenerate both type copies with `pnpm --filter infrastructure run db:types`. Do not hand-edit `apps/infrastructure/supabase/types/database.types.ts` or `apps/api/src/supabase/database.types.ts`.
4. Build and deploy compatible contracts, API, private operator assets, customer web and the separate executor. Preserve the existing private listener TLS configuration, `/api/v1`, health response version 1 and authentication behavior. The current customer UI requests health version 2 explicitly.
5. Provision source, repository, staging and recovery-key aliases outside the browser. Start with `BACKUP_WORKER_ENABLED` absent or false, and `schedulingEnabled: false`. Review dedicated control credentials and execution permissions before enabling the separate process. The API and private listener do not start the physical executor implicitly.
6. Mount the approved configuration privately, set `BACKUP_WORKER_CONFIGURATION_PATH` to its absolute path, and set `LICENSING_INSTANCE_ID` to the same instance UUID. Enable only the dedicated executor with `BACKUP_WORKER_ENABLED=true`; its built entry point is `apps/api/dist/backup-worker.js`.
7. In the private console, select the instance, edit aliases and validate. Initial validation can report **Runtime validation pending**: the request records the proposed nonsecret configuration; the executor performs native preflight, and an explicit **Retry validation** obtains fresh proof. Pending validation is not approval and starts no capture. Approve only a valid result matching the current configuration/version.
8. Request an on-demand capture and independently inspect its automatic first clean-target verification. Verify escrow recovery and a complete application drill before approving scheduled protection. Leave scheduling disabled on the original development stack while historical committed object bytes remain missing.

The executor checks every second, with independent capture and verification lanes. Default policy intervals are 30-minute certified points, 24-hour physical bases, 30-day verification and 30-day retention. Reusable bases still require a valid authenticated chain. Source WAL retention must cover encrypted off-host publication; receiver-local acknowledgement does not establish recoverability.

### Mounted configuration example

The following is a nonsecret shape example matching `backupWorkerConfigurationSchema` in `apps/api/src/backups/infrastructure/backup-worker-runtime.ts`. Replace every example mount, UUID, credential reference, capacity and device identity with reviewed deployment values. `projectApiKey` below is a placeholder, not a working credential. Keep the real configuration and credential files private; do not commit them. Browser policy input contains aliases and bounded settings only.

```json
{
  "instanceId": "11111111-1111-4111-8111-111111111111",
  "databaseUrl": "http://127.0.0.1:54321",
  "projectApiKey": "REPLACE_FROM_PRIVATE_DEPLOYMENT_CONFIGURATION",
  "controlSourceAlias": "local-source",
  "controlCredentialPath": "/run/cra-backup/control.jwt",
  "runtime": {
    "sources": {
      "local-source": {
        "databaseContainer": "approved_source_db",
        "databaseName": "postgres",
        "databaseUser": "postgres",
        "network": "approved_source_network",
        "host": "approved_source_db",
        "port": 5432,
        "postgresImage": "public.ecr.aws/supabase/postgres:17.6.1.156",
        "pgpassFile": "/run/cra-backup/source.pgpass",
        "storageContainer": "approved_source_storage",
        "storageRoot": "/mnt",
        "storageTenantPrefix": "stub/stub",
        "externalRecoveryKeys": {
          "pgsodium": {
            "containerPath": "/etc/postgresql-custom/pgsodium_root.key"
          }
        }
      }
    },
    "repositories": {
      "off-host": {
        "path": "/srv/cra-backup-repository",
        "generation": "22222222-2222-4222-8222-222222222222",
        "residency": "local",
        "offHost": true
      }
    },
    "staging": {
      "private-encrypted": {
        "kind": "encrypted",
        "path": "/srv/cra-backup-staging",
        "maximumBytes": 17179869184,
        "attestedMount": true,
        "mountDevice": 123
      }
    },
    "keys": {
      "backup-key-v1": {
        "path": "/run/cra-backup/backup-key-v1",
        "keyId": "backup-key-v1"
      }
    },
    "gpgBinary": "/opt/homebrew/bin/gpg"
  },
  "applicationProbeRuntime": {
    "runtimeRoot": "/srv/cra-recovery-probe-runtime",
    "authImage": "public.ecr.aws/supabase/gotrue:v2.197.0",
    "restImage": "public.ecr.aws/supabase/postgrest:v16.3",
    "storageImage": "public.ecr.aws/supabase/storage-api:v1.77.0",
    "storageTenantPrefix": "stub/stub"
  },
  "targetProfiles": {
    "isolated-saas": {
      "image": "public.ecr.aws/supabase/postgres:17.6.1.156",
      "stagingAlias": "private-encrypted",
      "maxExpandedBytes": 17179869184,
      "maxEntries": 1000000,
      "deadlineMs": 14400000,
      "objectVolumeBacking": {
        "encryptedAtRest": true,
        "daemonId": "<exact docker info --format '{{.ID}}' value>",
        "maximumBytes": 17179869184
      },
      "externalRecoveryKeys": {
        "pgsodium": {
          "path": "/run/cra-recovery/vault-root",
          "targetPath": "/etc/postgresql-custom/pgsodium_root.key"
        }
      }
    }
  }
}
```

Executor lifecycle control uses a dedicated native PostgreSQL session with `SET LOCAL ROLE cra_backup_control` and explicit session deadlines, independent of the shared PostgREST connection pool. `controlSourceAlias` selects the mounted source; it may be omitted only when exactly one source exists. Pending and approved policies must select that same source. The API/private listener retain the narrow HTTP control credential and never receive source/Docker credentials. This separation prevents audit-blocked metadata readers during a certified write pause from starving executor heartbeats.

The source example uses the current native-tool administrator; production must review its dedicated executor-only privileges and Docker access separately from RPC credentials. Restrict key/pgpass files to owner access and directories to mode 0700. Symlinks, ordinary persistent plaintext staging, staging inside source mounts and keys inside the ciphertext repository are rejected. Capture supports bounded tmpfs; the implemented restoration profile requires an attested encrypted staging mount. Restored Storage bytes use a fresh, labelled Linux-native Docker volume containing the entire authenticated object inventory. The target profile must explicitly attest encrypted-at-rest backing for the exact daemon ID, and bound its bytes. Provision and independently verify that encryption before enabling the profile; this field alone does not establish encryption. All objects are copied and hash-checked before application probes, and target-only volume cleanup uses the same ownership and terminal-authority checks as target containers. macOS bind mounts that lack the extended attributes required by the installed Storage provider are not a supported substitute. Attestation fields do not create encryption or an off-host mount: the deployment operator must actually provision and independently verify those properties. A directory on the same Mac with `offHost: true` proves neither host-loss durability nor physical residency.

### Grant extension example

Add `backupScopes` to the existing mounted grant entry, retaining its real fingerprint, principal, instance list and tenant scope. Increment the grant document revision and grant only the required actions. A corresponding instance must already be in `instanceIds`.

```json
{
  "backupScopes": [
    {
      "instanceId": "11111111-1111-4111-8111-111111111111",
      "actions": [
        "backups.view",
        "backups.configure",
        "backups.run",
        "backups.verify"
      ]
    }
  ]
}
```

This is an entry fragment, not a complete grant document. `backups.cleanup` requires a separate deliberate grant. A browser draft or earlier metadata observation never substitutes for fresh mounted authority.

## Original development recovery follow-up, 15 October 2026

The separately authorized Storage investigation recovered 98 exact historical object versions while preserving all existing rows/files. Five originals remain missing. Native preflight also correctly rejects the current original profile: the complete cluster is approximately 16.6 GiB across its retained databases, exceeding the 8 GiB encrypted staging limit and the available repository margin. Do not omit benchmark/internal databases, delete data or increase an attestation without provisioning actual capacity. The proposed policy remains unapproved with scheduling disabled; no original capture or restore started. See [recovery evidence and unresolved hashes](evidence/m15-05/original-storage-recovery.md) before attempting deployment.

## Keys, escrow and rotation

GPG AES-256 OCB protects database, WAL, objects and manifests. Dedicated mounted secret material is passed through file descriptors. External dependencies such as the Supabase Vault root key remain separate from ciphertext; the repository contains authenticated recovery canaries, not those external keys.

Maintain an offline escrow package under separately controlled custody containing each historical backup key, required external recovery key, nonsecret key identifiers, repository-generation binding, recovery instructions and access approvals. Keep encrypted repository authority/checkpoints independently retained. Record escrow custody and restoration checks without recording key bytes, passphrases, environment dumps or raw tool output in tickets, audit metadata or screenshots.

To rotate: provision a new private key file and alias/identifier, retain all old aliases needed by existing certificates, validate the new configuration, approve its new revision with scheduling disabled, capture and verify a new chain, and test the historical decrypt-only recovery checks. Retire an old key only after all dependent captures/WAL/manifests are safely retired under reviewed retention authority and recovery checks pass. Overwriting an existing key alias or deleting the last working historical key is not rotation. A missing key produces unavailable/failed assurance; it does not justify bypassing encryption.

## Capture failures and write pauses

### Continuous WAL journal windows

The encrypted current WAL journal holds at most 4,096 descriptors. Before it fills, the executor seals its complete immutable predecessor, then atomically publishes an authenticated version 2 journal retaining the last 2,048 descriptors and a predecessor reference. Historical ciphertext and certificate-owned part references remain intact; rollover never deletes WAL. Both the historical window and replacement current pointer must be durable before the source retention slot advances. A crash before pointer publication retains the prior authority and permits a safe retry.

Existing version 1 journals remain readable. Restart authenticates the current window and its immediate predecessor, verifies source/generation/timeline binding and overlapping descriptors, and keeps memory bounded without loading the complete history. A corrupt or unavailable required predecessor blocks archival. When a prior certificate falls outside the current contiguous window, capture prepares a fresh physical base rather than reusing an incomplete chain. Certified restoration continues to use the exact immutable parts listed by its certificate.

Before a cut, the executor prepares the physical base outside the pause. The cut announces write admission maintenance, drains conflicting work and fences relevant mutable database schemas including Auth and Storage. The pause is capped at 120 seconds with a shared deadline, independent cancellation and PostgreSQL transaction deadlines. Expiry is terminal for that cut; it cannot continue copying and later publish a certificate. Interrupted attempts must reacquire consistency rather than mix inventories.

Treat `object_missing` or `object_corrupt` as an incomplete recoverability incident. Recover the original committed bytes from an independently trusted source or correct the source through its normal evidence/lifecycle process; do not remove metadata to obtain a green backup. The original development database has previously missing object bytes, so it cannot currently establish a complete certificate merely because a disposable source succeeds.

Safe public failure groups are defined by `backupFailureCodeSchema`; raw native exceptions are never the UI diagnostic contract.

| Codes                                                                                            | Operator response                                                                                                                |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `authorization_changed`, `configuration_changed`, `configuration_invalid`                        | Refresh live grant/policy authority, preserve protected chains and validate a reviewed revision.                                 |
| `key_unavailable`, `historical_key_unavailable`, `ciphertext_invalid`                            | Check separate key custody and authenticated historical-key recovery. Preserve ciphertext; never substitute a plaintext export.  |
| `repository_full`, `repository_unavailable`, `repository_discontinuity`, `insufficient_capacity` | Restore capacity/connectivity and generation continuity; preserve the last recoverable chain and source WAL.                     |
| `wal_gap`, `wal_receiver_failed`, `source_identity_changed`, `base_integrity_failed`             | Stop certification; establish a complete compatible base/WAL chain after investigation.                                          |
| `object_missing`, `object_corrupt`, `partial_publication`                                        | Preserve receipts/parts and repair source recoverability through authorized source ownership.                                    |
| `fence_expired`, `write_drain_timeout`, `cancelled`, `lease_lost`, `interrupted`                 | Confirm write admission has resumed. The failed cut is not recoverable authority; retry only through a newly consistent attempt. |
| `target_unsafe`, `egress_not_blocked`, `manifest_invalid`, `archive_unsafe`                      | Refuse the target/import; inspect configuration and isolation without exposing the restored environment.                         |
| `schema_mismatch`, `audit_discontinuity`, `credentials_not_quarantined`, `probe_failed`          | Keep the drill failed/incomplete and isolated. A successful PostgreSQL command cannot override these checks.                     |
| `retention_authority_unavailable`, `cleanup_failed`, `audit_unavailable`                         | Preserve backup material and reconcile durable authority before another reviewed action.                                         |

## Retention, holds and reviewed cleanup

Policy retention is at least 30 days and cannot weaken stronger covered-tenant retention or legal holds. Declared residency must match the approved mounted repository. A sealed capture is deleted only after an explicit cleanup review/fingerprint, fresh optimistic version, tenant protection rechecks and durable audited intent. Unknown protection authority blocks deletion. Shared base/object dependencies and continuously archived WAL must remain recoverable. At least two independent verified base chains must survive once available; never delete the sole recoverable chain or latest authenticated authority checkpoint.

The cleanup adapter stages reversible feature-owned renames while SQL protection locks remain held, commits audited authority, then removes eligible bytes. Restart reconciliation rolls back when the durable decision is unknown. Automatic reconciliation is restricted to abandoned task-owned partial work and exclusively labelled recovery resources; it is not a general export/evidence cleanup mechanism. Keep consent/audit/certificate tombstones. Do not manually remove repository directories or edit database cleanup state.

## Clean verification and separate production restoration

The product drill accepts a certified capture and approved target profile, creates new generated targets, denies egress before PostgreSQL starts and verifies historical integrity before credential quarantine. It then advances session epochs, rotates restored dataset markers and runs target-only Auth/tenant/product/private-evidence probes. Ordinary source credentials, notifications, submissions, schedulers and workers must not run in the restored target. Never expose a drill as production.

Production restoration remains a separate authorized procedure and is not executed by this feature or its UI tests. Before any production cutover, require a recorded operator approval that names the exact certificate, source identity, repository generation, intended target identity/endpoints/networks/volumes, key custodians, incident window and maintenance/cutover decision. Independently confirm the target is the authorized destination and cannot overwrite source or unrelated storage. Verify escrow, authenticated external checkpoints, capacity and the complete drill results first.

Keep the recovered deployment isolated. Reconcile current revocations and session epochs, deletion tombstones and erasure obligations, legal holds/retention, licence/operator/connector/agent trust, audit dataset markers and queued deliveries against independently retained current authority. Historical state must not resurrect revoked identities, deleted data or expired trust. Explicitly disposition pending notifications, submissions and retries before allowing egress. Authorize exposure/cutover separately, record validation and rollback criteria, and retain the original recoverable source/chain until its protected lifecycle permits retirement. No generic restore command here supplies that authorization.

## Rollback

Disable scheduled protection through the reviewed policy path where available. Stop only the feature executor and disable the new private actions/entry points; retain the customer projection as unavailable when authority cannot be read. Preserve policies, run receipts, durable audits, authenticated repository journals, ciphertext, source WAL required by a recoverable chain and every historical recovery key. Do not drop tables, undo unrelated migrations, reset a database, delete volumes, downgrade the repaired Storage container or remove held evidence. Review any active pause/lease before stopping processes and confirm write admission resumes within its independent deadline.

## Verification commands and evidence

Run from the repository root with pnpm. Native fault/concurrency/load tests require the explicit disposable fixture documented by the test; never aim fixture creation or destructive cases at the original deployment. The SQL files use scoped tests, not a reset.

```sh
pnpm --filter @repo/contracts run test -- backups
pnpm --filter api run test -- backups
pnpm --filter operator run test:coverage
pnpm --filter operator run build
pnpm --filter infrastructure run db:lint
pnpm verify
node apps/api/test/m15-05-shared-deadline.e2e.mjs
```

The shared-deadline capability test is read-only and uses its own sessions; its default source is the local PostgreSQL container. Other live SQL/concurrency/metadata-load tests and the measured recovery workload must record their selected fixture, exact commands and results in [verification evidence](evidence/m15-05/verification.md). Published tests and commands are not proof that every final gate ran. Do not claim SaaS RPO/RTO, native browser compatibility or physical off-host resilience beyond the measured profile and actual evidence.
