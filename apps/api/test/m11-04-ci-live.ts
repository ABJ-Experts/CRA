import "./m11-03-environment";
import { createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ConfigService } from "@nestjs/config";
import { ciBuildGateVerdictResponseSchema } from "@repo/contracts/sboms";

import type { CiConnectorConnection } from "../src/connectors/application/ci-connector-credential-reader";
import type { CiProviderVerifierPort } from "../src/sboms/application/sbom-ci-integration.port";
import { SbomCiIntegrationUseCases } from "../src/sboms/application/sbom-ci-integration-use-cases";
import { SupabaseSbomRepository } from "../src/sboms/infrastructure/supabase-sbom.repository";
import { SupabaseSbomStorageAdapter } from "../src/sboms/infrastructure/supabase-sbom-storage.adapter";
import { SbomIngestWorker } from "../src/sboms/worker/sbom-ingest-worker";
import { SupabaseService } from "../src/supabase/supabase.service";
import { SupabaseVulnerabilityMatchingRepository } from "../src/vulnerabilities/infrastructure/supabase-vulnerability-matching.repository";
import { VulnerabilityMatchingWorker } from "../src/vulnerabilities/matching/worker/vulnerability-matching-worker";

/** Run from apps/api: pnpm exec ts-node --transpile-only test/m11-04-ci-live.ts. */
async function run() {
  const url = new URL(process.env.SUPABASE_URL ?? "");
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.port !== "54321"
  )
    throw new Error("M11-04 live fixture requires the local CRA Supabase API");
  if (
    !/^project_id\s*=\s*"cra"/m.test(
      readFileSync(resolve("../infrastructure/supabase/config.toml"), "utf8"),
    )
  )
    throw new Error("M11-04 live fixture requires project cra");
  const supabase = new SupabaseService(new ConfigService());
  const admin = supabase.admin();
  const { data: actor, error: actorError } = await admin
    .from("users")
    .select("id")
    .eq("email", "owner@cra.test")
    .single();
  if (actorError || !actor)
    throw new Error("Local seeded owner is unavailable");

  const ids = {
    organization: randomUUID(),
    legalEntity: randomUUID(),
    product: randomUUID(),
    release: randomUUID(),
    connector: randomUUID(),
    secret: randomUUID(),
    credential: randomUUID(),
    binding: randomUUID(),
  };
  const fixtureName = `M11-04 CI Live ${ids.organization}`;
  const credentialPrefix = `cra_sbom_${ids.organization.replaceAll("-", "").slice(0, 8)}`;
  const credentialSecret = randomBytes(32).toString("base64url");
  const credentialSalt = randomBytes(16).toString("base64url");
  const credentialHash = scryptSync(
    credentialSecret,
    credentialSalt,
    32,
  ).toString("base64url");
  const sql = `begin;
    insert into public.organizations(id,name,slug) values ('${ids.organization}','${fixtureName}','m1104-${ids.organization.slice(0, 20)}');
    insert into public.organization_members(organization_id,user_id,role) values ('${ids.organization}','${actor.id}','owner');
    insert into public.organization_legal_entities(id,organization_id,identifier,display_name,legal_name,registered_address_line_1,registered_address_locality,registered_address_postal_code,registered_address_country,main_establishment_country,manufacturer_contact_name,manufacturer_contact_email,is_default,created_by,updated_by)
      values ('${ids.legalEntity}','${ids.organization}','main','CI fixture','CI fixture','1 Test Street','London','SW1A 1AA','GB','GB','Fixture Owner','owner@cra.test',true,'${actor.id}','${actor.id}');
    insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by)
      values ('${ids.product}','${ids.organization}','${ids.legalEntity}',0,'{}','CI fixture','ci-fixture','standalone_software','${actor.id}','${actor.id}','${actor.id}');
    insert into public.product_releases(id,organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,label,release_version,created_by,updated_by)
      values ('${ids.release}','${ids.organization}','${ids.product}','${ids.legalEntity}',0,'{}','CI fixture release','1.0.0','${actor.id}','${actor.id}');
    insert into public.sbom_ci_credentials(id,organization_id,label,token_prefix,token_salt,token_hash,created_by)
      values ('${ids.credential}','${ids.organization}','CI fixture','${credentialPrefix}','${credentialSalt}','${credentialHash}','${actor.id}');
    insert into public.connectors(id,organization_id,connector_type,display_name,adapter_version,mapping_version,connection_config,secret_ref,credential_revision,created_by,updated_by)
      values ('${ids.connector}','${ids.organization}','github_actions','CI fixture','1.0.0','1','{"providerHost":"github.com","appId":"123","installationId":"456"}','${ids.secret}',1,'${actor.id}','${actor.id}');
    insert into public.connector_secrets(id,organization_id,connector_id,ciphertext,rotated_by)
      values ('${ids.secret}','${ids.organization}','${ids.connector}',decode('00','hex'),'${actor.id}');
    insert into public.ci_provider_release_bindings(id,organization_id,connector_id,product_id,release_id,credential_id,provider,provider_host,repository_owner,repository_name,repository_id,provider_installation_id,allowed_ref,connection_revision,credential_revision,created_by)
      values ('${ids.binding}','${ids.organization}','${ids.connector}','${ids.product}','${ids.release}','${ids.credential}','github_actions','github.com','fixture','repo','123','456','refs/heads/main',1,1,'${actor.id}');
    commit;`;
  let fixtureCreated = false;
  let objectKey: string | undefined;
  let temporaryIndexCreated = false;
  const storageIndexesBefore = localSql(
    "select indexname||'|'||indexdef from pg_indexes where schemaname='storage' and tablename='objects' order by indexname;",
  );
  try {
    localSql(sql);
    fixtureCreated = true;
    assert(
      localSql(
        "select count(*) from (select bucket_id,name from storage.objects group by bucket_id,name having count(*)>1) duplicate_names;",
      ) === "0",
      "Local Storage has duplicate object names; temporary compatibility index is unsafe",
    );
    assert(
      !storageIndexesBefore.includes(
        "m1104_ci_live_storage_objects_name_bucket_tmp_idx",
      ),
      "Temporary Storage index already exists",
    );
    storageSql(
      "create unique index m1104_ci_live_storage_objects_name_bucket_tmp_idx on storage.objects(name,bucket_id);",
    );
    temporaryIndexCreated = true;
    console.log(
      "Local-only Storage 1.67 compatibility index installed for signed upload; removal is scoped to this run",
    );
    const repository = new SupabaseSbomRepository(supabase);
    const storage = new SupabaseSbomStorageAdapter(supabase);
    const connection: CiConnectorConnection = {
      connectorId: ids.connector,
      provider: "github_actions",
      secret: "local-simulator",
      connectionRevision: 1,
      credentialRevision: 1,
      config: {
        providerHost: "github.com",
        appId: "123",
        installationId: "456",
      },
    };
    const verifier: CiProviderVerifierPort = {
      verifyRepository: () =>
        Promise.resolve({
          outcome: "verified",
          repositoryId: "123",
          repositoryOwner: "fixture",
          repositoryName: "repo",
        }),
      verifyRun: () =>
        Promise.resolve({
          outcome: "verified",
          run: {
            provider: "github_actions",
            providerHost: "github.com",
            repositoryId: "123",
            providerInstallationId: "456",
            runId: "789",
            runAttempt: "1",
            commitSha: "a".repeat(40),
            ref: "refs/heads/main",
            eventName: "push",
            observedAt: new Date().toISOString(),
          },
        }),
    };
    const useCases = new SbomCiIntegrationUseCases(
      repository,
      storage,
      {
        load: (orgId, connectorId) => {
          if (orgId !== ids.organization || connectorId !== ids.connector)
            throw new Error("Wrong simulator scope");
          return Promise.resolve(connection);
        },
      },
      verifier,
    );
    const bytes = Buffer.from(
      JSON.stringify({
        bomFormat: "CycloneDX",
        specVersion: "1.5",
        version: 1,
        metadata: { timestamp: "2026-08-21T00:00:00Z" },
        components: [
          {
            type: "library",
            "bom-ref": "pkg:npm/example@1.0.0",
            name: "example",
            version: "1.0.0",
            purl: "pkg:npm/example@1.0.0",
          },
        ],
      }),
    );
    const input = {
      bindingId: ids.binding,
      runId: "789",
      runAttempt: "1",
      fileName: "fixture.cdx.json",
      mediaType: "application/json" as const,
      byteSize: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      idempotencyKey: randomUUID(),
    };
    const scope = {
      organizationId: ids.organization,
      credentialId: ids.credential,
    };
    const initialized = await useCases.initializeBuildUpload({
      ...scope,
      input,
      correlationId: randomUUID(),
    });
    assert(
      initialized.ok && initialized.value.upload,
      "CI upload reservation failed",
    );
    objectKey = initialized.value.reservation.objectKey;
    const put = await fetch(initialized.value.upload.uploadUrl, {
      method: "PUT",
      headers: { "content-type": input.mediaType },
      body: bytes,
    });
    assert(
      put.ok,
      `Immutable SBOM upload failed: ${put.status} ${(await put.text()).slice(0, 200)}`,
    );
    const completionInput = {
      bindingId: ids.binding,
      runId: "789",
      runAttempt: "1",
      idempotencyKey: input.idempotencyKey,
    };
    const completed = await useCases.completeBuildUpload({
      ...scope,
      sourceId: initialized.value.reservation.id,
      input: completionInput,
      correlationId: randomUUID(),
    });
    assert(
      completed.ok &&
        completed.value.job.sourceId === initialized.value.reservation.id,
      "M3 completion failed",
    );
    const replay = await useCases.initializeBuildUpload({
      ...scope,
      input,
      correlationId: randomUUID(),
    });
    assert(
      replay.ok &&
        replay.value.buildRunId === initialized.value.buildRunId &&
        replay.value.replayed,
      "Duplicate CI run was not idempotent",
    );
    const before = await useCases.gate({ ...scope, input: completionInput });
    assert(
      before.ok && before.value.verdict.state === "pending",
      "Gate must stay pending before processing",
    );
    const queue = {
      dueOrganizationIds: () => Promise.resolve([ids.organization]),
      claim: repository.claim.bind(repository),
      checkpoint: repository.checkpoint.bind(repository),
      completeWithValidation:
        repository.completeWithValidation.bind(repository),
      fail: repository.fail.bind(repository),
      beginNormalization: repository.beginNormalization.bind(repository),
      persistNormalizationBatch:
        repository.persistNormalizationBatch.bind(repository),
      finalizeNormalization: repository.finalizeNormalization.bind(repository),
    };
    await new SbomIngestWorker({
      workerId: randomUUID(),
      leaseSeconds: 60,
      queue,
      storage,
    }).runOnce();
    const { data: job, error: jobError } = await admin
      .from("sbom_ingest_jobs")
      .select("status")
      .eq("organization_id", ids.organization)
      .eq("id", completed.value.job.id)
      .single();
    assert(
      !jobError && job?.status === "completed",
      "M3 processing did not complete",
    );
    const { data: matchingJobs, error: matchingError } = await admin
      .from("vulnerability_match_jobs")
      .select("id,status")
      .eq("organization_id", ids.organization)
      .limit(2);
    assert(
      !matchingError && matchingJobs.length === 1,
      "M3 processing did not schedule one matching job",
    );
    const matchingJob = matchingJobs[0];
    assert(matchingJob, "Scheduled matching job is missing");
    const matchingRepository = new SupabaseVulnerabilityMatchingRepository(
      supabase,
    );
    const matchingQueue = {
      dueOrganizationIds: () => Promise.resolve([ids.organization]),
      claim: trace("claim", matchingRepository.claim.bind(matchingRepository)),
      readComponentPage: trace(
        "readComponentPage",
        matchingRepository.readComponentPage.bind(matchingRepository),
      ),
      findCandidates: trace(
        "findCandidates",
        matchingRepository.findCandidates.bind(matchingRepository),
      ),
      findCsafCandidates: trace(
        "findCsafCandidates",
        matchingRepository.findCsafCandidates.bind(matchingRepository),
      ),
      findCpeCandidates: trace(
        "findCpeCandidates",
        matchingRepository.findCpeCandidates.bind(matchingRepository),
      ),
      findCsafCpeCandidates: trace(
        "findCsafCpeCandidates",
        matchingRepository.findCsafCpeCandidates.bind(matchingRepository),
      ),
      persistPage: trace(
        "persistPage",
        matchingRepository.persistPage.bind(matchingRepository),
      ),
      fail: trace("fail", matchingRepository.fail.bind(matchingRepository)),
    };
    await new VulnerabilityMatchingWorker({
      workerId: randomUUID(),
      leaseSeconds: 90,
      pageSize: 250,
      queue: matchingQueue,
    }).runOnce();
    const { data: matchedJob, error: matchedError } = await admin
      .from("vulnerability_match_jobs")
      .select("status,last_error_code")
      .eq("organization_id", ids.organization)
      .eq("id", matchingJob.id)
      .single();
    assert(
      !matchedError && matchedJob?.status === "completed",
      `Matching did not complete: ${matchedJob?.status ?? "missing"} ${matchedJob?.last_error_code ?? ""}`,
    );
    const after = await useCases.gate({ ...scope, input: completionInput });
    assert(
      after.ok && after.value.verdict.state === "policy_not_configured",
      `Gate returned an unexpected verdict: ${after.ok ? after.value.verdict.state : after.error.code}`,
    );
    const runs = await repository.listBuildRuns(
      ids.organization,
      ids.binding,
      20,
    );
    assert(
      runs.length === 1 &&
        runs[0]?.sourceId === initialized.value.reservation.id &&
        runs[0]?.jobId === completed.value.job.id &&
        runs[0]?.state === "policy_not_configured",
      "Owner run summary does not match source/job/verdict",
    );
    await measureGateReads({
      token: `${credentialPrefix}.${credentialSecret}`,
      bindingId: ids.binding,
      runId: "789",
      runAttempt: "1",
    });
    const substituted = await useCases.initializeBuildUpload({
      ...scope,
      organizationId: randomUUID(),
      input,
      correlationId: randomUUID(),
    });
    assert(
      !substituted.ok && substituted.error.code === "not_found",
      "Tenant substitution was accepted",
    );
    console.log(
      `M11-04 local CI simulator passed: upload -> ${job.status} -> match ${matchedJob.status} -> ${after.value.verdict.state}; duplicate run stable; tenant substitution rejected`,
    );
  } finally {
    await cleanupFixture();
  }

  async function cleanupFixture() {
    const failures: Error[] = [];
    if (objectKey) {
      try {
        const { error } = await admin.storage
          .from("sbom-originals")
          .remove([objectKey]);
        if (error) throw new Error("Scoped CI fixture storage cleanup failed");
      } catch (error) {
        failures.push(error as Error);
      }
    }
    if (fixtureCreated) {
      try {
        localSql(
          `delete from public.organizations where id='${ids.organization}' and name='${fixtureName}';`,
        );
        const { data, error } = await admin
          .from("organizations")
          .select("id")
          .eq("id", ids.organization);
        assert(!error && data.length === 0, "Scoped CI fixture cleanup failed");
      } catch (error) {
        failures.push(error as Error);
      }
    }
    if (temporaryIndexCreated) {
      try {
        storageSql(
          "drop index storage.m1104_ci_live_storage_objects_name_bucket_tmp_idx;",
        );
        assert(
          localSql(
            "select indexname||'|'||indexdef from pg_indexes where schemaname='storage' and tablename='objects' order by indexname;",
          ) === storageIndexesBefore,
          "Local Storage index catalog was not restored",
        );
      } catch (error) {
        failures.push(error as Error);
      }
    }
    if (failures.length)
      throw new AggregateError(failures, "Scoped CI fixture cleanup failed");
  }
}

