/**
 * Opt-in, local-only M9-05 API/worker smoke journey for the synthetic fixture.
 * Start `ollama-stub.mjs` first and use `node --env-file=apps/api/.env`
 * to load the local service key. This script restores the exact prior tenant
 * AI provider setting in `finally`, even if extraction fails.
 */
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const fixtureTitle = "M9-05 SYNTHETIC LOCAL TEST - NOT SUPPLIER EVIDENCE";
const apiOrigin = "http://127.0.0.1:3333";

function localEnvironment() {
  if (process.env.M9_05_ALLOW_LOCAL_FIXTURE !== "yes")
    throw new Error("M9_05_ALLOW_LOCAL_FIXTURE=yes is required");
  const raw = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!raw || !key) throw new Error("Local Supabase configuration is required");
  const url = new URL(raw);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.port !== "54321" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("Fixture is restricted to local Supabase port 54321");
  return { url: url.origin, key };
}

async function one(query, label) {
  const { data, error } = await query.single();
  if (error || !data)
    throw new Error(`${label}: ${error?.message ?? "not found"}`);
  return data;
}

async function jsonResponse(response, label) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  return payload;
}

async function runWorker() {
  await new Promise((resolve, reject) => {
    const worker = spawn(
      process.execPath,
      ["apps/api/dist/supplier-document-extraction-worker.js", "--once"],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          AI_OLLAMA_URL: "http://127.0.0.1:11439",
          AI_OLLAMA_MODEL: "m9-05-fixture:v1",
        },
      },
    );
    worker.once("error", reject);
    worker.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Worker exited ${code}`)),
    );
  });
}

function sqlLiteralUuid(value) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value,
    )
  )
    throw new Error("Invalid fixture UUID");
  return value;
}

function togglePolicy(organizationId, expected, next) {
  const allowed = new Set(["disabled", "ollama_local"]);
  if (!allowed.has(expected) || !allowed.has(next))
    throw new Error("Invalid fixture policy transition");
  // A pre-existing M9-04 CHECK helper has no service_role EXECUTE grant, so
  // the approved local DB-owner path is used solely for this exact-column CAS.
  const sql = `update public.organization_settings set supplier_document_ai_provider='${next}' where organization_id='${sqlLiteralUuid(organizationId)}' and supplier_document_ai_provider='${expected}' returning supplier_document_ai_provider`;
  const output = execFileSync(
    "docker",
    [
      "exec",
      "supabase_db_cra",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-AtX",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  if (!output.split("\n").includes(next))
    throw new Error(`Tenant AI policy CAS ${expected} to ${next} failed`);
}

async function latestFixture(db) {
  const row = await one(
    db
      .from("supplier_evidence_submissions")
      .select(
        `
        id,
        state,
        updated_at,
        request_id,
        evidence_version_id,
        declared_sha256,
        supplier_evidence_requests!inner(id,organization_id,product_id,version),
        evidence_document_versions!inner(id,title,processing_state,original_sha256)
      `,
      )
      .eq("state", "accepted")
      .eq("original_filename", "m9-05-synthetic-certificate.pdf")
      .eq("evidence_document_versions.title", fixtureTitle)
      .eq("evidence_document_versions.processing_state", "clean")
      .order("updated_at", { ascending: false })
      .limit(1),
    "Latest synthetic fixture",
  );
  const request = Array.isArray(row.supplier_evidence_requests)
    ? row.supplier_evidence_requests[0]
    : row.supplier_evidence_requests;
  const version = Array.isArray(row.evidence_document_versions)
    ? row.evidence_document_versions[0]
    : row.evidence_document_versions;
  if (!request || !version || row.evidence_version_id !== version.id)
    throw new Error("Synthetic fixture joins are inconsistent");
  if (version.original_sha256 !== row.declared_sha256)
    throw new Error("Synthetic fixture hash is inconsistent");
  return {
    organizationId: request.organization_id,
    productId: request.product_id,
    requestId: row.request_id,
    submissionId: row.id,
    requestVersion: request.version,
    submissionUpdatedAt: row.updated_at,
    versionId: row.evidence_version_id,
    sha256: row.declared_sha256,
  };
}

async function run() {
  const { url, key } = localEnvironment();
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const fixture = await latestFixture(db);
  const before = await one(
    db
      .from("organization_settings")
      .select("supplier_document_ai_provider,supplier_document_ai_residency")
      .eq("organization_id", fixture.organizationId),
    "Tenant AI policy",
  );
  if (
    before.supplier_document_ai_provider !== "disabled" ||
    before.supplier_document_ai_residency !== "local_only"
  )
    throw new Error(
      "Expected disabled local-only policy; refusing to overwrite it",
    );

  let changed = false;
  try {
    togglePolicy(fixture.organizationId, "disabled", "ollama_local");
    changed = true;
    const signedIn = await fetch(`${apiOrigin}/api/v1/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "owner@cra.test",
        password: "Password123",
        remember: false,
      }),
    });
    await jsonResponse(signedIn, "Owner sign-in");
    const cookie = signedIn.headers
      .getSetCookie()
      .map((part) => part.split(";", 1)[0])
      .find((part) => part.startsWith("cra_at="));
    if (!cookie) throw new Error("Owner access cookie was not returned");
    const endpoint = `${apiOrigin}/api/v1/supplier-evidence-requests/${fixture.requestId}/submissions/${fixture.submissionId}`;
    const initial = await fetch(
      `${endpoint}/extraction?productId=${fixture.productId}`,
      {
        headers: { cookie },
      },
    );
    let run = await jsonResponse(initial, "Read fixture extraction");
    if (run.run?.status !== "pending") {
      const started = await fetch(`${endpoint}/extraction-runs`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          productId: fixture.productId,
          expectedRequestVersion: fixture.requestVersion,
          expectedSubmissionUpdatedAt: fixture.submissionUpdatedAt,
          expectedEvidenceVersionId: fixture.versionId,
          expectedSha256: fixture.sha256,
          idempotencyKey: randomUUID(),
        }),
      });
      run = await jsonResponse(started, "Start extraction API");
      if (run.run?.status !== "pending")
        throw new Error(`Extraction did not queue: ${run.run?.status}`);
    }
    await runWorker();
    const read = await fetch(
      `${endpoint}/extraction?productId=${fixture.productId}`,
      {
        headers: { cookie },
      },
    );
    const result = await jsonResponse(read, "Read extraction API");
    if (
      result.run?.status !== "completed" ||
      result.suggestions?.length !== 2 ||
      !result.suggestions.every((field) =>
        result.pages.some(
          (page) =>
            page.page === field.sourceSpan?.page &&
            Array.from(page.text)
              .slice(field.sourceSpan.startOffset, field.sourceSpan.endOffset)
              .join("") === field.sourceSpan.quote,
        ),
      )
    )
      throw new Error(`Grounded extraction failed: ${result.run?.status}`);
    process.stdout.write(
      JSON.stringify({
        runId: result.run.id,
        status: result.run.status,
        candidateCount: result.suggestions.length,
        grounded: true,
      }) + "\n",
    );
  } finally {
    if (changed) {
      togglePolicy(
        fixture.organizationId,
        "ollama_local",
        before.supplier_document_ai_provider,
      );
      const restored = await one(
        db
          .from("organization_settings")
          .select(
            "supplier_document_ai_provider,supplier_document_ai_residency",
          )
          .eq("organization_id", fixture.organizationId),
        "Verify restored tenant AI policy",
      );
      if (
        restored.supplier_document_ai_provider !==
          before.supplier_document_ai_provider ||
        restored.supplier_document_ai_residency !==
          before.supplier_document_ai_residency
      )
        throw new Error(
          "Tenant AI policy restoration did not match prior value",
        );
      process.stdout.write("Tenant AI policy restored: disabled/local_only\n");
    }
  }
}

run().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Fixture failed"}\n`,
  );
  process.exitCode = 1;
});
