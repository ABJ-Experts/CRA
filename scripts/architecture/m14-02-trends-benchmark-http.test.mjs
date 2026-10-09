import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dataset,
  sourceDataset,
  bucket,
  filters,
  source,
  sourcePage,
  csvFor,
} from "./m14-02-trends-benchmark.fixture.mjs";
async function runHarness(t, reply, overrides = {}, script = "http-benchmark") {
  const directory = await mkdtemp(join(tmpdir(), "cra-m14-parity-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cookie = join(directory, "private-cookie");
  await writeFile(cookie, "synthetic_cookie=guard_only", { mode: 0o600 });
  let requests = 0;
  const server = createServer((req, res) => {
    requests += 1;
    reply(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const process = spawn(
    globalThis.process.execPath,
    [`apps/infrastructure/tests/m14-02-trends-${script}.mjs`],
    {
      env: {
        ...globalThis.process.env,
        M14_TRENDS_HTTP_ORIGIN: `http://127.0.0.1:${server.address().port}`,
        M14_TRENDS_HTTP_DATABASE: "cra_m14_benchmark",
        M14_TRENDS_HTTP_COOKIE_FILE: cookie,
        M14_TRENDS_HTTP_PRODUCT_ID: "",
        M14_TRENDS_HTTP_SECOND_COOKIE_FILE: "",
        M14_TRENDS_HTTP_SAMPLES: "200",
        M14_TRENDS_HTTP_AUXILIARY_SAMPLES: "0",
        M14_TRENDS_HTTP_PACE_MS: "0",
        M14_TRENDS_HTTP_FROM: filters.from,
        M14_TRENDS_HTTP_TO: filters.to,
        M14_TRENDS_HTTP_MIN_DURATION_COHORTS: "0",
        M14_TRENDS_HTTP_MIN_ACTIVITY_SOURCES: "3",
        ...overrides,
      },
    },
  );
  let stdout = "",
    stderr = "";
  process.stdout.on("data", (value) => {
    stdout += value;
  });
  process.stderr.on("data", (value) => {
    stderr += value;
  });
  const status = await new Promise((resolve) => process.once("exit", resolve));
  return {
    status,
    requests,
    stderr,
    summaries: stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((row) => row.scope || row.metric),
  };
}

test("organization harness collects all 200 valid responses without blending product cohorts", async (t) => {
  const result = await runHarness(t, (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(dataset));
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.requests, 200);
  assert.equal(result.summaries[0].requestedScope, "organization");
  assert.equal(result.summaries[0].requestedSamples, 200);
  assert.equal(result.summaries[0].successfulResponses, 200);
});
test("organization harness records its first 503 and aborts without retry or claiming 200 samples", async (t) => {
  const result = await runHarness(t, (_req, res) => {
    res.statusCode = 503;
    res.end("Temporarily unavailable");
  });
  assert.equal(result.status, 1);
  assert.equal(result.requests, 1);
  assert.equal(result.summaries[0].requestedSamples, 200);
  assert.equal(result.summaries[0].samples, 1);
  assert.equal(result.summaries[0].completed, false);
  assert.equal(result.summaries[0].meetsReadTarget, false);
});
test("pinned CSV correct revision cannot conceal mismatched chart values", async (t) => {
  const result = await runHarness(
    t,
    (req, res) => {
      if (req.url.includes("/export?")) {
        res.setHeader("Content-Type", "text/csv");
        res.end(
          csvFor(dataset).replace(
            '"3","2026-10-09T00:00:00.000Z"',
            '"4","2026-10-09T00:00:00.000Z"',
          ),
        );
      } else if (req.url.includes("/sources?")) {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            datasetRevision: dataset.datasetRevision,
            items: [],
          }),
        );
      } else {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(dataset));
      }
    },
    { M14_TRENDS_HTTP_SAMPLES: "2", M14_TRENDS_HTTP_AUXILIARY_SAMPLES: "2" },
  );
  assert.equal(result.status, 1);
  assert.equal(result.requests, 3);
  assert.match(result.stderr, /Chart\/CSV value parity failed/);
  assert.equal(
    result.summaries.find((row) => row.scope === "export").completed,
    false,
  );
});

test("HTTP harness rejects unsafe inputs before any request", async (t) => {
  for (const overrides of [
    { M14_TRENDS_HTTP_ORIGIN: "https://foreign.invalid" },
    { M14_TRENDS_HTTP_DATABASE: "postgres" },
    { M14_TRENDS_HTTP_COOKIE_FILE: "" },
    { M14_TRENDS_HTTP_MIN_ACTIVITY_SOURCES: "-1" },
    { M14_TRENDS_HTTP_MIN_ACTIVITY_SOURCES: "100000001" },
    { M14_TRENDS_HTTP_MIN_ACTIVITY_SOURCES: "not-a-number" },
    { M14_TRENDS_HTTP_AUXILIARY_SAMPLES: "201" },
    { M14_TRENDS_HTTP_SAMPLES: "501" },
    { M14_TRENDS_HTTP_PACE_MS: "-1" },
  ]) {
    const result = await runHarness(
      t,
      (_req, res) => res.end("Unexpected"),
      overrides,
    );
    assert.equal(result.requests, 0);
    assert.equal(result.status, 1);
  }
});

test("HTTP harness verifies full CSV parity with normal positive pacing", async (t) => {
  const result = await runHarness(
    t,
    (req, res) => {
      if (req.url.includes("/export?")) {
        res.setHeader("Content-Type", "text/csv");
        res.end(csvFor(dataset));
      } else if (req.url.includes("/sources?")) {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            datasetRevision: dataset.datasetRevision,
            items: [],
          }),
        );
      } else {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(dataset));
      }
    },
    {
      M14_TRENDS_HTTP_SAMPLES: "2",
      M14_TRENDS_HTTP_AUXILIARY_SAMPLES: "2",
      M14_TRENDS_HTTP_PACE_MS: "1",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.requests, 6);
  assert.equal(
    result.summaries.find((row) => row.scope === "export").completed,
    true,
  );
});

