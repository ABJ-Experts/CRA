# M14-02 contract and API validation

This is focused boundary evidence, not a claim that source/database/browser
verification is complete. Source-history and browser evidence belong in the
M14-02 rollout runbook.

## Requirement-to-test mapping

| Acceptance criterion | Evidence |
| --- | --- |
| Defined buckets, timezone and bounded filters | `packages/contracts/src/dashboard/schemas/trends.schema.spec.ts`: leap date, IANA timezone, reversed/oversized range, future dates and strict unknown-key rejection. |
| Separate units and denominator context | Same suite: metric unit invariants, numerator/denominator percentage parity, zero-denominator null, duration sample-count nullability and real zero samples. |
| Missing history differs from zero | Same suite: withheld series cannot expose buckets; nullable means remain null while a measured zero with samples remains valid. |
| Reproducible chart/table/CSV | `apps/api/src/dashboard/dashboard-trends-use-cases.spec.ts`: pinned filters/revision, stable cutoff, impossible future observation rejection; `domain/dashboard-trends-csv.spec.ts`: canonical values, null cells, formula and quote escaping. |
| Authorization before aggregates and export | Use-case suite: inactive/missing-session/denied identity rejected before reads; changed tenant/permissions/filter token rejected; source cohort and metric checks precede reads. |
| Successful response parsing | Shared schemas, use-case suite and `infrastructure/supabase-dashboard-trends.repository.spec.ts`: malformed provider payloads fail closed, scoped RPC parameters, indistinguishable denied/nonexistent records. |
| Explicit route boundaries and failures | `dashboard-trends.controller.spec.ts`: all three endpoints require dashboard permission; JSON/CSV metadata, no-store export and domain-to-HTTP error mapping. |
| Dataset lifetime and bounded memory | `infrastructure/dashboard-dataset-codec.spec.ts`: encrypted large snapshot, tampering/expiry/scope rejection and oversized token rejection. |

## Commands and results

From the repository root:

```sh
pnpm --filter api exec jest dashboard-trends dashboard-dataset --runInBand --coverage --collectCoverageFrom='dashboard/**/*trends*.ts' --collectCoverageFrom='dashboard/infrastructure/dashboard-dataset-codec.ts' --coverageThreshold='{}'
pnpm --filter @repo/contracts exec vitest run src/dashboard/schemas/trends.schema.spec.ts --coverage --coverage.include=src/dashboard/schemas/trends.schema.ts
pnpm test:architecture
```

Resume focused run: 32 API tests and 20 schema tests passed. New API modules
measured 95.67% statements, 92.66% branches, 100% functions and 97.90% lines;
every individual new executable module exceeded 80% in all four dimensions.
The trend schema measured 100% in all four dimensions. Architecture checks
passed 93 tests and reported no dependency violations. The concrete crypto
integration spec lives at the dashboard composition level, preserving inward
application dependency direction.

Read-only owner-authorized local Supabase REST checks confirmed fresh projection,
pinned replay and source paging returned HTTP 200. Replay and sources retained
the identical dataset revision and pin. No user records, credentials or dataset
tokens are included in this document. A transient database outage observed during
verification is recorded by the parent runbook; no API change was justified by
that infrastructure failure.

The resume gate additionally pins HMAC-derived source identifiers: stable within
one authorized dataset across page sizes, different across actor/session, scope,
permission revision, filters and source metric. SQL ordering remains internal;
genuine authorized source UUIDs and links are unchanged. A validated provider
replay that returns a different revision or snapshot yields HTTP 409, while
malformed or cross-scope payloads remain unavailable. The codec individually
measured 92.10% statements / 88% branches / 100% functions / 94.28% lines.

Bounded source continuation is explicit: the valid current page is preserved
when its next offset exceeds 1,000,000, with no live cursor and the parsed
`source_page_limit` reason. Tests cover crossing the cap, the usable exact
boundary and strict response consistency. Source/CSV reads continue to bind to
the original authorized dataset; the cap does not alter metric aggregates.

## Performance continuation regression mapping

The query-only availability migration `20261009094753` preserves the public
contracts and dataset epoch. `m14-02-legacy-reopening-predicate.test.sql` adds
25 assertions for nullable legacy classification, missing superseded metadata,
explicit supersession, clipping, late transaction visibility and source parity.
`m14-02-org-identity-history.test.sql` adds nine assertions for empty/late source
parents, SQL-valid rootless imported histories, protected tenant identity,
duplicate revisions and malformed unused duration fields. These pass alongside
234 existing projection assertions against rollback-applied migration code.

The benchmark acceptance harness now validates organization-only product cohort
withholding and every CSV field against the pinned chart, rather than merely
checking a revision label. A separate bounded source pass exhausts a small
product's activity and coverage pages, rejects duplicate identities/cursors and
scope drift, and compares observation counts with chart sourceCount. Carried
coverage context keeps its actual earlier timestamp and is tracked separately
from observations. Fixtures use the actual strict shared contract shape.

The continuation harness observed meaningful failing tests before changes and
then passed 47 focused tests under a 64MiB Node heap. Individual helper, HTTP
harness and bounded source runner exceed 80% line, branch and function coverage;
Node's report has no separate statement metric. These are harness correctness
checks, not substitutes for authenticated latency or full repository validation.
Current measured performance acceptance remains in the parent runbook.
