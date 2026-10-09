import { createRequire } from "node:module";
import {
  dataset,
  sourceDataset,
  bucket,
  filters,
  source,
  sourcePage,
  csvFor,
} from "./m14-02-trends-benchmark.fixture.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBenchmarkDataset,
  assertBenchmarkCsv,
  beginSourceParity,
  acceptSourceParityPage,
} from "../../apps/infrastructure/tests/m14-02-trends-benchmark-parity.mjs";

test("bounded source exhaustion matches every chart source without duplicate events", () => {
  const initial = beginSourceParity(sourceDataset, "activity", 200);
  const first = acceptSourceParityPage(
    initial,
    sourcePage([source("1")], { nextCursor: "synthetic-cursor" }),
  );
  const last = acceptSourceParityPage(
    first,
    sourcePage([source("2"), source("3")]),
  );
  assert.equal(last.complete, true);
  assert.equal(last.count, 3);
  assert.equal(last.pages, 2);
});
test("source exhaustion rejects wrong revision, forged product scope and unavailable bucket dates", () => {
  const initial = beginSourceParity(sourceDataset, "activity", 200);
  assert.throws(
    () =>
      acceptSourceParityPage(
        initial,
        sourcePage([source("1")], { datasetRevision: "wrong" }),
      ),
    /revision/,
  );
  assert.throws(
    () =>
      acceptSourceParityPage(
        initial,
        sourcePage([source("1", { productId: "foreign-product" })]),
      ),
    /scope/,
  );
  assert.throws(
    () =>
      acceptSourceParityPage(
        initial,
        sourcePage([source("1", { effectiveAt: "2026-10-08T01:00:00.000Z" })]),
      ),
    /available bucket/,
  );
});
test("source exhaustion rejects duplicates, mismatched counts and repeated cursors", () => {
  const initial = beginSourceParity(sourceDataset, "activity", 200);
  assert.throws(
    () =>
      acceptSourceParityPage(
        initial,
        sourcePage([source("1"), source("1"), source("3")]),
      ),
    /duplicate/,
  );
  assert.throws(
    () => acceptSourceParityPage(initial, sourcePage([source("1")])),
    /count parity/,
  );
  const first = acceptSourceParityPage(
    initial,
    sourcePage([source("1")], { nextCursor: "same" }),
  );
  assert.throws(
    () =>
      acceptSourceParityPage(
        first,
        sourcePage([source("2")], { nextCursor: "same" }),
      ),
    /cursor/,
  );
});
test("source exhaustion bounds pages and refuses large or organization enumeration", () => {
  assert.throws(
    () => beginSourceParity(sourceDataset, "activity", 201),
    /page bound/,
  );
  assert.throws(
    () => beginSourceParity(dataset, "activity", 200),
    /product scope/,
  );
  const large = {
    ...sourceDataset,
    series: {
      ...sourceDataset.series,
      activity: {
        ...sourceDataset.series.activity,
        buckets: [{ ...bucket, sourceCount: 20001 }],
      },
    },
  };
  assert.throws(
    () => beginSourceParity(large, "activity", 200),
    /source bound/,
  );
  const limited = beginSourceParity(sourceDataset, "activity", 1);
  assert.throws(
    () =>
      acceptSourceParityPage(
        limited,
        sourcePage([source("1")], { nextCursor: "next" }),
      ),
    /page bound/,
  );
});
test("source checker handles its maximum 20000 identities within a 64MiB heap limit", () => {
  const large = {
    ...sourceDataset,
    series: {
      ...sourceDataset.series,
      activity: {
        ...sourceDataset.series.activity,
        buckets: [{ ...bucket, sourceCount: 20000 }],
      },
    },
  };
  let state = beginSourceParity(large, "activity", 200);
  for (let page = 0; page < 200; page += 1) {
    const items = Array.from({ length: 100 }, (_, i) =>
      source(`synthetic-${page * 100 + i}`),
    );
    state = acceptSourceParityPage(
      state,
      sourcePage(items, { nextCursor: page < 199 ? `cursor-${page}` : null }),
    );
  }
  assert.equal(state.count, 20000);
  assert.equal(state.complete, true);
});
test("source checker enforces shape, identity memory, continuation and completion guards", () => {
  const initial = beginSourceParity(sourceDataset, "activity", 200);
  for (const page of [
    sourcePage([], { continuationUnavailable: "source_page_limit" }),
    sourcePage(Array.from({ length: 101 }, (_, i) => source(String(i)))),
    sourcePage([source("x".repeat(257))]),
    sourcePage([], { nextCursor: "empty" }),
  ])
    assert.throws(() => acceptSourceParityPage(initial, page));
  assert.throws(
    () => beginSourceParity(sourceDataset, "readiness", 200),
    /supported/,
  );
  assert.throws(
    () =>
      acceptSourceParityPage(
        initial,
        sourcePage([source("1"), source("2"), source("3"), source("4")]),
      ),
    /count parity/,
  );
  const complete = acceptSourceParityPage(
    initial,
    sourcePage([source("1"), source("2"), source("3")]),
  );
  assert.throws(
    () => acceptSourceParityPage(complete, sourcePage([])),
    /already complete/,
  );
});
test("organization benchmark preserves genuine source rows and withheld product cohorts", () => {
  assert.doesNotThrow(() => assertBenchmarkDataset(dataset, filters, 0));
});
test("organization benchmark rejects blended durations instead of silently accepting zero cohorts", () => {
  const blended = {
    ...dataset,
    series: { ...dataset.series, triage: dataset.series.activity },
  };
  assert.throws(
    () => assertBenchmarkDataset(blended, filters, 0),
    /Organization.*triage/,
  );
});
test("organization benchmark rejects a substituted product filter", () => {
  assert.throws(
    () =>
      assertBenchmarkDataset(
        { ...dataset, filters: { ...filters, productId: "synthetic-product" } },
        filters,
        0,
      ),
    /filter/,
  );
});
test("product benchmark rejects incomplete resolved cohorts", () => {
  const scoped = {
    ...dataset,
    filters: { ...filters, productId: "synthetic-product" },
  };
  assert.throws(
    () => assertBenchmarkDataset(scoped, scoped.filters, 998),
    /Incomplete triage/,
  );
});
test("product benchmark accepts proven nonempty duration and activity cohorts", () => {
  const scoped = {
    ...dataset,
    filters: { ...filters, productId: "synthetic-product" },
    series: {
      ...dataset.series,
      triage: {
        ...dataset.series.activity,
        buckets: [{ ...bucket, sampleCount: 1 }],
      },
      remediation: {
        ...dataset.series.activity,
        buckets: [{ ...bucket, sampleCount: 1 }],
      },
    },
  };
  assert.doesNotThrow(() =>
    assertBenchmarkDataset(scoped, scoped.filters, 1, 3),
  );
});
test("activity minimum rejects a fast but empty organization projection", () => {
  assert.throws(
    () => assertBenchmarkDataset(dataset, filters, 0, 4),
    /Incomplete activity/,
  );
});
test("policy and pin are verified without logging their contents", () => {
  for (const override of [
    { policyVersion: "unknown" },
    { datasetToken: "" },
    { datasetRevision: "" },
  ])
    assert.throws(
      () => assertBenchmarkDataset({ ...dataset, ...override }, filters, 0),
      /Malformed benchmark/,
    );
});
test("chart CSV parity verifies every numeric value, exclusion, source count and withheld row", () => {
  assert.doesNotThrow(() => assertBenchmarkCsv(csvFor(dataset), dataset));
});
test("chart CSV parity rejects a changed source count even with the correct revision", () => {
  const changed = csvFor(dataset).replace(
    '"3","2026-10-09T00:00:00.000Z"',
    '"4","2026-10-09T00:00:00.000Z"',
  );
  assert.throws(() => assertBenchmarkCsv(changed, dataset), /parity/);
});
test("chart CSV parity rejects a missing unavailable metric row", () => {
  assert.throws(
    () =>
      assertBenchmarkCsv(
        csvFor(dataset)
          .split("\r\n")
          .filter((x) => !x.includes('"remediation"'))
          .join("\r\n"),
        dataset,
      ),
    /rows/,
  );
});
test("chart CSV parity checks quoted commas, multiline reasons and spreadsheet safety", () => {
  const special = {
    ...dataset,
    datasetRevision: '=formula,"quoted"\nnext',
    series: {
      ...dataset.series,
      activity: {
        ...dataset.series.activity,
        reason: 'context, "quoted"\nnext',
      },
    },
  };
  assert.doesNotThrow(() => assertBenchmarkCsv(csvFor(special), special));
  assert.throws(
    () =>
      assertBenchmarkCsv(
        csvFor(special).replace("'=formula", "=formula"),
        special,
      ),
    /parity/,
  );
});
test("chart CSV rejects inconsistent columns, incomplete quoting and unbounded memory", () => {
  assert.throws(
    () =>
      assertBenchmarkCsv(
        csvFor(dataset).replace('"policy","revision"', '"policy"'),
        dataset,
      ),
    /column parity/,
  );
  assert.throws(
    () => assertBenchmarkCsv(csvFor(dataset).slice(0, -3), dataset),
    /incomplete quoted/,
  );
  assert.throws(
    () => assertBenchmarkCsv("a".repeat(5_000_001), dataset),
    /memory bound/,
  );
});
test("CSV parser accepts a final record without a trailing newline", () => {
  assert.doesNotThrow(() =>
    assertBenchmarkCsv(csvFor(dataset).slice(0, -2), dataset),
  );
});

