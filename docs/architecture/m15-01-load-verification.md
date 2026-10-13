# M15-01 local SQL and HTTP load verification

Measured on 2026-10-13 using PostgreSQL/pgbench 17.6 inside the existing local
Supabase container. All writes used disposable `m15_benchmark_20261013`, restored
from a schema-only dump with original function owners and grants. No tenant data,
credentials, object bytes, migration ledger, or live fixture rows were copied or
changed. The disposable database was dropped after measurements; its absence was
verified with `pg_database`.

The snapshot includes the first six M15 migrations through `20261013062301`.
Later continuation, tenant storage readiness, and source alias repairs were
applied to the live development stack while this isolated run was in progress;
this run does not validate those later repairs. Status, history, seat/product
admission, and storage reservation definitions exercised here were unchanged by
those repairs. The schema dump SHA-256 is
`fe333f4dcee9512b33f310a91bbed1a75c31c2b5409faa9aeb8ab1ff707fb7bd`.

## Fixtures and workloads

The large tenant has 10,000 active verified members, 10,000 active products,
100,000 accounting rows, and 10,000 licence activation audit events. Accounting
rows charge 1 MiB each, distributed as 70% completed and 10% each reserved,
uploading, and uncertain. These represent ledger load, not 100,000 stored file
bytes. Licence events include 10% denied activations and use the existing M13
append RPC and chain finalization trigger with original chain-writer ownership.
No hashes, chain sequences, or canonical content were forged; zero pending audit
rows remained before measurement. The small tenant has one member and 20 licence
history events.

Bulk loading temporarily disabled growth admissions and unrelated member/product
cache/projection triggers exclusively in the disposable clone. All were restored
before measurements. License state is a privileged SQL fixture with bounded
runtime proof, not a cryptographically verified JWS. The 60-second proof was
refreshed immediately before measurement. Existing data is modeled above the
current size; quota admission still runs through the real SQL authorities.

Four pgbench clients ran concurrently, each recording 200 completed transactions:

- Large status calls `m15_01_get_state`, including usage and latest denied event.
- Large history fetches 20 events using randomized valid keyset cursors.
- Large admission calls seat admission, inserts a product through its source
  growth trigger, reserves a valid bounded import source through the storage RPC,
  asserts a successful reservation, then rolls the transaction back.
- Small status and history runs at a target 10 requests per second, overlapping
  the large admission client rather than finishing immediately.

## Results

Nearest-rank percentiles are calculated from raw pgbench transaction microseconds.
Every workload completed 200/200 transactions with zero failed transactions.

| Workload                      | Samples | p50 ms |  p95 ms |  p99 ms | Maximum ms |
| ----------------------------- | ------: | -----: | ------: | ------: | ---------: |
| Large status                  |     200 | 23.708 |  45.438 |  51.763 |     64.245 |
| Large history                 |     200 |  0.844 |   2.586 |   3.750 |      6.051 |
| Large admission with rollback |     200 | 64.270 | 102.829 | 144.222 |    152.061 |
| Small status and history      |     200 | 15.730 |  27.865 |  34.022 |     46.902 |

All measured SQL workloads satisfy p95 < 400 ms and p99 < 1,000 ms. These are
local Unix-socket SQL/result-transfer timings. They exclude HTTP routing, JSON
contract parsing, signature verification, storage object I/O, browser rendering,
and remote deployment/network latency. They are not API/browser latency evidence
or a production throughput guarantee.

During the large admission client's actual activity window, 139 small-tenant
samples had p95 32.252 ms and p99
35.790 ms. This bounds observed interference
for this workload; it does not establish fairness at arbitrary saturation.

## Reproduction and retained evidence

Scratch evidence is under `.superpowers/sdd/2026-10-13-m15-01/`:
`load-fixture.sql`, `load-measure.py`, each workload's `.pgbench.sql` and pgbench
summary `.log`, `load-raw/` transaction logs, `load-results.json`, and fixture/
restore logs. The schema-only dump was discarded after its digest was recorded.

Restore an explicitly disposable database from a fresh schema-only dump using
original role ownership, load `load-fixture.sql`, then run `load-measure.py`.
The measurement script targets only the fixed disposable database name and drops
it in `finally`. Fixture writes must never be redirected to the live database.
The scratch script is measurement scaffolding, not a production feature or a
migration. These SQL samples do not cover HTTP or browser performance. The separate HTTP
verification follows.

## HTTP load and process-scoped blocked-egress verification

A second run on 2026-10-13 used a fresh disposable database,
`m15_http_benchmark_20261013`, and a task-owned PostgREST 14.15 container on
loopback port 54328. The schema snapshot includes all 16 M15 migrations through
`20261013081806`; its SHA-256 is
`d0375c07f2d739a9080a3857a13a23cafd2a5326ef7bdbf4316fac4b32bd6eda`.
The schema-only dump existed only in process memory. No original tenant rows,
object bytes, or migration-ledger rows were copied.

The restore emitted warnings for Supabase-managed role ownership/default
privileges and auxiliary realtime functions. In the disposable clone, the two
public audit chain functions were restored to their original
`cra_audit_chain_writer` owner. All 1,680 public function signatures and owners,
complete public function-definition digests, and service-role execute-privilege
digests then matched the original database. Fixture growth/cache triggers were
restored before measurements; no disabled member or product triggers remained.

The fixture retains 10,000 verified active members, 10,000 active products,
100,000 storage accounting rows, and 10,000 finalized licence audit events for
the large tenant. Completed accounting rows total 73,400,320,000 bytes; reserved,
uploading, and uncertain rows total 31,457,280,000 reserved bytes. These model
accounting load rather than stored object bytes. The small tenant has one member
and 20 finalized licence history events. Audit sequence/hash metadata is
produced by the existing append RPC and chain trigger.

