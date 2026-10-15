import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import https from "node:https";
import { performance as clock } from "node:perf_hooks";

// Explicit disposable profile only. No original database or policy is modified.
const exec = promisify(execFile);
const configPath = process.env.M15_05_OPERATOR_SERVER_CONFIG_FILE;
const profilePath = process.env.M15_05_RECOVERY_PROFILE_FILE;
assert.ok(
  configPath && profilePath,
  "Private disposable profile paths required",
);
const config = JSON.parse(await readFile(configPath, "utf8"));
const profile = JSON.parse(await readFile(profilePath, "utf8"));
assert.equal(profile.purpose, "m15-05-disposable-complete-source");
assert.match(profile.db, /^cra_m15_05_[a-z0-9_]+$/);
assert.equal(config.host, "127.0.0.1");
assert.equal(config.port, 3447);
assert.equal(config.instanceId, profile.instanceId);
assert.match(profile.instanceId, /^[a-f0-9-]{36}$/);
const actor = `m15-05-http-benchmark:${randomUUID()}`;
const sql = async (query) => {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      [
        "exec",
        "-i",
        profile.db,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-Atq",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.resume();
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(new Error("Disposable benchmark SQL failed")),
    );
    child.stdin.end(query);
  });
};
const [ca, cert, key] = await Promise.all(
  ["ca.crt", "client.crt", "client.key"].map((name) =>
    readFile(`${config.certificateDirectory}/${name}`),
  ),
);
const agent = new https.Agent({
  ca,
  cert,
  key,
  keepAlive: true,
  maxSockets: 6,
});
const origin = `https://${config.host}:${config.port}`;
const samples = [];
const request = () =>
  new Promise((resolve, reject) => {
    const started = clock.now();
    const req = https.get(
      `${origin}/api/v1/operator/instances/${profile.instanceId}/backups/runs?limit=25`,
      { agent },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          if (response.statusCode !== 200)
            return reject(
              new Error(`Metadata HTTP status ${response.statusCode}`),
            );
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          assert.ok(body.items.length <= 25);
          samples.push(clock.now() - started);
          resolve();
        });
        response.on("error", reject);
      },
    );
    req.setTimeout(5000, () =>
      req.destroy(new Error("Metadata request timed out")),
    );
    req.on("error", reject);
  });
try {
  await sql(`INSERT INTO public.backup_runs(instance_id,kind,state,stage,configuration_revision,configuration,configuration_digest,idempotency_key,request_digest,actor_id,created_at,completed_at,failure_code,covered_organization_ids)
    SELECT p.instance_id,'capture','failed','failed',p.configuration_revision,p.configuration,p.configuration_digest,gen_random_uuid(),repeat('b',64),'${actor}',clock_timestamp()-interval '1 day'-make_interval(secs=>n),clock_timestamp()-interval '1 day'-make_interval(secs=>n),'object_missing',ARRAY[(SELECT organization_id FROM public.organization_members ORDER BY organization_id LIMIT 1)] FROM public.backup_policies p CROSS JOIN generate_series(1,10000)n WHERE p.instance_id='${profile.instanceId}'; ANALYZE public.backup_runs;`);
  assert.equal(
    await sql(
      `SELECT count(*) FROM public.backup_runs WHERE actor_id='${actor}' AND instance_id='${profile.instanceId}'`,
    ),
    "10000",
  );
  // 72 requests preserve the production 120/minute certificate throttle.
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let index = 0; index < 12; index++) await request();
    }),
  );
  samples.sort((a, b) => a - b);
  const percentile = (p) =>
    Math.round(samples[Math.ceil(samples.length * p) - 1] * 1000) / 1000;
  const result = {
    rows: 10000,
    clients: 6,
    requests: samples.length,
    transport: "HTTPS/mTLS → private Nest API → PostgREST → PostgreSQL",
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: Math.round(samples.at(-1) * 1000) / 1000,
    p95TargetMet: percentile(0.95) < 400,
    p99TargetMet: percentile(0.99) < 1000,
    limits:
      "Local development profile; 72 samples. Separate SQL benchmark measures concurrent large/small tenant traffic.",
  };
  console.log(JSON.stringify(result, null, 2));
  if (process.env.M15_05_LOAD_OUTPUT)
    await writeFile(
      process.env.M15_05_LOAD_OUTPUT,
      `${JSON.stringify(result, null, 2)}\n`,
    );
} finally {
  agent.destroy();
  await sql(
    `DELETE FROM public.backup_runs WHERE actor_id='${actor}' AND instance_id='${profile.instanceId}';`,
  );
  await exec("docker", [
    "exec",
    profile.db,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-Atq",
    "-c",
    "SELECT 1",
  ]);
}
