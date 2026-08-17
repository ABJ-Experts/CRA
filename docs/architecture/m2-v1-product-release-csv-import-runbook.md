# M2 V1 product/release CSV import runbook

## Operating model

An import has one durable `product_import_jobs` row and paged
`product_import_rows` results. It advances from
upload to dry-run terminal state, then optionally to an atomic commit terminal
state. A dry run has no product/release mutations. The browser is a view of
database state and may be safely refreshed or restarted.

Only a verified member of the active organization can view or act on an import.
Do not use SQL to change job state, row plans, product/release records, or
storage metadata. Do not download source CSVs to an unmanaged workstation.

## Normal operation

1. Confirm the CSV reports the published format version, expected headers, and
   file limits. Upload through the products import route; the API assigns the
   tenant-prefixed object path and records its hash.
2. Wait for `dry_run_completed` (or observe parsing/validation progress for a
   durable import). Review aggregate counts and all blocking row errors.
3. Download the five-minute signed result report only when necessary. Store it
   according to the organization's approved data-handling rules.
4. Commit only a ready, unexpired dry run with zero failed rows. The API
   rechecks authorization, object hash, active member/owner/entity state, and
   aggregate versions. It either commits every planned mutation or commits none.
5. Confirm the terminal result and audit correlation ID. Never retry by
   re-uploading a changed file under an existing dry-run identifier.

## Recovery and incident handling

| Signal                                               | Operator action                                                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `expired`, missing object, or content-hash mismatch  | Do not commit. Start a new upload/dry run; preserve audit evidence.                                                                                    |
| `stale_conflict` / changed aggregate or owner/entity | Refresh source data and create a new dry run. Do not edit saved rows.                                                                                  |
| Worker lease/retry in progress                       | Let the lease expire or use the scoped retry command after checking metrics; it resumes from the durable checkpoint.                                   |
| Dead letter                                          | Investigate only IDs/counts/error code and worker logs. Correct the dependency, then issue an authorized retry; duplicate delivery remains idempotent. |
| Canceled before commit                               | Treat as terminal. Re-upload for a new dry run; cancellation cannot compensate a committed transaction.                                                |
| Permission or tenant-access concern                  | Disable import routes/worker first, preserve durable records/logs, and investigate with organization-scoped queries. Never widen storage/RPC grants.   |
| Suspected formula/report injection                   | Quarantine the report distribution path, verify report escaping, and regenerate only from the stored safe row results. Never echo raw source cells.    |

## Cleanup, monitoring, and rollback

- The cleanup worker removes only source/report objects under the exact expired
  `<organizationId>/<importId>/` prefix in the private `product-imports` bucket
  after seven days. It verifies the
  import's organization and object path before deletion, removes storage via
  the Storage API in bounded batches, and records count/outcome. It never
  removes shared, seeded, or another organization's objects.
- Monitor byte size, rows, dry-run/commit duration, validation and commit
  failures, retry/dead-letter counts, duplicate suppression, cleanup failures,
  and queue lag. Logs contain correlation/import IDs, outcome codes, and
  counts—not raw CSV, report cells, SBOM material, credentials, or owners.
- To roll back, disable the UI/API route and worker schedule, retaining the
  additive schema, bucket, source/report retention policy, audit facts, and
  committed records. Repair database defects through a forward migration only;
  never reset Supabase, rewrite an applied migration, or delete a committed
  product/release to make an import appear uncommitted.

## Local verification and recovery drills

Run against the local `cra` stack with mocks disabled. Create a uniquely
prefixed test account and organization, perform an upload/dry-run/commit/report
journey, take desktop and narrow screenshots through Playwright, and remove
only that exact fixture's imports and objects. Assert the prefix cleanup and
leave all seeded/shared products, organizations, and storage untouched.

The Playwright configuration deliberately does not start workers. Before the
durable commit portion of `product-import.spec.ts`, build the API and run this
separate local process against the same local database:

```sh
pnpm --filter api worker:product-import
```

The browser test polls the persisted import status until `completed`; it must
not assume the commit request itself performs product mutations synchronously.
