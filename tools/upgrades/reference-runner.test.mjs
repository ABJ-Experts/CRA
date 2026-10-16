import { test } from "node:test";
import assert from "node:assert/strict";
import {
  caseEvidence,
  percentiles,
  verifyArtifact,
  runReference,
} from "./reference-runner.mjs";
test("case proofs bind run, request, actual duration and native observations", () => {
  const input = {
    runId: "run-1",
    requestDigest: "a".repeat(64),
    generation: "N-1",
    name: "drain-refusal",
    startedAt: new Date().toISOString(),
    durationMs: 120,
    observations: [{ generation: "g", claimsClosed: true, drained: false }],
  };
  const first = caseEvidence(input);
  assert.notEqual(
    first.evidenceDigest,
    caseEvidence({ ...input, runId: "run-2" }).evidenceDigest,
  );
  assert.notEqual(
    first.evidenceDigest,
    caseEvidence({ ...input, durationMs: 121 }).evidenceDigest,
  );
  for (const durationMs of [0, -1, 1_800_000, Infinity])
    assert.throws(() => caseEvidence({ ...input, durationMs }));
  assert.throws(() => caseEvidence({ ...input, observations: [] }));
});
test("metadata statistics use measured samples with nearest-rank p95/p99", () => {
  assert.deepEqual(percentiles(Array.from({ length: 100 }, (_, i) => i + 1)), {
    count: 100,
    p95Ms: 95,
    p99Ms: 99,
    maxMs: 100,
  });
  assert.throws(() => percentiles([]));
  assert.throws(() => percentiles([NaN]));
});
test("requires actual artifact digest and dedicated runner before any effects", async () => {
  await assert.rejects(verifyArtifact("relative", "a".repeat(64)));
  await assert.rejects(runReference("/absent", "/absent", {}), /dedicated/);
});
test("fixed Compose validation rejects source networking, volumes, mounts and mutable images", async () => {
  const { validateFixtureCompose } = await import("./reference-runner.mjs");
  const image = `sha256:${"a".repeat(64)}`;
  const config = {
    services: {
      api: {
        image,
        pull_policy: "never",
        volumes: [
          { type: "bind", source: "/var/lib/cra-qualification/run/api" },
        ],
      },
    },
    networks: { private: { name: "cra-q-net", internal: true } },
    volumes: { db: { name: "cra-q-db" } },
  };
  assert.doesNotThrow(() =>
    validateFixtureCompose(config, "cra-q", "/var/lib/cra-qualification/run"),
  );
  for (const modified of [
    { ...config, networks: { private: { external: true, name: "original" } } },
    { ...config, volumes: { db: { external: true, name: "source-db" } } },
    { ...config, services: { api: { image: "latest", pull_policy: "never" } } },
    {
      ...config,
      services: {
        api: {
          image,
          pull_policy: "never",
          volumes: [{ type: "bind", source: "/original/source" }],
        },
      },
    },
  ])
    assert.throws(() =>
      validateFixtureCompose(
        modified,
        "cra-q",
        "/var/lib/cra-qualification/run",
      ),
    );
});
test("orchestrates all three generations with unique isolated projects and measured evidence", async () => {
  const fs = await import("node:fs/promises"),
    os = await import("node:os"),
    path = await import("node:path"),
    crypto = await import("node:crypto");
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "cra-reference-runner-"),
  );
  try {
    const artifact = path.join(root, "artifact");
    await fs.writeFile(artifact, "actual test artifact bytes");
    const sha256 = crypto
        .createHash("sha256")
        .update(await fs.readFile(artifact))
        .digest("hex"),
      file = { path: artifact, sha256 };
    const request = path.join(root, "request.json");
    const releases = ["N", "N-1", "N-2"].map((generation) => ({
      generation,
      source: { payload: file, signature: file },
      target: { payload: file, signature: file },
    }));
    await fs.writeFile(request, JSON.stringify({ releases }));
    const environment = {
      CRA_DEDICATED_QUALIFICATION_RUNNER: "true",
      CRA_QUALIFICATION_RUNNER_ID: "unit-test-runner",
      CRA_QUALIFICATION_ROOT: root,
    };
    const calls = [],
      projects = [],
      proofs = [];
    let metadataCount = 0;
    const image = `sha256:${"a".repeat(64)}`;
    const command = async (executable, args) => {
      calls.push({ executable, args });
      if (args.includes("config"))
        return JSON.stringify({
          services: { api: { image, pull_policy: "never" } },
          networks: { private: { name: args[2] + "-backend", internal: true } },
        });
      return "";
    };
    const fixtureFactory = async (input) => {
      projects.push(input.project);
      const scenarioRoot = path.join(input.root, input.scenario);
      return {
        kind: "native-linux-compose",
        project: input.project,
        composePath: scenarioRoot + "/compose.yml",
        networkName: input.project + "-backend",
        journalRoot: scenarioRoot + "/journal",
        environment: {},
        prepareImages: async () => {
          proofs.push("load");
        },
        waitReady: async () => {
          proofs.push("ready");
        },
        exercise: async (name) => [{ actualScenario: name }],
        assertNativeOutcome: async (name, observations) => {
          assert.equal(observations[0].actualScenario, name);
          proofs.push(name);
        },
        readMetadata: async () => {
          metadataCount++;
        },
      };
    };
    const dependencies = {
      platform: "linux",
      rootPrefix: await fs.realpath(root),
      command,
      fixtureFactory,
    };
    const output = path.join(root, "report.json");
    const report = await runReference(
      request,
      output,
      environment,
      dependencies,
    );
    assert.equal(report.cases.length, 24);
    assert.equal(new Set(projects).size, 24);
    assert.equal(metadataCount, 300);
    assert.equal(report.metadata.count, 300);
    assert.equal(calls.filter((x) => x.args.includes("up")).length, 24);
    assert.equal(proofs.filter((x) => x === "load").length, 24);
    assert(
      report.cases.every((c) => c.durationMs > 0 && c.durationMs < 1_800_000),
    );
    assert.equal(
      JSON.parse(await fs.readFile(output, "utf8")).runId,
      report.runId,
    );
    await assert.rejects(
      runReference(
        request,
        path.join(root, "bad.json"),
        { ...environment, DOCKER_HOST: "tcp://remote" },
        dependencies,
      ),
      /remote Docker/,
    );
    await fs.writeFile(request, JSON.stringify({ releases: [] }));
    await assert.rejects(
      runReference(
        request,
        path.join(root, "bad.json"),
        environment,
        dependencies,
      ),
      /pairs required/,
    );
    await fs.writeFile(request, JSON.stringify({ releases }));
    await assert.rejects(
      runReference(request, path.join(root, "bad.json"), environment, {
        ...dependencies,
        fixtureFactory: async () => ({
          kind: "external",
          composePath: "/original",
        }),
      }),
      /isolated native fixture/,
    );
    await assert.rejects(
      verifyArtifact(artifact, "f".repeat(64)),
      /digest mismatch/,
    );
    await assert.rejects(verifyArtifact(root, sha256), /actual release/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("bounded command runner captures output, nonzero exits, spawn failures and deadlines", async () => {
  const { command } = await import("./reference-runner.mjs");
  const { spawn } = await import("node:child_process");
  const local = (script) => (_exe, _args, options) =>
    spawn(process.execPath, ["-e", script], options);
  assert.equal(
    await command("docker", ["version"], {
      spawnProcess: local("process.stdout.write('local proof')"),
    }),
    "local proof",
  );
  await assert.rejects(
    command("docker", [], { spawnProcess: local("process.exit(1)") }),
    /operation failed/,
  );
  await assert.rejects(
    command("docker", [], {
      spawnProcess: (_exe, _args, options) =>
        spawn("/missing-cra-test-binary", [], options),
    }),
    /ENOENT/,
  );
  await assert.rejects(
    command("docker", [], {
      timeoutMs: 10,
      spawnProcess: local("setInterval(()=>{},1000)"),
    }),
    /deadline/,
  );
  await assert.rejects(
    command("docker", [], {
      spawnProcess: local(
        "process.stdout.write('x'.repeat(2*1024*1024));setInterval(()=>{},1000)",
      ),
    }),
    /operation failed/,
  );
});