test("HTTP harness fails closed on mismatched or unavailable pinned sources", async (t) => {
  for (const status of [200, 503]) {
    const result = await runHarness(
      t,
      (req, res) => {
        res.setHeader("Content-Type", "application/json");
        if (req.url.includes("/sources?")) {
          res.statusCode = status;
          res.end(
            JSON.stringify({ datasetRevision: "foreign-revision", items: [] }),
          );
        } else res.end(JSON.stringify(dataset));
      },
      { M14_TRENDS_HTTP_SAMPLES: "2", M14_TRENDS_HTTP_AUXILIARY_SAMPLES: "2" },
    );
    assert.equal(result.status, 1);
    assert.equal(result.requests, 2);
  }
});

test("source parity CLI exhausts wire-shaped observations plus carried context with one pin", async (t) => {
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
  const result = await runHarness(
    t,
    (req, res) => {
      res.setHeader("content-type", "application/json");
      const url = new URL(req.url, "http://127.0.0.1");
      if (!url.pathname.endsWith("sources"))
        return res.end(JSON.stringify(coverage));
      assert.equal(url.searchParams.get("datasetToken"), coverage.datasetToken);
      assert.equal(url.searchParams.get("limit"), "100");
      const items =
        url.searchParams.get("metric") === "activity"
          ? [source("1"), source("2"), source("3")]
          : [
              source("carried", {
                sourceType: "release",
                sourceId: "release-1",
                factKind: "carried_coverage_context",
                effectiveAt: "2026-10-08T00:00:00.000Z",
              }),
              source("observation", {
                sourceType: "release",
                factKind: "coverage_observation",
              }),
            ];
      if (
        url.searchParams.get("metric") === "activity" &&
        !url.searchParams.get("cursor")
      )
        return res.end(
          JSON.stringify(
            sourcePage(items.slice(0, 1), { nextCursor: "synthetic-next" }),
          ),
        );
      res.end(
        JSON.stringify(
          sourcePage(
            url.searchParams.get("metric") === "activity"
              ? items.slice(1)
              : items,
          ),
        ),
      );
    },
    { M14_TRENDS_HTTP_PRODUCT_ID: "synthetic-product" },
    "source-parity",
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.requests, 4);
  assert.equal(result.summaries[0].observedSources, 3);
  assert.equal(result.summaries[1].observedSources, 1);
  assert.equal(result.summaries[1].carriedCoverageContexts, 1);
  assert.equal(result.summaries[1].totalPagedItems, 2);
});
test("source parity CLI rejects unsafe scope or bounds before fetch and fails closed on HTTP errors", async (t) => {
  for (const override of [
    { M14_TRENDS_HTTP_ORIGIN: "https://example.invalid" },
    { M14_TRENDS_HTTP_DATABASE: "postgres" },
    { M14_TRENDS_HTTP_PRODUCT_ID: "" },
    { M14_TRENDS_SOURCE_PARITY_MAX_PAGES: "201" },
    { M14_TRENDS_SOURCE_PARITY_MAX_PAGES: "0" },
    { M14_TRENDS_SOURCE_PARITY_MAX_PAGES: "1.5" },
    { M14_TRENDS_HTTP_ORIGIN: "" },
  ]) {
    const result = await runHarness(
      t,
      () => assert.fail("Must not fetch"),
      { M14_TRENDS_HTTP_PRODUCT_ID: "synthetic-product", ...override },
      "source-parity",
    );
    assert.equal(result.status, 1);
    assert.equal(result.requests, 0);
  }
  const result = await runHarness(
    t,
    (_req, res) => {
      res.statusCode = 503;
      res.end("Unavailable");
    },
    { M14_TRENDS_HTTP_PRODUCT_ID: "synthetic-product" },
    "source-parity",
  );
  assert.equal(result.status, 1);
  assert.equal(result.requests, 1);
  assert.match(result.stderr, /HTTP 503/);
});
test("HTTP harness preserves separately filtered concurrent identity and rejects malformed pins", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "cra-m14-secondary-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "cookie");
  await writeFile(file, "synthetic_second=unit_only", { mode: 0o600 });
  const result = await runHarness(
    t,
    (_req, res) => res.end(JSON.stringify(dataset)),
    { M14_TRENDS_HTTP_SAMPLES: "2", M14_TRENDS_HTTP_SECOND_COOKIE_FILE: file },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.requests, 3);
  assert.equal(result.summaries[1].scope, "secondary");
  await writeFile(file, "synthetic\nforged");
  const invalid = await runHarness(t, () => assert.fail("Must not fetch"), {
    M14_TRENDS_HTTP_SECOND_COOKIE_FILE: file,
  });
  assert.equal(invalid.status, 1);
  assert.equal(invalid.requests, 0);
});

