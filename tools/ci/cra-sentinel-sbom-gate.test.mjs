import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";

const script = new URL("./cra-sentinel-sbom-gate.mjs", import.meta.url)
  .pathname;
const bindingId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";

test("GitHub action rejects unsupported workflow dispatch before upload", async () => {
  const action = await readFile(
    new URL(
      "../../.github/actions/cra-sentinel-sbom-gate/action.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(action, /push\|release\)/);
  assert.doesNotMatch(action, /push\|release\|workflow_dispatch/);
});

test("GitLab template accepts only provider-verifiable push pipelines", async () => {
  const template = await readFile(
    new URL("../../.gitlab/ci/cra-sentinel-sbom.yml", import.meta.url),
    "utf8",
  );
  assert.match(template, /case "\$CI_PIPELINE_SOURCE" in\s+push\)/);
  assert.doesNotMatch(template, /push\|web|push\|schedule/);
});

test("Azure template rejects scheduled builds before upload", async () => {
  const template = await readFile(
    new URL(
      "../../azure-pipelines/cra-sentinel-sbom-gate.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(template, /IndividualCI\|BatchedCI\|Manual\)/);
  assert.doesNotMatch(template, /IndividualCI\|BatchedCI\|Manual\|Schedule/);
});

async function fixture(verdictState, run) {
  const requests = [];
  const directory = await mkdtemp(join(tmpdir(), "cra-ci-runner-"));
  const file = join(directory, "sample.cdx.json");
  await writeFile(file, '{"bomFormat":"CycloneDX"}');
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, url: request.url, body });
    response.setHeader("content-type", "application/json");
    if (request.url === "/storage") {
      response.statusCode = 200;
      response.end("{}");
    } else if (request.url === "/api/v1/ci/sbom-build-uploads") {
      response.end(
        JSON.stringify({
          source: { id: sourceId },
          upload: {
            uploadUrl: `http://127.0.0.1:${server.address().port}/storage`,
          },
        }),
      );
    } else if (
      request.url === `/api/v1/ci/sbom-build-uploads/${sourceId}/complete`
    ) {
      response.end(JSON.stringify({ job: { id: "job" } }));
    } else {
      response.end(
        JSON.stringify({
          verdict: { state: verdictState, message: verdictState },
        }),
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await run({
      requests,
      env: {
        ...process.env,
        CRA_SENTINEL_API_ORIGIN: `http://127.0.0.1:${server.address().port}`,
        CRA_SENTINEL_CI_TOKEN: "fixture-token",
        CRA_SENTINEL_SBOM_PATH: file,
        CRA_SENTINEL_BINDING_ID: bindingId,
        CRA_SENTINEL_RUN_ID: "run-42",
        CRA_SENTINEL_RUN_ATTEMPT: "2",
        CRA_SENTINEL_GATE_ATTEMPTS: "1",
      },
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}

function execute(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { env });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

test("upload uses only a binding/run reference and succeeds independently of policy", async () => {
  await fixture("policy_not_configured", async ({ requests, env }) => {
    const result = await execute({ ...env, CRA_SENTINEL_MODE: "upload" });
    assert.equal(result.code, 0, result.stderr);
    const initialize = JSON.parse(requests[0].body);
    assert.equal(initialize.bindingId, bindingId);
    assert.equal(initialize.runId, "run-42");
    assert.equal(initialize.runAttempt, "2");
    assert.equal(initialize.trustedEvent, undefined);
    assert.equal(initialize.repositoryId, undefined);
    assert.equal(initialize.productId, undefined);
    assert.equal(
      requests.some((request) => request.url?.includes("sbom-build-gate")),
      false,
    );
  });
});

test("gate remains nonpassing when policy is unconfigured", async () => {
  await fixture("policy_not_configured", async ({ requests, env }) => {
    const result = await execute({ ...env, CRA_SENTINEL_MODE: "gate" });
    assert.notEqual(result.code, 0);
    assert.equal(requests.length, 1);
    assert.match(
      requests[0].url,
      /bindingId=11111111-1111-4111-8111-111111111111/,
    );
    assert.match(requests[0].url, /runId=run-42/);
  });
});

test("an unexpected approved status cannot turn M11-04 ingestion into a pass", async () => {
  await fixture("approved", async ({ env }) => {
    const result = await execute({ ...env, CRA_SENTINEL_MODE: "gate" });
    assert.notEqual(result.code, 0);
  });
});