The real compiled Nest `AppModule` ran on loopback port 3340 through a
`TestingModule`. Only the Supabase service's admin REST transport was redirected
to the disposable PostgREST instance. Authentication, authorization, tenant
session checks, throttling, licence verification, controllers, repositories,
error filtering, and response-contract interception remained the actual
application implementations. Local GoTrue issued a genuine seeded-owner access
JWT; the minimal clone profile was bound to its subject, and real local
JWT/JWKS and MFA reads remained on the original auth service. No original
application profile or tenant data was changed by this harness.

Each clone tenant's stored licence was a genuine Ed25519 compact JWS signed by
the private local test issuer, with matching organization/instance binding,
claims, digest, and trusted key ID. Every current response was checked against
the shared schema, active policy, organization binding, expected usage, and
verified key/digest. Every history response passed the shared schema and returned
20 events. Large history samples used varying valid keyset cursors.

Three paced HTTP clients ran concurrently, producing the five result groups
below. Current and history each alternated large and small tenants, with at
least 1.1 seconds between request starts for that endpoint; product admissions
used their own 1.1-second pace. This honors the
unchanged 60-per-minute per-endpoint IP limit. There was no guard override,
forwarded-IP manipulation, or rate-limit bypass. Warm-up and negative probes are
excluded from percentile samples.

The large product limit equals its existing 10,000 products. Each admission
attempt passed the normal HTTP security/licence checks and reached the source
transaction authority, which returned the intended `409 license_product_limit`.
All 200 attempts were denied without adding a product. This workload measures
quota denial, not successful product creation throughput.

Nearest-rank percentiles use end-to-end HTTP request/JSON-body timings from the
Node 22 client on the same host. Server-side routing, real JWT/tenant/RBAC work,
response parsing, and current-state JWS verification are included. Bootstrap,
TLS, reverse proxying, browser rendering, storage byte I/O, and remote-network
latency are excluded.

| Workload                      | Samples | Expected HTTP |  p50 ms |  p95 ms |  p99 ms | Maximum ms |
| ----------------------------- | ------: | ------------: | ------: | ------: | ------: | ---------: |
| Large current                 |     200 |           200 | 116.776 | 278.139 | 398.241 |    657.371 |
| Large history                 |     200 |           200 |  75.693 | 151.625 | 291.688 |    514.998 |
| Large product quota admission |     200 |           409 | 120.030 | 250.122 | 459.974 |    711.290 |
| Small current                 |     200 |           200 | 105.834 | 228.688 | 478.448 |    885.668 |
| Small history                 |     200 |           200 |  77.246 | 162.193 | 439.585 |    703.760 |

All 1,000 measured requests returned their expected status; no request returned
429 or 5xx. All five workloads satisfy p95 < 400 ms and p99 < 1,000 ms. During the
actual large quota-admission activity window, 100 small-current samples had p95
189.386 ms and p99 369.489 ms; 100 small-history samples had p95 136.240 ms and
p99 321.368 ms. These observations bound interference for this paced local
workload, not fairness or throughput at arbitrary saturation. Final large-tenant
counts remained 10,000 members, 10,000 products, 100,000 accounting rows, and
10,000 licence events, with zero unfinished large-tenant audit rows.

### Blocked-egress scope and results

The same API process was launched with macOS `sandbox-exec` and a policy that
denies outbound networking except loopback. No host firewall, global network
settings, shared process, or original application container was changed.
An unsandboxed control connected to external `1.1.1.1:443`; the sandboxed API
process's identical TCP probe failed with `EPERM`. Its owned loopback PostgREST
TCP probe connected successfully. Probes sent no external application data.

Under that policy, an invalid JWT returned 401, and authenticated licence
current, licence history, and export-list reads returned 200 and passed their
shared response contracts. All subsequent measured workloads ran under the
same blocked-egress policy. This proves the measured local API read/admission
paths operate while process egress is denied. It does not claim a full export
archive job, object download, renewal activation, or browser workflow completed
under the sandbox; those require their own explicit evidence.

### Retained evidence and cleanup

Scratch evidence is under `.superpowers/sdd/2026-10-13-m15-01/`:
`http-runtime-setup.py`, `http-runtime-checks.cjs`, `runtime-loopback.sb`,
`http-load-results.json` (including all 1,000 raw sample timings and overlap
windows), `http-runtime-checks.log`, `http-load-schema-parity.json`,
`http-load-schema.sha256`, `http-load-restore.log`, `http-load-fixture.log`,
`http-egress-baseline.json`, `http-egress-policy-evidence.json`, and
`http-load-cleanup.log`.

The initial HTTP attempt had a wrong test expectation for the documented product
quota response; it was discarded and its exact task-owned process was stopped.
Its log is retained as `http-runtime-checks-invalid-attempt.log`. The table above
uses only the corrected, complete run.

For reproduction, retain locally generated private issuer/trust configuration,
run `http-runtime-setup.py` (which refuses existing disposable resource names),
then launch `http-runtime-checks.cjs` through `sandbox-exec -f
runtime-loopback.sb`. Finally run `http-runtime-setup.py --cleanup`. Private
issuer keys, service credentials, and session tokens must stay in ignored local
scratch files and are not report artifacts. The task-owned REST container and
disposable database were removed after verification; their absence was checked.
The generated private auth/REST environment files were also removed. Original
application databases, containers, API, and web processes were preserved.
