# Connector vault deployment and recovery

M11 uses an externally injected keyring and ciphertext-only Supabase operations.
Only the reference conformance adapter is implemented. A successful fixture test
does not establish a vendor connection, compliance or production agent routing.

## Provisioning

Provision independent random 256-bit keys in the deployment's secret manager.
Inject `CONNECTOR_VAULT_KEYRING` into both API and connector worker processes as
JSON with `activeKeyId` and `keys`, mapping retained key identities to canonical
base64 encodings of exactly 32 bytes. Key identities use 1–80 letters, digits,
dots, underscores or hyphens, starting with a letter or digit. The keyring is
bounded to 64 entries. Do not print keys, commit them, put them in browser
configuration, pass them as CLI arguments, or store them in Supabase.

Use a secret-manager-provided environment or workload injection mechanism.
Deploy matching recovery material to every API and worker instance before
changing the active identity. Missing or malformed configuration disables vault
operations without preventing core API startup. A wrong key or modified
envelope fails authentication with the same safe credential-unavailable error.

AES-256-GCM uses a fresh 12-byte nonce and 16-byte authentication tag. Associated
data binds format, key identity, organization, connector, secret identity and
credential revision. Credential replacement creates a new secret identity and
revision; key rewrapping preserves those values and the connection revision.
Neither credentials nor envelope bytes are public API response fields.

## Additive deployment and legacy recovery

The interrupted local stack has a separate recovery audit recorded in
[M11 verification](m11-01-verification.md). Do not promote its broader
`20260929065551_m11_01_repair_service_only_grants.sql` or run an indiscriminate
migration push before reviewing that change: it affects unrelated feature grants
and was applied outside its delegated read-only scope. The auth triggers and
named grant failures have since been repaired through seven scoped recovery
migrations, with passing live SQL/auth checks. The reconstructed migration
ledger still needs reconciliation before promoting the recovery history.

1. Apply the reviewed additive M11 migrations without resetting user data.
2. Deploy the compatible API/worker bridge with the new keyring, the retained
   legacy `CONNECTOR_SECRET_ENCRYPTION_KEY`, and a trusted GPG executable via
   `CONNECTOR_VAULT_GPG_BINARY` when it is outside `PATH`.
3. Verify synthetic PGP recovery before touching active configurations. Local
   verification used Supabase `pgp_sym_encrypt` and GnuPG 2.5.21/libgcrypt 1.12.2;
   the recovered synthetic value matched. Qualify the executable/version used
   in each deployment, including its support for the required flags.
4. Run the dry-run command for each organization, review missing key identities,
   incomplete reference inventory, failed recovery and concurrent conflicts.
5. Execute the scoped backfill only after recovery verification; rerun the dry
   run and test every active configuration. Never retire the legacy passphrase
   while any configured PGP envelope or retained backup still requires it.
6. The explicit database contract step
   `m11_retire_legacy_connector_secret_rpc()` refuses retirement while a
   configured legacy envelope exists. After verified backfill, authorized
   operators may invoke it to remove service-role execution of the old
   plaintext credential RPCs. It does not decrypt or reset data.

The runtime bridge and maintenance reader send ciphertext through GPG stdin and
the passphrase through fd 3. They ignore stderr, require successful exit plus
`GOODMDC` and `DECRYPTION_OKAY`, reject integrity errors, bound plaintext output
to 80 KB, and default to a ten-second timeout. `--no-keyring`, `--no-autostart`,
`--no-random-seed-file`, and `--no-symkey-cache` avoid the user's keyring, agent
and credential cache. No plaintext or passphrase file is created. Passphrases
containing CR/LF cannot use GPG's line-based fd protocol and fail safely; resolve
such exceptional legacy recovery before cutover. JavaScript secret strings
remain transient process memory and cannot be guaranteed zeroized; available
plaintext buffers are cleared after use.

## Maintenance commands

