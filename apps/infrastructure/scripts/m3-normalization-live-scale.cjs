/* Opt-in local normalizer -> repository -> PostgREST/SQL diagnostic.
 * Does not upload an original object or exercise browser/Nest transport.
 * Creates one private fixture organization and deletes only that exact tenant.
 */
const { createHash, randomUUID } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const { createRequire } = require("node:module");
const apiRequire = createRequire(resolve(__dirname, "../../api/package.json"));
const { createClient } = apiRequire("@supabase/supabase-js");
const { normalizeSbomStream, NORMALIZER_VERSION } = apiRequire(
  "./dist/sboms/normalization/sbom-normalizer",
);
const { SupabaseSbomRepository } = apiRequire(
  "./dist/sboms/infrastructure/supabase-sbom.repository",
);

if (process.env.CRA_RUN_M3_LIVE_SCALE !== "1")
  throw new Error("Set CRA_RUN_M3_LIVE_SCALE=1 for the local-only diagnostic");
const projectUrl = process.env.SUPABASE_URL;
if (
  projectUrl !== "http://127.0.0.1:54321" &&
  projectUrl !== "http://localhost:54321"
)
  throw new Error("Refusing non-local Supabase");
if (NORMALIZER_VERSION !== "m3-03.3")
  throw new Error("Build the current frozen API first");
