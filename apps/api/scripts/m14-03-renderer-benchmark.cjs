// Run from the repository root: node --expose-gc apps/api/scripts/m14-03-renderer-benchmark.cjs
// Uses isolated temporary files; does not contact storage or the database.
const { resolve } = require("node:path");
const apiRoot = resolve(__dirname, "..");
process.env.TS_NODE_PROJECT = resolve(apiRoot, "tsconfig.json");
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: "CommonJS",
  moduleResolution: "Node",
  resolvePackageJsonExports: false,
  resolvePackageJsonImports: false,
});
require(resolve(apiRoot, "node_modules/ts-node/register/transpile-only"));
const { renderExportPart } = require(
  resolve(apiRoot, "src/exports/worker/export-renderer.ts"),
);
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { performance } = require("node:perf_hooks");
(async () => {
  const results = [];
  const directory = await mkdtemp(tmpdir() + "/cra-m14-bench-");
  try {
    for (const count of [10000, 100000])
      for (const format of ["csv", "xlsx"]) {
        if (global.gc) global.gc();
        let peak = process.memoryUsage().rss;
        const start = performance.now();
        const monitor = setInterval(() => {
          peak = Math.max(peak, process.memoryUsage().rss);
        }, 10);
        async function* rows(offset, limit) {
          for (let i = offset + 1; i <= offset + limit; i++)
            yield {
              ordinal: i,
              values: {
                id: `PRD-${String(i).padStart(9, "0")}`,
                name:
                  i % 37 === 0
                    ? '=HYPERLINK("bad","Unicode Ω 漢字")'
                    : `Product ${i} — café`,
                createdAt: "2026-10-09T00:00:00Z",
                count: i,
              },
            };
        }
        let bytes = 0,
          rowCount = 0;
        try {
          for (let offset = 0; offset < count; offset += 25000) {
            const part = await renderExportPart({
              directory,
              name: `rows-${count}-${offset}.${format}`,
              format,
              columns: [
                { key: "id", label: "Identifier", type: "text" },
                { key: "name", label: "Name", type: "text" },
                { key: "createdAt", label: "Created", type: "datetime" },
                { key: "count", label: "Count", type: "number" },
              ],
              rows: rows(offset, Math.min(25000, count - offset)),
            });
            bytes += part.bytes;
            rowCount += part.rowCount;
          }
        } finally {
          clearInterval(monitor);
        }
        const result = {
          count,
          format,
          milliseconds: Math.round(performance.now() - start),
          bytes,
          peakRssMiB: Math.round(peak / 1048576),
          rows: rowCount,
        };
        results.push(result);
        console.log(JSON.stringify(result));
      }
    if (process.env.M14_EXPORT_BENCHMARK_OUTPUT)
      await writeFile(
        process.env.M14_EXPORT_BENCHMARK_OUTPUT,
        JSON.stringify(
          {
            runtime: process.version,
            method:
              "Async generator frozen rows, isolated temporary files; process RSS sampled every 10ms. Measures rendering only, not production API or native capture.",
            results,
          },
          null,
          2,
        ),
      );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