test("coverage exhaustion counts in-range observations separately from genuine carried context", () => {
  const coverage = {
    ...sourceDataset,
    series: {
      ...sourceDataset.series,
      sbomCoverage: {
        state: "available",
        reason: null,
        unit: "percent",
        baselineAt: "2026-10-08T00:00:00.000Z",
        buckets: [
          {
            ...bucket,
            opened: null,
            closed: null,
            reopened: null,
            value: 100,
            numerator: 1,
            denominator: 1,
            sourceCount: 1,
          },
        ],
      },
    },
  };
  const carried = source("carried", {
    sourceType: "release",
    sourceId: "release-1",
    factKind: "carried_coverage_context",
    effectiveAt: "2026-10-08T01:00:00.000Z",
  });
  const observation = source("observation", {
    sourceType: "release",
    sourceId: "release-1",
    factKind: "coverage_observation",
  });
  const result = acceptSourceParityPage(
    beginSourceParity(coverage, "sbomCoverage", 200),
    sourcePage([carried, observation]),
  );
  assert.equal(result.count, 1);
  assert.equal(result.carriedCount, 1);
  assert.equal(result.complete, true);
  for (const invalid of [
    { ...carried, effectiveAt: bucket.start },
    { ...carried, effectiveAt: "invalid" },
    { ...carried, provenance: "" },
    { ...carried, sourceType: "finding" },
  ]) {
    assert.throws(() =>
      acceptSourceParityPage(
        beginSourceParity(coverage, "sbomCoverage", 200),
        sourcePage([invalid, observation]),
      ),
    );
  }
  assert.throws(() =>
    acceptSourceParityPage(
      beginSourceParity(sourceDataset, "activity", 200),
      sourcePage([carried]),
    ),
  );
});

test("benchmark bucket fixture parses with the actual strict shared Zod contract", () => {
  const { dashboardTrendBucketSchema } = createRequire(import.meta.url)(
    "../../packages/contracts/dist/dashboard/schemas/trends.schema.js",
  );
  assert.deepEqual(dashboardTrendBucketSchema.parse(bucket), bucket);
  assert.equal(
    dashboardTrendBucketSchema.safeParse({ ...bucket, available: true })
      .success,
    false,
  );
});