test("source CLI defaults calendar range and rejects multiline cookies", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "cra-m14-source-cookie-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "cookie");
  await writeFile(file, "bad\nheader");
  const bad = await runHarness(
    t,
    () => assert.fail("Must not fetch"),
    {
      M14_TRENDS_HTTP_PRODUCT_ID: "synthetic-product",
      M14_TRENDS_HTTP_COOKIE_FILE: file,
    },
    "source-parity",
  );
  assert.equal(bad.status, 1);
  assert.equal(bad.requests, 0);
  const result = await runHarness(
    t,
    (req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      const dynamic = {
        ...sourceDataset,
        filters: {
          ...sourceDataset.filters,
          from: url.searchParams.get("from"),
          to: url.searchParams.get("to"),
        },
        series: {
          ...sourceDataset.series,
          sbomCoverage: {
            ...sourceDataset.series.activity,
            unit: "percent",
            buckets: [
              {
                ...bucket,
                opened: null,
                closed: null,
                reopened: null,
                numerator: 0,
                denominator: 0,
                sourceCount: 0,
              },
            ],
          },
        },
      };
      res.end(
        JSON.stringify(
          url.pathname.endsWith("sources")
            ? sourcePage(
                url.searchParams.get("metric") === "activity"
                  ? [source("1"), source("2"), source("3")]
                  : [],
              )
            : dynamic,
        ),
      );
    },
    {
      M14_TRENDS_HTTP_PRODUCT_ID: "synthetic-product",
      M14_TRENDS_HTTP_FROM: undefined,
      M14_TRENDS_HTTP_TO: undefined,
    },
    "source-parity",
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.requests, 3);
});
