# M15-02 HTTP load and blocked-egress verification

Measured on 2026-10-13 with the actual compiled Nest `AppModule`, PostgreSQL
17.6, PostgREST 14.15, and a separate Storage API 1.77.0 instance. All 800
measured requests returned their expected 200 responses and passed the shared
contracts, organization binding, licence version/sequence, ready-state and exact
counter checks. Every workload met p95 < 400 ms and p99 < 1,000 ms.

## Isolation and fixtures

All fixture writes used disposable database `m15_02_http_load_20261013`.
Task-owned REST/storage containers used loopback ports 54329/54330 and storage
used its own `m15_02_http_load_bytes_20261013` volume. The owned API used port 3342. No original tenant rows, object bytes, application profiles, trust
configuration or issuer keys were copied or changed. The explicitly authorized
seeded-owner GoTrue sign-in issued a genuine local JWT; its subject was bound to
a minimal profile only in the clone. Real local JWT/JWKS and MFA reads remained
on the local authentication service.

The initial schema-only snapshot contained the first two M15-02 migrations.
Its SHA-256 is
`f02f2a285edb54fba54ac37a44ebcfa8be05b7e2366f25e96aa6f6ba3fc4faf5`.
The exact reviewed third migration
`20261013111628_m15_02_meter_tenant_lifecycle_compatibility.sql` was applied to the
clone after original application, with SHA-256
`4052c6b2a0c6862ba6ae36ab90472453f4d4fc671810272cffe3d4f2488de738`.
All 1,701 public function definitions, owners and effective service-role
execution privileges then matched the original, as did the meter's organization
foreign-key cascade. Original M13 chain-writer ownership and grants were
preserved. The schema dump existed only in process memory.

The large tenant contained 10,000 active verified members, 10,000 active products,
100,000 customer storage-ledger rows and 10,000 finalized M13 licence events.
The small tenant contained 20 of each. Ledger rows charged 1 MiB each: 70%
completed and 10% each reserved, uploading and uncertain. These model accounting
load rather than uploaded file bytes. Large completed/reserved customer bytes
were 73,400,320,000 / 31,457,280,000; small equivalents were
14,680,064 / 6,291,456. Protected bytes were initially zero.

Ten percent of fixture licence events were denials. Events used the existing
M13 append RPC and deferred chain finalization; no canonical content, sequences
or hashes were forged. Bulk seeding temporarily disabled selected source/cache
triggers exclusively in the clone. Original trigger states were restored and
meters rebuilt before measurement. No disabled fixture triggers or unfinished
tenant licence events remained. Member/product/customer-ledger and initial
licence-event row counts remained intact after measurement.

Each stored licence was a genuine Ed25519 compact JWS signed by a newly generated
private local issuer, with matching organization/instance binding, digest,
sequence and trusted key ID. Its trust configuration applied only to the owned
runtime. Credentials, tokens, private keys and generated private fixtures stayed
mode 0600 in ignored local files; they are not report artifacts.

