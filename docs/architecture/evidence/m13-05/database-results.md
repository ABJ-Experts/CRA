# M13-05 database verification

Confirmed local CRA PostgreSQL 17.6, development endpoint `http://127.0.0.1:54321`. Added exactly three private workflow tables, with non-forced RLS, explicit RPC grants, pinned paths, immutable delivery payloads and attempts. Existing audit canonical bytes and writers remain unchanged. New migration ledger entries were recorded individually; historical entries were not repaired or replayed.

`pnpm --filter infrastructure run test` passed the complete SQL suite. The legacy audit truncate-denial fixture explicitly includes new referencing SIEM tables so PostgreSQL reaches the immutable guards; no truncate succeeds, no CASCADE is used, and fixtures roll back. Independently owned SIEM fixtures use savepoints to release tenant advisory locks before the next randomly generated tenant.

`m13-05-siem.test.sql` covers private grants/RLS/paths, dependency parity, immutable source event identity, legacy NULL entity compatibility, idempotency/conflicts and key-ID lookup, revoked cached mutation authority, future-only staging, unknown-pair/content exclusions, fenced attempts/retries, durable connection-test intent and cached results, tenant-bound paging, reviewed replay, revoked authority pause, vault inventory/conflicts, explicit trusted products, missing sources, forged product selection and hidden configuration.

Database lint passed without M13-05 errors or warnings. Existing unrelated warnings remain. Generated types were produced and copied through `pnpm --filter infrastructure run db:types`.

## Synthetic source-scan benchmark

The runnable `apps/infrastructure/tests/m13-05-siem-benchmark.e2e.sh` creates a schema-only disposable database. It copies no retained rows. Synthetic fixture construction bypasses audit triggers only in that disposable database, supplies structural chain metadata, and analyzes tables before measurement. These fixtures do not prove chain integrity. The script removes only its owned scratch database and temporary schema file.

Measured bounded real staging RPC scans of intentionally unregistered event pairs, followed by 100 audited database reads per fixture:

| Synthetic source rows | Scan time | 250-row batches | Read p95 | Read p99 |
|---:|---:|---:|---:|---:|
| 10,000 | 1,076.75 ms | 40 | 8.78 ms | 12.13 ms |
| 100,000 | 4,948.96 ms | 400 | 18.20 ms | 27.13 ms |
| 1,000,000 | 33,892.51 ms | 4,000 | 95.25 ms | 166.87 ms |

The initial analyzed 10k scan took 9,810.98 ms. SQL boolean expression evaluation was resolving source visibility before the closed-class exclusion. Explicit nested class prefiltering reduced that fixture to 340.29 ms in the initial corrected run. The final run above includes all subsequent scope guards and per-operation permission snapshots. Authorization still runs before any selected event is staged, sent or disclosed. M13-03's inward-only permission snapshot is reused once per guarded operation; no cross-request authorization cache was introduced.

These numbers measure source scanning and database reads, not HTTP/API latency, selected-event authorization throughput, collector receipt, or network delivery throughput. The read samples follow each scan in a synthetic transaction rather than concurrent API load. A sampled whole PostgreSQL container consumed approximately 618 MiB during the earlier scan; this is shared container memory, not isolated SIEM worker RSS. Core API load, wire transport, outages and browser results are reported separately.


## Dense queue and concurrency

The same disposable fixture separately staged 10,000 registered, authorized organization events in **2,241.97 ms**. Twenty audited destination-health samples with that populated queue measured **p95 150.94 ms / p99 198.56 ms**. This is database staging throughput, not collector/network throughput.

The 10,001st pending candidate was not consumed: the 10,000-row cap stopped scanning with the original cursor at 10,000 and explicit backpressure. Two claimed deliveries belonged to different tenants, while a third claim returned null at the two-slot global limit. These are measured bounded scheduler invariants rather than a sustained fairness SLA.

A real two-connection test held the destination lock, disabled it transactionally, and concurrently attempted completion using the previous worker lease. Completion waited for the lifecycle transaction and then rejected the stale lease with a conflict. No deadlock or resurrection occurred. The fixture uses only the disposable database and includes no receiver traffic.

Final local schema contains **282 public tables** and **131 migration-ledger entries**: 109 prior entries plus 22 individually applied/recorded M13-05 additive versions. Four focused indexes cover source-event, replay ancestry, composite attempt-history and enabling-user relationships. No historical ledger entry was modified.

Full infrastructure SQL suite output: `/tmp/cra-m13-05-infrastructure-full.log`. Final database benchmark output: `/tmp/cra-m13-05-database-benchmark.log`. Temporary raw logs are session artifacts; the tables and conclusions above preserve the relevant non-sensitive evidence.
