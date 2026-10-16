# Original development Storage recovery, 15 October 2026

Recovered **98 of 103 missing committed object versions**, totaling **388,032 bytes**. Every restored byte sequence matches its retained original SHA-256, Storage MD5 ETag and length. **Five originals remain missing.** No complete original-stack backup or restore is claimed.

[Machine-readable results and unresolved reference digests](original-storage-recovery-results.json) record the checks without publishing object paths, contents, credentials or keys.

## Investigation and provenance

The matching original stack is local `cra`, API `http://127.0.0.1:54321`, database `supabase_db_cra` and Storage API 1.77.0 using its existing Linux-native `supabase_storage_cra` volume. Initial inventory found 411 metadata rows, 308 physical files and 103 missing versions. All 308 present files matched recorded sizes and MD5 ETags. Missing entries were created between 15 and 23 September; present files begin in October. This establishes the historical gap, not the original cause of loss. The missing bytes were already absent from the retained pre-repair archive.

Read-only searches covered the original volume, two relevant retained task Storage volumes, the pre-repair Storage tar, 25,430 repository/relevant-worktree files and ten retained ZIP archives. No alternate original-volume copy matched the missing set. Unrelated cloud projects and unrelated Docker volumes were not read.

| Restored category         | Versions | Evidence used                                                                                                                                     |
| ------------------------- | -------: | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evidence CSVs             |        2 | Exact `docs/examples/product-release-import-v1.csv` bytes, matching original retained digest and Storage metadata                                 |
| Synthetic evidence PDFs   |        3 | `apps/api/scripts/m9-05/seed-local-fixture.mjs` generator, exact historical labels and original creation dates; retained evidence SHA-256 matches |
| SBOM originals            |       23 | `sbomBytes` in `apps/web/e2e/m9-06-supplier-sbom-portal.spec.ts`, retained source identifiers and declared/content-addressed SHA-256              |
| Declaration PDF           |        1 | Immutable declaration payload, `renderDeclarationPdf`, original timestamp and retained artifact SHA-256                                           |
| Snapshot export artifacts |       69 | 23 immutable M7 export records across three snapshots; canonical manifest, PDF and ZIP outputs match their retained individual SHA-256 hashes     |

Reproduction candidates were accepted only after exact original hashes matched. Pinning historical PDF creation metadata did not authorize accepting a merely equivalent document. Original data, metadata, immutable payloads and regulatory decisions were not rewritten.

Unresolved: one 123-byte evidence text file and four 1,574-byte declaration PDFs. No exact evidence text was found. Three declaration payloads remain, but the inspected renderers produce different bytes; one Storage reference lacks a matching retained declaration record. Repository history did not supply a matching alternate renderer. These five require authentic original bytes or another authoritative recovery source. Opaque reference digests, sizes, Storage MD5 and available source SHA-256 values are in the JSON report.

## Recovery and preservation checks

The task-private recovery plan binds every candidate to its exact existing object ID, bucket, key and version. A fresh full-row comparison confirmed all 411 Storage records were unchanged immediately before writing. The writer validates the whole candidate batch before publishing; directory file descriptors and `O_NOFOLLOW` reject symlinks and traversal. It creates a private exclusive temporary file, supplies the existing Storage content/cache metadata, fsyncs, then publishes with a hard link that cannot replace an existing target. Only its own temporary link is removed. Existing differing targets cause failure instead of replacement.

Twelve synthetic guard tests passed on a disposable, network-isolated tmpfs after an observed failing implementation. They cover exact creation/idempotence, conflicting existing bytes, directory/final symlinks, FIFO targets, absolute/traversal paths, incorrect SHA/ETag/length, duplicate targets and batch validation before any write. Independent review found no critical or high preservation issue; the FIFO nonblocking-read and directory durability improvements were included before recovery.

- **98/98** direct authenticated Storage downloads changed from HTTP 500 `InternalError` on the absent physical versions to **HTTP 200**, with exact SHA-256 and byte-length verification. The provider's missing-file response was 500, not an assumed 404.
- **411/411 metadata rows**, **14/14 bucket rows** and **308/308 pre-existing physical files** remain unchanged. No object row, bucket, existing file, migration or application module was deleted, replaced or reset.
- The final inventory is **411 metadata rows / 406 physical versions / five missing versions**.
- Anonymous reads of representatives from all four restored buckets were denied; all four buckets remain private. Recovery did not widen RLS, grants, expiry or download authorization.
- Candidate bytes, exact paths, local credentials and recovery keys remain in ignored private task storage. No support transmission or external upload occurred.

## Actual original-stack backup retest

A fresh private configuration binds the **original** instance and source, with separate repository generation/key and matching external Vault recovery key. The previous disposable-source configuration was not repointed or reused. Its proposed policy keeps scheduling disabled and grants no cleanup action.

Playwright MCP exercised configuration validation through the mTLS operator console. Native validation correctly returned **`insufficient_capacity`**. Whole-cluster inventory measures **17,838,982,528 bytes**, about **16.6 GiB**, including retained internal and benchmark databases. The existing encrypted staging profile permits **8 GiB**; repository free space is also below the native 1.2-times cluster-size threshold. No database was omitted or deleted to make the preflight pass. Future capacity planning must include the entire cluster, WAL, objects, encryption publication and isolated restoration headroom.

Approval and capture buttons remained disabled. An explicit authenticated run request could not bypass the unapproved policy and returned **404 `Backup scope unavailable`**. Live SQL confirmed:

- One **unapproved validation candidate**, with `schedulingEnabled: false` and safe `insufficient_capacity` failure.
- One durable `backup.validation_requested` and one `backup.validation_failed` receipt.
- **Zero capture/verification jobs, certificates, write fences or replication slots**; no write pause or restore started.
- The exact task worker was stopped cleanly. No stopped receiver or new WAL retention slot remains.

The seeded-owner customer workbench correctly shows **unavailable / not configured**, with no last successful capture or verified restore. Desktop and 390px mobile checks showed no horizontal overflow. At most **two browser pages** were open. A fresh normal seeded-owner sign-in after switching browser contexts restored the customer journey without clearing unrelated cookies or site data.

Screenshots: [operator desktop](original-recovery-preflight-desktop.png), [operator mobile](original-recovery-preflight-mobile.png), [customer desktop](original-recovery-customer-desktop.png), [customer mobile](original-recovery-customer-mobile.png).

Current Supabase MCP discovery exposes only unrelated cloud projects. Those were left untouched. Final checks used the exact matching local PostgreSQL and Storage APIs; the earlier matching local MCP inspection remains separately recorded. The post-recovery backup regression run passed **50 suites / 369 tests**. No application code changed, so the earlier full `pnpm verify` result is retained as prior evidence, not claimed as a newly rerun gate.

## Remaining recovery requirements

Supply authentic bytes for the five unresolved originals and provision adequate encrypted staging/repository/restore capacity, then validate a fresh original-bound configuration and execute a complete certified capture plus isolated restoration. Keep scheduling disabled until that drill succeeds. The earlier successful 1 GiB disposable-source drill does not certify this original cluster. No new original-stack RPO/RTO, independent off-host durability or recovery-success claim is made.
