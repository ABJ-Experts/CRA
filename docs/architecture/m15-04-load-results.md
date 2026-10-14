# M15-04 diagnostic metadata load evidence

On 2026-10-14, the rollback-only metadata fixture completed against the existing local `supabase_db_cra` PostgreSQL 17.6 instance. Every measured operation had 200 samples after 10 warmup calls. Across 2,200 measured RPCs, the largest p99 was 16.272 ms for a 100-item large-tenant page. These SQL results establish local database metadata-read behavior at the fixture scale. The separate concurrent HTTP follow-up below tests the metadata target; generation and full-load behavior remain outside both experiments.

## Fixture and method

Run the committed fixture after the M15-04 migration, using the existing local stack:

```sh
docker exec -i supabase_db_cra psql -X -U postgres -d postgres \
  -v ON_ERROR_STOP=1 < apps/infrastructure/tests/m15-04-metadata-load.sql
```

The fixture adds two fresh task-owned organizations using a current verified auth session, 10,000 historical diagnostic receipts in the large tenant, and 25 in the small tenant. The large tenant splits receipts across the caller (8,000) and a former-member creator (2,000). It creates no stored artifacts, runnable jobs, extra active seat, or fabricated licence entitlement. A first preparation attempt correctly hit `licensing_customer_write_denied` when adding a second active member; that transaction aborted. The final fixture uses historical receipts from a former creator and preserves the licensing admission boundary.

The 10,000 large-tenant receipts contain 4,000 ready rows (half remain available, half project as expired), 2,000 cancelled, 2,000 failed, and 2,000 deleted rows. Selection, progress, omission, artifact and four-entry manifest metadata are populated. Mean PostgreSQL row sizes were 1,596 bytes cancelled, 1,600 deleted, 620 failed, and 1,592 ready. Stored objects are deliberately absent because these calls read metadata only; the fixture does not validate artifact retrieval or storage accounting.

`clock_timestamp()` surrounds the actual `m15_04_list`/`m15_04_get` RPC, including its current-session/permission checks and JSON serialization. Saving the timing sample occurs afterwards. List requests cover the first page (25 and 100 items) and a UUID cursor around the middle of the caller's history. Get requests vary historical states and verify both other-creator and cross-tenant denial. The benchmark rejects unexpected outcomes, short pages, wrong-tenant list items, or private internal fields.

Small-tenant reads run first as a baseline, then interleave with the large tenant's requests, including a small-tenant list immediately after a maximum-size page. All requests use one database connection. There is no concurrent-client isolation experiment, and baseline versus later differences also include run ordering and changing local host load. The higher interleaved list tail cannot be attributed to tenant contention from this experiment alone.

All fixture rows, bindings, memberships, organizations and temporary functions/tables were rolled back. A subsequent read confirmed zero organizations matching the fixture's `m15-04-load-%` slug prefix. No persistent relation statistics were rewritten: only temporary map tables were analyzed.

## Measurements

Milliseconds; each row has 200 measured calls.

| Operation                            |   p50 |    p95 |    p99 |    Max | Response bytes |
| ------------------------------------ | ----: | -----: | -----: | -----: | -------------: |
| Large: first 25                      | 3.554 |  7.889 |  9.408 |  9.980 |         18,796 |
| Large: middle 25                     | 3.501 |  6.841 |  9.264 | 11.122 |         19,313 |
| Large: first 100                     | 6.706 | 12.564 | 16.272 | 21.636 |         75,678 |
| Large: get varied history            | 1.109 |  2.624 |  3.068 |  4.594 |        704–810 |
| Large: other creator denied          | 1.339 |  3.165 |  4.894 |  5.780 |             24 |
| Small: baseline list 25              | 1.545 |  3.518 |  6.062 | 12.359 |         19,088 |
| Small: baseline get                  | 0.442 |  1.380 |  2.122 |  3.365 |            803 |
| Small: interleaved list 25           | 3.962 |  7.671 | 11.589 | 12.960 |         19,088 |
| Small: interleaved get               | 0.550 |  1.397 |  2.117 |  2.721 |            803 |
| Small: list after large maximum page | 4.027 |  8.000 |  9.668 | 15.336 |         19,088 |
| Small: foreign tenant get denied     | 1.157 |  2.995 |  4.358 |  5.446 |             24 |

Response bytes are the PostgreSQL serialized RPC result, including the RPC outcome/result wrapper; the application subsequently returns its parsed bare response. A database-only deny is 24 bytes. All sampled result assertions passed.

## Index evidence and pagination limitation

The fixture emits unforced `EXPLAIN (ANALYZE, BUFFERS)` plans for the inner creator-scoped list/get queries because explaining a PL/pgSQL RPC call hides nested plans. The planner selected `m15_04_creator_list` in every reported plan. No index scan was forced.

| Inner query                              | Actual chosen access                                         | Shared buffer hits | Execution ms |
| ---------------------------------------- | ------------------------------------------------------------ | -----------------: | -----------: |
| Large first 25                           | Index scan: organization + creator                           |                 27 |        0.068 |
| Large middle 25, direct bound            | Index scan: organization + creator + `id > cursor`           |                 27 |        0.036 |
| Large exact get                          | Index scan: organization + creator + ID                      |                  3 |        0.007 |
| Small list after other tenant's 10k rows | Index scan: organization + creator                           |                 23 |        0.022 |
| Cached optional-cursor equivalent        | Index scan: organization + creator; cursor applied as filter |              4,070 |        0.655 |

