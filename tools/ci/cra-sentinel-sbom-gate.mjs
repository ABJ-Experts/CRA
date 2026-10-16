#!/usr/bin/env node
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { readFile } from "node:fs/promises";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const optional = (name) => process.env[name]?.trim() || undefined;
const mode = required("CRA_SENTINEL_MODE");
if (mode !== "upload" && mode !== "gate") {
  throw new Error("CRA_SENTINEL_MODE must be upload or gate");
}

const apiOrigin = required("CRA_SENTINEL_API_ORIGIN").replace(/\/$/, "");
const origin = new URL(apiOrigin);
if (
  origin.protocol !== "https:" &&
  !(
    origin.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(origin.hostname)
  )
) {
  throw new Error(
    "CRA_SENTINEL_API_ORIGIN must use HTTPS outside local development",
  );
}
const token = required("CRA_SENTINEL_CI_TOKEN");
const bindingId = required("CRA_SENTINEL_BINDING_ID");
const runId = required("CRA_SENTINEL_RUN_ID");
const runAttempt = required("CRA_SENTINEL_RUN_ATTEMPT");

if (mode === "upload") {
  const sbomPath = required("CRA_SENTINEL_SBOM_PATH");
  const bytes = await readFile(sbomPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const fileName =
    optional("CRA_SENTINEL_SBOM_FILE_NAME") ?? basename(sbomPath);
  const mediaType =
    optional("CRA_SENTINEL_SBOM_MEDIA_TYPE") ?? inferMediaType(fileName);
  const idempotencyKey =
    optional("CRA_SENTINEL_IDEMPOTENCY_KEY") ??
    stableUuid([bindingId, runId, runAttempt, sha256]);
  const initialization = await jsonRequest(
    "POST",
    "/api/v1/ci/sbom-build-uploads",
    {
      bindingId,
      runId,
      runAttempt,
      fileName,
      mediaType,
      byteSize: bytes.byteLength,
      sha256,
      ...(optional("CRA_SENTINEL_DECLARED_FORMAT")
        ? { declaredFormat: optional("CRA_SENTINEL_DECLARED_FORMAT") }
        : {}),
      ...(optional("CRA_SENTINEL_DECLARED_SPEC_VERSION")
        ? {
            declaredSpecVersion: optional("CRA_SENTINEL_DECLARED_SPEC_VERSION"),
          }
        : {}),
      idempotencyKey,
    },
  );
  if (initialization.upload?.uploadUrl) {
    const upload = await fetch(initialization.upload.uploadUrl, {
      method: "PUT",
      headers: { "content-type": mediaType },
      body: bytes,
      signal: AbortSignal.timeout(60_000),
    });
    if (!upload.ok)
      throw new Error(`SBOM storage upload failed with HTTP ${upload.status}`);
  }
  if (!initialization.source?.id)
    throw new Error("CRA Sentinel did not return a source identifier");
  const completion = await jsonRequest(
    "POST",
    `/api/v1/ci/sbom-build-uploads/${encodeURIComponent(initialization.source.id)}/complete`,
    { bindingId, runId, runAttempt, idempotencyKey },
  );
  console.log(
    `SBOM upload accepted: source ${initialization.source.id}, job ${completion.job?.id ?? "pending"}. Gate status is separate.`,
  );
} else {
  const attempts = boundedInteger("CRA_SENTINEL_GATE_ATTEMPTS", 20, 1, 100);
  const delayMs = boundedInteger("CRA_SENTINEL_GATE_DELAY_MS", 3000, 0, 60_000);
  const query = new URLSearchParams({ bindingId, runId });
  query.set("runAttempt", runAttempt);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await jsonRequest(
      "GET",
      `/api/v1/ci/sbom-build-gate?${query}`,
    );
    const verdict = response.verdict;
    console.log(
      `CRA Sentinel status ${verdict?.state ?? "unavailable"}: ${verdict?.message ?? "No verdict returned"}`,
    );
    if (
      verdict?.state === "error" ||
      verdict?.state === "policy_not_configured"
    ) {
      throw new Error("CRA Sentinel has no passing build policy verdict");
    }
    if (verdict?.state !== "pending")
      throw new Error("CRA Sentinel returned an unsupported build status");
    if (attempt < attempts)
      await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(
    "CRA Sentinel build status remained pending after the polling window",
  );
}

async function jsonRequest(method, path, body) {
  const response = await fetch(`${apiOrigin}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      `CRA Sentinel returned an invalid response (HTTP ${response.status})`,
    );
  }
  if (!response.ok)
    throw new Error(
      `CRA Sentinel request failed: ${payload?.message ?? `HTTP ${response.status}`}`,
    );
  return payload;
}

function inferMediaType(name) {
  if (name.endsWith(".cdx.json")) return "application/vnd.cyclonedx+json";
  if (name.endsWith(".cdx.xml")) return "application/vnd.cyclonedx+xml";
  if (name.endsWith(".spdx.json")) return "application/spdx+json";
  if (name.endsWith(".spdx.xml")) return "application/spdx+xml";
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".xml")) return "application/xml";
  return "application/octet-stream";
}

function stableUuid(parts) {
  const hex = createHash("sha256").update(parts.join("\0")).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function boundedInteger(name, fallback, minimum, maximum) {
  const value = Number(optional(name) ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}