Build the API and use its maintenance script from the repository root. Supply
Supabase URL/service-role credentials and key material through secure deployment
injection; do not include their values in shell history.

```sh
pnpm --filter api run build
pnpm --filter api run vault:connectors -- --org ORGANIZATION_UUID
pnpm --filter api run vault:connectors -- --org ORGANIZATION_UUID --batch-size 50 --execute
```

The default is dry run. Batches use secret UUID keyset pagination, at most 100
rows, and explicit organization scope. Compare-and-swap matches organization,
connector, secret identity, previous key identity and ciphertext. Concurrent
credential replacement or rotation produces a conflict; rerun after reviewing
the current configuration. Successful rewrap and its redacted audit fact share
one database transaction. A process interruption leaves completed rows valid
and untouched rows recoverable; restart the scoped command.

Reports contain counts and key identities only. `keyReferences` counts active
ciphertext before that run; it is not permission to retire a key.
`retainedKeyReferences` separately inventories configured envelopes and durable
command fingerprints. Execution refuses missing retained key material or an
incomplete bounded key inventory. A dry run reports missing key identities.
Failures and conflicts produce a nonzero exit code.

## Rotation and key retention

Keep the old key in the keyring while adding and activating its replacement.
Perform bounded rewrapping, resolve conflicts, and verify recovery across every
organization and runtime instance. Do not remove an old key merely because the
selected organization's ciphertext count reaches zero.

Durable command fingerprints use a purpose-separated HKDF/HMAC key and store
the derivation key identity. Matching idempotency retries use that retained key
even after encryption rotates. Every retained command reference therefore
requires its key. There is no automatic ledger deletion or retention expiry in
M11: retain these keys indefinitely until an explicit feature-owned replay and
retention policy is introduced. Database backups and disaster-recovery copies
also require their historical keys. The 64-key runtime bound is an operational
limit; approaching it requires a reviewed retention decision, not silent key
removal. A server cannot prove that an externally deleted or mislabeled key is
recoverable; secret-manager permissions and tested restoration remain essential.

## Disconnect, authorization and failures

Disconnect or credential revoke changes the connection revision and prevents
future claims. An in-flight provider read may finish, but stale work cannot save
a plan, commit products or advance its cursor. A transaction that committed
before disconnect stays committed. Reconnect does not revive old plans.
Credential/configuration changes require a fresh connection test and sync plan.

Workers use the recorded initiating actor and commit approver, never a
substituted owner/admin. They revalidate current permissions, organization
permission epoch, connection/credential revisions and product action
permissions. SQL fences atomic state changes. Product actions are aggregated
from the scoped durable plan, so larger historical plans do not require loading
all their rows into worker memory. Revoked access or changed fences invalidates
old work; an authorized user must initiate a fresh operation.

Provider reads receive an abort signal and a fifteen-second promise deadline.
A noncooperative adapter may complete its read after timeout, but its late
result has no persistence path. Future network adapters must honor cancellation
and use the existing pinned HTTPS egress boundary: exact deployment-approved
hosts, public DNS resolution, pinned addresses, checked redirects and bounded
responses. Private targets require a separately approved production agent
route. M11 does not enable the loopback HMAC agent verifier as production ingress.

## Rollback and verification

Before GCM activation, preserve the additive schema and the compatible bridge.
After GCM writes/backfill, roll back only to a bridge release that understands
GCM and retains all required keys. The pre-GCM binary cannot safely read new
envelopes. Do not restore an obsolete database or reset local data to resolve
deployment issues. A guarded RPC retirement is reversible only through a
reviewed privilege change; never reopen plaintext RPCs as an automatic fallback.

Verify tampering, organization substitution, wrong/missing/recovery keys,
rotation interruption, ciphertext CAS conflicts, retained fingerprint replay,
permission revocation and late provider results. Unit coverage and local
synthetic PGP verification complement real transaction and browser suites;
neither establishes zero defects or future vendor compatibility. Preserve
unrelated tenant, site, browser and mail data during verification.