Actual authentication, authorization, throttling, licensing, repositories and
response-contract interception ran unchanged. Only the admin Supabase transport
routed REST/storage to the owned services; unprovisioned storage transport
failed closed. No guard override, forwarded-IP manipulation or rate-limit
bypass was used. Storage service migration metadata was reconstructed from
pinned image files, with no original database metadata rows copied.
[The pinned Storage migration runner](https://github.com/supabase/storage/blob/v1.77.0/src/internal/database/migrations/migrate.ts)
explains why this avoids replay over the schema-only clone.

## Measured HTTP workloads

Usage/current each alternated large/small tenants, producing 200 samples per
endpoint and tenant. Starts were nominally paced 1.1 seconds apart. The minimum
recorded interval was 1.098 seconds due to timer granularity; each endpoint
had at most 55 measured starts in any 60-second window, within its unchanged
60-per-minute limit. Warm-up and negative probes were excluded.

Nearest-rank percentiles use end-to-end HTTP request/JSON-body timings from Node
on the same host. Server routing, genuine JWT/tenant/RBAC checks, licence JWS
verification and response parsing are included. Bootstrap, client assertions,
TLS, reverse proxies, browser rendering, remote-network latency and object-byte
I/O are excluded.

| Workload      | Samples | HTTP |  p50 ms |  p95 ms |  p99 ms | Maximum ms |
| ------------- | ------: | ---: | ------: | ------: | ------: | ---------: |
| Large usage   |     200 |  200 | 100.408 | 306.647 | 561.739 |   1218.443 |
| Small usage   |     200 |  200 |  90.913 | 196.147 | 421.092 |    850.441 |
| Large current |     200 |  200 |  78.847 | 257.487 | 551.621 |   1155.823 |
| Small current |     200 |  200 |  72.497 | 185.104 | 371.599 |    806.650 |

All 800 measured responses were 200; none returned 429 or 5xx. The rare large
maximums above one second are retained; acceptance targets concern p95/p99.
Interleaving bounds observed small/large interference for this local paced
workload. It does not establish production throughput or fairness at arbitrary
saturation.

A separate real product admission at the existing 10,000-product source cap
returned `409 license_product_limit`, without adding a product. This single
quota-denial compatibility probe is excluded from percentile samples.

## Blocked-egress and reconciliation evidence

The API ran under macOS `sandbox-exec` with outbound networking denied except
loopback. An unsandboxed `1.1.1.1:443` TCP control connected; the same API process
probe returned `EPERM`, while its owned PostgREST loopback probe connected. No
host firewall/global network setting or unrelated application process was
changed by this harness. Probes sent no external application data. An invalid
JWT returned 401. All measured reads ran under the same process policy.

The real cloned PostgREST reconciliation RPC cancelled a five-second injected
delay after 3,014.838 ms with SQLSTATE `57014` and HTTP 500. Injection occurred
after reservation changes and before rebuild/audit, only in the owned clone's
existing function. Entire small-tenant ledger, meter and audit snapshot digests
remained identical; 20 audit rows remained 20. The original definition was
restored in `finally`, and all-public function parity was rechecked. Clone fault
administration ran outside the API sandbox because Docker's control socket is
denied there. No fault injection was installed in production definitions.

Seventeen nested `auto_explain` ANALYZE plans behind ready usage/current SQL
authorities included four meter-access plans and zero source aggregate queries.
This observation covers ready meters without expired invitation refresh work;
refresh and reconciliation can intentionally inspect source rows.

## Signed policy scenarios and manual PDF export

After measurement, a new 881-byte local PDF was placed in the owned volume with
privileged clean-source metadata and a protected input ledger fixture. The
legacy SQL source helper needed configured evidence grants; the clone's owner
permission fixture was derived from canonical `@repo/contracts` owner defaults.
Normal JWT, membership, permission and licensing guards remained active. No
original grants were changed.

Baseline and genuine signed zero-cap, missing-entitlement and naturally expired
licences exercised actual M8 evidence read, export creation,
`EvidenceWatermarkExportWorker`, `EvidenceWatermarkRenderer`, owned Supabase
REST/storage adapters, export status, preview and delivery. Read/status,
preview and download returned 200; creation returned 201. The first input's
four 2,371-byte derivatives passed SHA-256 verification. Worker/API paths ran
under the same loopback-only sandbox. This initial clean source fixture excludes
an intake or malware-scanning claim.

A stronger ordinary customer-input case restored a genuine valid licence
version/sequence 5, then used actual bounded HTTP admission/upload/finalization:
initialization 201, PUT 204 to a verified owned 3342 URL, completion 201 and
`scan_pending`. The new PDF was 893 bytes. Its real admission was completed with
`protected_input=false` and exact observed bytes. Only scanner-clean metadata
was then a privileged fixture; original admission flags were not changed.

Completed customer bytes increased exactly 893, from 14,680,064 to 14,680,957.
The bounded service also legitimately released the expired synthetic 1 MiB
reservation prepared for the timeout test, reducing reserved bytes from
6,291,456 to 5,242,880. Final customer usage was therefore 19,923,837 bytes.
This source transition is recorded explicitly; all prior rows, immutable flags
and object bytes were retained.

| Genuine signed ordinary-input fixture | Version / sequence | State             | Customer caps   | Product growth denial             |
| ------------------------------------- | ------------------ | ----------------- | --------------- | --------------------------------- |
| Over-cap                              | 6 / 6              | active            | all finite zero | 409 `license_product_limit`       |
| Missing entitlements `[]`             | 7 / 7              | active            | all finite zero | 403 `license_capability_disabled` |
| Natural expiry after near-end grace   | 8 / 8              | expired_read_only | all finite zero | 403 `license_read_only`           |

Each activation used the real endpoint, higher sequence, genuine JWS and owned
licence artifact archival. Near-end-grace licences were signed within the last
30 seconds of the fixed 30-day grace window; real wall/monotonic time crossed
`graceEndsAt`. No clock override was used. All three ordinary customer-input
cases preserved product counts 20 before/after denial, while manual retained
PDF read/render/export/preview/delivery succeeded. Each ordinary input derivative
was 2,381 bytes and passed its recorded SHA-256 check. Generated derivatives
remain exempt; the ordinary input remains charged to customer storage.

## Actual owned API process restarts

Two actual owned API process restarts were verified: first with the protected
input at expired version/sequence 4 and meter version 8, then with the ordinary
customer input at expired version/sequence 8 and meter version 15. Each fresh
Nest process used the same clone, trust, instance, stored JWS and issuer files
under blocked egress. A byte-identical snapshot of 1,322 actual compiled API
files and compiled contracts protected restarts from concurrent build cleanup.
No load samples, source fixtures or signing keys were regenerated.

Genuine current/usage reads returned 200 after cold bootstrap. Complete usage
responses matched before restart except observation time; issuer/trust file
digests were unchanged. Fresh processes again showed external TCP `EPERM` and
owned loopback connectivity. Only owned processes on 3342 were changed.

| Final preserved gauge |            Value | Limit    | Availability |
| --------------------- | ---------------: | -------- | ------------ |
| Seats                 |               20 | finite 0 | ready        |
| Products              |               20 | finite 0 | ready        |
| Customer storage      | 19,923,837 bytes | finite 0 | ready        |
| Protected storage     |     17,508 bytes | exempt   | ready        |

The final small tenant remains verified `expired_read_only`, licence
version/sequence 8, for browser evidence. The 17,508
protected bytes comprise the first 881-byte protected input, four 2,371-byte
first-input derivatives and three 2,381-byte ordinary-input derivatives.

Browser fixture completion restored seven static settings catalog rows, three
retention evidence classes, six default policies and six protection watermarks
from the literal defaults/backfill in
`20260810124500_m1_tenant_administration_foundation.sql`. No original rows were
copied. The real settings page also requires MFA readiness for every member.
Nineteen synthetic clone profiles therefore received matching valid UUID auth
subjects in the owned clone. A labelled disposable GoTrue container, using the
same pinned `v2.194.0` image, listens only on loopback 54331. Its migration
metadata was reconstructed from 70 migration filenames in that image.

Only real admin MFA factor requests are routed to that owned GoTrue service;
genuine browser login, JWT and JWKS verification remain on the original local
auth service. No original auth users were created or changed. Initial hash
derived synthetic auth IDs failed the strict UUID schema and were replaced
with valid UUIDs through normal clone triggers. Removing those nineteen owned
old auth identities legitimately advanced projection version 15 to 34. Every
counter, component, limit, readiness field and licence provenance remained
identical; only meter version and observation time changed.

A third owned API restart preserved expired version/sequence 8 and all gauges,
again under blocked external egress. Real settings, catalog and retention HTTP
reads then returned 200 and passed the shared schemas. Actual MFA readiness was
zero enrolled and twenty unenrolled members, with `safeToEnforce=false`. The
final browser fixture has meter version 34. This completion happened after all
latency measurements and signed export scenarios.

The browser downloaded an actual audited usage JSON receipt while expired.
Read-only SQL against the owned clone matched its complete snapshot to sealed
audit event `4fbf78ea-6569-4097-9be7-40069803668f`, chain sequence 74, with action
`licensing.usage_exported` and outcome `completed`. All 74 retained small-tenant
chain rows passed canonical-content, content-hash, predecessor-link, contiguous
sequence and chain-head checks. The snapshot matched current meter version 34,
licence version/sequence 8, all components and signed policy fields. Historical
policy comparison used the receipt observation timestamp, not the admission
helper's five-second fresh-request window. No user data was emitted by the
verification. The downloaded file SHA-256 was
`be141e79557148c1cd718697ebcfdb28ca61b0710f894801cd9da6a24a328f0c`.

These checks prove the exercised local read and manual PDF export paths,
including the documented fixtures and process restarts. They do not claim every
export archive, scanner/intake job, connector, external feed, remote deployment
or browser workflow operates offline; browser evidence is recorded separately.

## Retained evidence and cleanup status

Ignored evidence is under
`.superpowers/sdd/2026-10-13-m15-02-offline-usage-metering/load-*`: setup/fixture
scripts and logs; schema/migration hashes; function/FK parity; all 800 raw HTTP
samples and pacing evidence; egress controls; nested query plans; timeout
rollback proof; signed scenario, source admission, protected export and growth
denial results; and before/after API restart and compiled snapshot digests.
Private credentials and issuer material are not report artifacts.

Initial fixture attempts rolled back while M13 UUID event keys and deferred
trigger restoration order were corrected. A pre-measurement API attempt was
restarted after separating Docker fault administration from the API sandbox.
None produced latency samples. After measurement, a Docker restart left owned
REST/storage containers exited. Recovery restarted only those exact owned
containers with the same clone/volume. Scenario transport/archival 503 attempts
were separately retained before the complete successful run. The ordinary-input
scaffold's total-only byte assertion was corrected to account for real expired
reservation cleanup; its completed-byte accounting assertion passed.

After desktop/mobile browser evidence and the downloaded receipt were verified,
root released cleanup. The exact owned API process exited through its release
marker. The labelled REST, Storage and GoTrue containers, disposable database
and owned byte volume were removed. Ports 3342, 54329, 54330 and 54331 were
confirmed closed. Ten exact generated private auth/environment, issuer/trust,
source-fixture and debug files were disposed of; nonsecret reports, screenshots
and hashes were retained.

Aggregate original-stack inventories before and after cleanup were identical:
33 admissions, 105 profiles and 351 storage objects, with matching full-row
digests for those sources. Original container IDs/states, original server PIDs
and all other volume names were unchanged. The original Storage container was
already stopped before cleanup and remained stopped; no original container was
restarted or removed. Root separately owns the clone web process on 3006.
`load-cleanup.json` and the before/after preservation inventories record these
actual checks.

The additive fourth CLI migration
`20261013123855_m15_02_meter_timestamp_maintenance.sql` was applied to the
original stack after measurements and browser verification. It accepted the
already identical timestamp trigger without changing public functions or the
measured read plans. It was not replayed into the disposable clone before
cleanup; the verified three-migration clone was removed as authorized.