function localSql(sql: string): string {
  return execFileSync(
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
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      input: sql,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
    },
  ).trim();
}

function storageSql(sql: string): void {
  // The local Storage service owns storage.objects. Its in-container connection
  // avoids reading or printing its database credential in the test process.
  const code = `const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.query(process.argv[1])).then(()=>c.end()).catch(e=>{console.error(e.code||'storage sql failed');process.exitCode=1;void c.end()});`;
  execFileSync(
    "docker",
    ["exec", "supabase_storage_cra", "node", "-e", code, sql],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function trace<Args extends unknown[], Result>(
  name: string,
  action: (...args: Args) => Promise<Result>,
) {
  return async (...args: Args): Promise<Result> => {
    try {
      return await action(...args);
    } catch (error) {
      console.error(
        `Matching ${name} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  };
}

async function measureGateReads(
  input: Readonly<{
    token: string;
    bindingId: string;
    runId: string;
    runAttempt: string;
  }>,
) {
  const query = new URLSearchParams({
    bindingId: input.bindingId,
    runId: input.runId,
    runAttempt: input.runAttempt,
  });
  const endpoint = `http://127.0.0.1:3333/api/v1/ci/sbom-build-gate?${query.toString()}`;
  const sample = async (): Promise<number> => {
    const started = performance.now();
    const response = await fetch(endpoint, {
      headers: { authorization: `Bearer ${input.token}` },
      signal: AbortSignal.timeout(5000),
    });
    assert(
      response.status === 200,
      `CI gate HTTP read failed: ${response.status}`,
    );
    const body = ciBuildGateVerdictResponseSchema.parse(await response.json());
    assert(
      body.verdict.state === "policy_not_configured",
      "CI gate HTTP verdict changed",
    );
    return performance.now() - started;
  };
  await sample();
  await sample();
  const durations: number[] = [];
  for (let offset = 0; offset < 30; offset += 3)
    durations.push(...(await Promise.all([sample(), sample(), sample()])));
  durations.sort((left, right) => left - right);
  const p95 = durations[Math.ceil(0.95 * durations.length) - 1]!;
  const p99 = durations[Math.ceil(0.99 * durations.length) - 1]!;
  console.log(
    `M11-04 local HTTP gate read: n=30, concurrency=3, p95=${p95.toFixed(1)}ms (<400ms), p99=${p99.toFixed(1)}ms (<1000ms)`,
  );
  assert(
    p95 < 400 && p99 < 1000,
    "Local HTTP gate read exceeded the stated latency target",
  );
}

void run().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "M11-04 simulator failed",
  );
  process.exitCode = 1;
});
