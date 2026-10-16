import { createNativeReferenceFixture } from "./native-reference-fixture.mjs";
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const scenarios = Object.freeze([
  "fresh-install",
  "forward-upgrade",
  "image-rollback",
  "restart-reconcile",
  "egress-denied",
  "owner-auth-navigation",
  "drain-refusal",
  "lost-acknowledgement",
]);
export function percentiles(samples) {
  if (!samples.length || samples.some((n) => !Number.isFinite(n) || n < 0))
    throw new Error("actual metadata samples required");
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return {
    count: sorted.length,
    p95Ms: at(0.95),
    p99Ms: at(0.99),
    maxMs: sorted.at(-1),
  };
}
export function caseEvidence({
  runId,
  requestDigest,
  generation,
  name,
  startedAt,
  durationMs,
  observations,
}) {
  if (
    !scenarios.includes(name) ||
    !["N", "N-1", "N-2"].includes(generation) ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    durationMs >= 1_800_000 ||
    !Array.isArray(observations) ||
    observations.length === 0
  )
    throw new Error("bounded actual scenario observations required");
  const evidence = {
    runId,
    requestDigest,
    generation,
    name,
    startedAt,
    durationMs,
    observations,
  };
  return {
    ...evidence,
    evidenceDigest: createHash("sha256")
      .update(JSON.stringify(evidence))
      .digest("hex"),
  };
}
export async function command(
  executable,
  args,
  { env = process.env, timeoutMs = 30000, spawnProcess = spawn } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(executable, args, {
      cwd: repository,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("reference operation deadline exceeded"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.length > 1024 * 1024) child.kill("SIGKILL");
    });
    child.stderr.resume();
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(output)
        : reject(new Error("reference operation failed"));
    });
  });
}
export async function verifyArtifact(path, expected) {
  if (!path?.startsWith("/") || !/^[a-f0-9]{64}$/.test(expected))
    throw new Error("absolute artifact and exact digest required");
  const details = await stat(path);
  if (!details.isFile() || !details.size)
    throw new Error("actual release artifact required");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest("hex") !== expected)
    throw new Error("source/target artifact digest mismatch");
}
export function validateFixtureCompose(config, project, root) {
  if (!config || !config.services || !Object.keys(config.services).length)
    throw new Error("actual fixed Compose configuration required");
  for (const network of Object.values(config.networks ?? {}))
    if (
      network.external ||
      network.internal !== true ||
      !network.name?.startsWith(project)
    )
      throw new Error(
        "qualification networks must be unique internal task networks",
      );
  if (!Object.keys(config.networks ?? {}).length)
    throw new Error("isolated fixture network required");
  for (const volume of Object.values(config.volumes ?? {}))
    if (volume.external || !volume.name?.startsWith(project))
      throw new Error("existing/source volumes forbidden");
  for (const [name, service] of Object.entries(config.services)) {
    if (
      !/^(?:[a-zA-Z0-9./_:-]+@)?sha256:[a-f0-9]{64}$/.test(
        service.image ?? "",
      ) ||
      service.build ||
      service.pull_policy !== "never" ||
      service.network_mode ||
      service.privileged
    )
      throw new Error("immutable isolated fixture services required");
    for (const mount of service.volumes ?? [])
      if (
        mount.type === "bind" &&
        !(
          mount.source?.startsWith(root + "/") ||
          (name === "supervisor" && mount.source === "/var/run/docker.sock")
        )
      )
        throw new Error("source host mounts forbidden");
    for (const port of service.ports ?? [])
      if (port.host_ip !== "127.0.0.1" || Number(port.published) < 20000)
        throw new Error("task-only high loopback ports required");
  }
}
export async function runReference(
  requestPath,
  outputPath,
  environment = process.env,
  dependencies = {},
) {
  const execute = dependencies.command ?? command,
    factory = dependencies.fixtureFactory ?? createNativeReferenceFixture;
  if (
    (dependencies.platform ?? process.platform) !== "linux" ||
    environment.CRA_DEDICATED_QUALIFICATION_RUNNER !== "true" ||
    !environment.CRA_QUALIFICATION_RUNNER_ID
  )
    throw new Error("dedicated provisioned Linux reference runner required");
  if (environment.DOCKER_HOST || environment.SUPABASE_ACCESS_TOKEN)
    throw new Error("remote Docker and cloud Supabase credentials forbidden");
  const requestBytes = await readFile(requestPath);
  const request = JSON.parse(requestBytes);
  const requestDigest = createHash("sha256").update(requestBytes).digest("hex");
  if (
    !Array.isArray(request.releases) ||
    request.releases.length !== 3 ||
    new Set(request.releases.map((x) => x.generation)).size !== 3 ||
    !["N", "N-1", "N-2"].every((g) =>
      request.releases.some((x) => x.generation === g),
    )
  )
    throw new Error("N/N-1/N-2 source-target release pairs required");
  for (const release of request.releases)
    for (const direction of ["source", "target"])
      for (const kind of ["payload", "signature"])
        await verifyArtifact(
          release[direction]?.[kind]?.path,
          release[direction]?.[kind]?.sha256,
        );
  const runId = randomUUID();
  const project = `cra-qualification-${runId.replaceAll("-", "")}`;
  const root = await realpath(
    environment.CRA_QUALIFICATION_ROOT ?? "/var/lib/cra-qualification",
  );
  if (
    root === "/" ||
    root === repository ||
    !root.startsWith(dependencies.rootPrefix ?? "/var/lib/cra-qualification")
  )
    throw new Error("isolated qualification root required");
  const runRoot = join(root, runId);
  await mkdir(runRoot, { mode: 0o700 });
  for (const [exe, args] of [
    ["docker", ["version"]],
    ["docker", ["compose", "version"]],
    ["supabase", ["--version"]],
    ["flock", ["--version"]],
  ])
    await execute(exe, args);
  const cases = [];
  const metadataSamples = [];
  for (const release of request.releases) {
    for (const name of scenarios) {
      const startedAt = new Date().toISOString();
      const start = performance.now();
      const fixture = await factory({
        project: `${project}-${release.generation.toLowerCase().replaceAll("-", "")}-${name}`,
        scenario: name,
        root: runRoot,
        release,
        requestDigest,
        runId,
      });
      if (
        !fixture ||
        fixture.kind !== "native-linux-compose" ||
        !fixture.composePath?.startsWith(runRoot + "/") ||
        !fixture.networkName?.startsWith(project) ||
        relative(runRoot, fixture.journalRoot).startsWith("..")
      )
        throw new Error("isolated native fixture provisioning required");
      const normalized = JSON.parse(
        await execute(
          "docker",
          [
            "compose",
            "--project-name",
            fixture.project,
            "--file",
            fixture.composePath,
            "config",
            "--format",
            "json",
          ],
          { env: fixture.environment },
        ),
      );
      validateFixtureCompose(normalized, fixture.project, runRoot);
      await fixture.prepareImages();
      await execute(
        "docker",
        [
          "compose",
          "--project-name",
          fixture.project,
          "--file",
          fixture.composePath,
          "up",
          "--pull",
          "never",
          "--no-build",
          "--detach",
        ],
        { env: fixture.environment },
      );
      await fixture.waitReady({ signal: AbortSignal.timeout(300000) });
      // A fixture exposes observations/native supervisor actions, never a pass flag.
      const observations = await fixture.exercise(name, {
        signal: AbortSignal.timeout(1_799_000),
      });
      await fixture.assertNativeOutcome(name, observations);
      const evidence = caseEvidence({
        runId,
        requestDigest,
        generation: release.generation,
        name,
        startedAt,
        durationMs: performance.now() - start,
        observations,
      });
      await writeFile(
        join(runRoot, `${release.generation}-${name}.json`),
        JSON.stringify(evidence),
        { flag: "wx", mode: 0o600 },
      );
      cases.push(evidence);
      if (name === "forward-upgrade")
        for (let index = 0; index < 100; index++) {
          const start = performance.now();
          await fixture.readMetadata({ signal: AbortSignal.timeout(1000) });
          metadataSamples.push(performance.now() - start);
        }
    }
    // Preserve fixture resources/evidence for independent review. Cleanup is an
    // explicit separate operator operation, never automatic down -v/reset here.
  }
  const report = {
    version: 1,
    runId,
    requestDigest,
    runnerId: environment.CRA_QUALIFICATION_RUNNER_ID,
    project,
    cases,
    metadata: percentiles(metadataSamples),
  };
  await writeFile(outputPath, JSON.stringify(report) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  return report;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [request, output, ...extra] = process.argv.slice(2);
  if (!request || !output || extra.length)
    throw new Error("usage: reference-runner.mjs request.json NEW_RESULT.json");
  runReference(request, output).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