const client = createClient(projectUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const originalRpc = client.rpc.bind(client);
client.rpc = async (name, args, options) => {
  const result = await originalRpc(name, args, options);
  if (result.error)
    console.error(
      JSON.stringify({
        operation: name,
        code: result.error.code,
        status: result.status,
      }),
    );
  return result;
};
const repository = new SupabaseSbomRepository({ admin: () => client });
const organizationId = randomUUID();
const workerId = "normalizer-replay-worker-one";
const maximumComponents = Number(process.env.M3_SCALE_COMPONENTS ?? "50000");
if (
  !Number.isInteger(maximumComponents) ||
  maximumComponents < 1 ||
  maximumComponents > 50000
)
  throw new Error("Invalid local scale size");
const outputPath = process.env.M3_SCALE_OUTPUT;
if (!outputPath) throw new Error("M3_SCALE_OUTPUT is required");
function* corpus() {
  yield Buffer.from(
    '{"bomFormat":"CycloneDX","specVersion":"1.6","version":1,"components":[',
  );
  for (let index = 0; index < maximumComponents; index++) {
    yield Buffer.from(
      (index ? "," : "") +
        JSON.stringify({
          type: "library",
          "bom-ref": "scale-" + index,
          name: "scale-" + Math.floor(index / 2),
          version: "1.0.0",
          purl: "pkg:npm/scale-" + index + "@1.0.0",
        }),
    );
  }
  yield Buffer.from("]}");
}
const hash = createHash("sha256");
let corpusBytes = 0;
for (const chunk of corpus()) {
  hash.update(chunk);
  corpusBytes += chunk.length;
}
const sha256 = hash.digest("hex");
function sql(statement) {
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_cra",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: statement, encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  if (result.status !== 0)
    throw new Error("Local fixture SQL failed: " + result.stderr);
  return result.stdout;
}
function assert(value, message) {
  if (!value) throw new Error(message);
}
function percentile(values, fraction) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.ceil(ordered.length * fraction) - 1];
}
async function scopedRpc(name, args) {
  const { data, error } = await client.rpc(name, {
    p_organization_id: organizationId,
    ...args,
  });
  if (error) throw new Error(name + ": " + error.code);
  return data;
}
async function main() {
  let fixtureCreated = false;
  let finalMetrics;
  try {
    const fixturePath = resolve(
      __dirname,
      "../tests/m3-graph-concurrency-fixture.sql",
    );
    let setup = readFileSync(fixturePath, "utf8");
    setup =
      setup.slice(0, setup.indexOf("  select * into v_persist")) + "end $$;";
    setup = setup
      .replace(
        "v_hash text := repeat('d', 64)",
        "v_hash text := '" + sha256 + "'",
      )
      .replaceAll(
        "'application/json', 42",
        "'application/json', " + corpusBytes,
      )
      .replace(
        "v_hash, 42, 'application/json'",
        "v_hash, " + corpusBytes + ", 'application/json'",
      )
      .replace("'m3-03.1'", "'m3-03.2'");
    sql(
      "begin; select set_config('m3_test.fixture_org','" +
        organizationId +
        "',false); insert into public.organizations(id,name,slug) values('" +
        organizationId +
        "','M3 live scale fixture','m3-graph-" +
        organizationId +
        "');\n" +
        setup +
        "\ncommit;",
    );
    fixtureCreated = true;
    const { data: documents, error } = await client
      .from("sbom_documents")
      .select("id,ingest_job_id")
      .eq("organization_id", organizationId);
    if (error || documents?.length !== 1)
      throw new Error("Scoped normalization fixture missing");
    const documentId = documents[0].id;
    const jobId = documents[0].ingest_job_id;
    const { data: members } = await client
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", organizationId);
    const actorId = members[0].user_id;
    let batches = 0;
    let rows = 0;
    let maximumBatchRows = 0;
    const writeTimings = [];
    const start = performance.now();
    const result = await normalizeSbomStream(corpus(), {
      maximumBytes: 20 * 1024 * 1024,
      maximumComponents,
      maximumBatchRows: 250,
      retainResult: false,
      onBatch: async (batch) => {
        const batchRows = batch.components.length + batch.edges.length;
        maximumBatchRows = Math.max(maximumBatchRows, batchRows);
        rows += batch.components.length;
        const started = performance.now();
        await repository.persistNormalizationBatch(organizationId, {
          jobId,
          workerId,
          documentId,
          batch,
          diagnostics: [],
          sourceOffset: Math.max(
            ...batch.components.map((c) => c.source.offset),
            0,
          ),
        });
        writeTimings.push(performance.now() - started);
        batches++;
        if (batches % 10 === 0) {
          const progress = await scopedRpc("checkpoint_sbom_ingest_job", {
            p_job_id: jobId,
            p_worker_id: workerId,
            p_progress_stage: "batching",
            p_progress_percent: 60,
            p_lease_seconds: 120,
          });
          assert(
            progress?.[0]?.outcome === "checkpointed",
            "Normalization lease renewal failed",
          );
        }
      },
    });
    assert(
      rows === maximumComponents &&
        maximumBatchRows <= 250 &&
        result.components.length === 0,
      "Bounded streaming rows were not retained correctly",
    );
    console.log("Bounded normalization persisted " + rows + " components");
    const normalizationMs = performance.now() - start;
    const finalizeStart = performance.now();
    await repository.finalizeNormalization(organizationId, {
      jobId,
      workerId,
      documentId,
    });
    console.log("Finalization succeeded");
    const finalizeMs = performance.now() - finalizeStart;
    const document = await repository.getDocument(organizationId, {
      actorId,
      documentId,
    });
    assert(
      document?.document?.componentCount === maximumComponents ||
        document?.componentCount === maximumComponents,
      "Published component count differs",
    );
    const readTimings = [];
    const treeTimings = [];
    let page = null;
    for (let sample = 0; sample < 30; sample++) {
      const started = performance.now();
      page = await repository.searchComponents(organizationId, {
        actorId,
        documentId,
        limit: 100,
        cursor: undefined,
      });
      readTimings.push(performance.now() - started);
      assert(page !== null, "Scoped component page unavailable");
      const treeStart = performance.now();
      const tree = await repository.listDependencyTree(organizationId, {
        actorId,
        documentId,
        parentComponentId: null,
        limit: 100,
      });
      treeTimings.push(performance.now() - treeStart);
      assert(tree?.items?.length === 100, "Root dependency page unavailable");
    }
    const seen = new Set();
    let cursor;
    let walkedPages = 0;
    do {
      const current = await repository.searchComponents(organizationId, {
        actorId,
        documentId,
        limit: 100,
        cursor,
      });
      assert(current !== null, "Pagination page unavailable");
      for (const component of current.components) {
        assert(!seen.has(component.id), "Pagination duplicated a component");
        seen.add(component.id);
      }
      cursor = current.nextCursor;
      walkedPages++;
      assert(
        walkedPages <= Math.ceil(maximumComponents / 100) + 1,
        "Pagination did not terminate",
      );
    } while (cursor);
    assert(seen.size === maximumComponents, "Pagination omitted components");
    const metrics = {
      projectUrl,
      scope:
        "Local real normalizer/repository/PostgREST/SQL; no original upload, Nest/browser read transport or production-load claim",
      normalizerVersion: NORMALIZER_VERSION,
      components: rows,
      corpusBytes,
      batches,
      maximumBatchRows,
      normalizationMs,
      finalizeMs,
      readSamples: 30,
      readPageSize: 100,
      duplicateNames: true,
      walkedPages,
      uniqueWalkedComponents: seen.size,
      rootTreeP95Ms: percentile(treeTimings, 0.95),
      rootTreeP99Ms: percentile(treeTimings, 0.99),
      readP95Ms: percentile(readTimings, 0.95),
      readP99Ms: percentile(readTimings, 0.99),
      writeBatchP95Ms: percentile(writeTimings, 0.95),
      writeBatchP99Ms: percentile(writeTimings, 0.99),
      retainedResultComponents: result.components.length,
      pageKeys: Object.keys(page),
    };
    finalMetrics = metrics;
    writeFileSync(outputPath, JSON.stringify(metrics, null, 2) + "\n");
    console.log(JSON.stringify(metrics));
  } finally {
    if (fixtureCreated) {
      const started = performance.now();
      sql(
        "delete from public.organizations where id='" +
          organizationId +
          "' and slug='m3-graph-" +
          organizationId +
          "';",
      );
      const cleanupMs = performance.now() - started;
      const { data: remaining, error } = await client
        .from("organizations")
        .select("id")
        .eq("id", organizationId);
      assert(
        !error && remaining.length === 0,
        "Exact fixture cleanup did not remove its tenant",
      );
      if (finalMetrics)
        writeFileSync(
          outputPath,
          JSON.stringify(
            { ...finalMetrics, cleanupMs, cleanupVerified: true },
            null,
            2,
          ) + "\n",
        );
      console.log(
        "Exact fixture cleanup completed in " + cleanupMs.toFixed(2) + "ms",
      );
    }
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