The optional cursor predicate `($3 IS NULL OR id > $3)` deserves follow-up before extrapolating to much larger histories. After ten mixed prepared executions, PostgreSQL chose a generic plan that removed 4,001 earlier rows by filter rather than placing the cursor in its index condition. This prepared equivalent exposes a possible cached-plan cost that the simpler literal-bound plan would hide. It is evidence for that statement shape, not a trace of the exact nested PL/pgSQL plan. Splitting the null/non-null query branches would make the cursor predicate directly indexable if larger-scale evidence warrants the change. This fixture and report do not change the database implementation.

## Remaining load evidence

This sample uses a warmed local working set and one connection. It does not measure simultaneous HTTP requests, multi-session lock contention, HTTP authentication/transport, application response parsing, source collection, archive generation, working-memory peaks, storage transfers, download throughput, or worker admission fairness. The small tenant remains readable while interleaving large-tenant SQL calls, but concurrent fairness remains unproven. The separate multi-client HTTP follow-up below supplies metadata concurrency evidence. A broader generation/storage/worker experiment is still required before claiming a full-load acceptance target.

## Concurrent HTTP metadata follow-up

The task-isolated HTTP harness is `apps/api/test/m15-04-http-load.mjs`. It accepts only the M15-04 isolated runtime, Supabase loopback port 56321, database container `cra_m15_04_db`, and API loopback port 3335. It uses the existing browser-fixture creator for two new owners/tenants, retains 10,000 terminal large-tenant rows and 100 small-tenant rows, and stores credentials only in private runtime manifests. Historical metadata rows do not claim stored artifacts exist. Preparation never touches the original CRA database or browser fixture tenant.

After all nine final browser checks completed and the API was stable, the default workload ran with ten concurrent clients split evenly between the two tenants, ten rounds of list/get requests, and fifty samples per tenant per operation. Twenty rounds are supported when one hundred samples per tenant per operation are required. The harness preserved production guards and the unchanged 60-per-minute per-route/IP throttle: a 61-second quiet window follows warmup, and concurrent rounds start eleven seconds apart. Any measured non-200 attempt, including 429, aborts without retry and remains in the result report. The harness checks parsed shared response schemas, organization scope, exact get identity and absence of private internal fields.

Commands, from the repository root:

```sh
node apps/api/test/m15-04-http-load.mjs prepare
# After browser verification finishes and the API is stable:
node apps/api/test/m15-04-http-load.mjs measure
```

The actual HTTP run completed at 2026-10-14 09:57:54 UTC: all 200 measured requests returned HTTP 200 and passed the shared schema, tenant-scope and private-field checks. Peak in-flight requests reached ten, split as five large-tenant and five small-tenant clients in each list/get phase. Ten rounds took 99.251 seconds of measured wall time. No 429, retry, throttle override or guard bypass occurred.

| HTTP cohort                                   | Samples |  p50 ms |  p95 ms | p99 ms / max | Response bytes |
| --------------------------------------------- | ------: | ------: | ------: | -----------: | -------------: |
| Large: list 25, alternating first/middle page |      50 | 124.845 | 208.070 |      210.039 |  17,904–18,093 |
| Large: get varied history                     |      50 |  79.057 | 121.870 |      122.778 |        630–734 |
| Small: list 25, alternating first/middle page |      50 | 123.380 | 203.693 |      212.462 |  17,820–17,893 |
| Small: get varied history                     |      50 |  78.940 | 121.606 |      131.229 |        630–734 |

Every cohort met the measured metadata target of p95 below 400 ms and p99 below 1,000 ms. The nearest-rank percentile calculation makes p99 equal to the largest observed sample in a 50-call cohort; this is a limited sample, not an estimate of a production population tail. The small tenant remained responsive while the 10,000-row tenant was read concurrently. There was no isolated small-tenant HTTP baseline, so these measurements do not establish a precise contention penalty.

Timing includes the local HTTP request through full response-body receipt, including server authentication, permission/licensing guards, API execution, database/PostgREST transport and server response validation/serialization. Client JSON/schema and semantic validation follow timing. These HTTP costs are absent from the earlier direct SQL-only figures. Warmup is excluded; all 200 measured attempts and safe response-size/timing data remain in the local nonsecret `http-load-results.json` evidence report.

Peak concurrency and sustained throughput are distinct here. Ten clients launch together in each phase, while rounds start eleven seconds apart to preserve the existing throttle. The aggregate observed rate was approximately 2.015 requests/second across both operations; each operation had 100 requests over the complete measurement. This run does not claim the service can sustain ten continuously busy clients or more than its configured per-IP/route admission rate. It deliberately did not probe the 429 boundary.

This is a real local API metadata-load measurement against two new task-owned tenants in the isolated stack. Their synthetic receipts are retained for inspection, with no reset or destructive teardown. It does not establish source collection, archive generation, working-memory, artifact transfer, download throughput or concurrent-worker performance.
