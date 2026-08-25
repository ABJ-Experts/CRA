import { SupabaseService } from "../../supabase/supabase.service";
import {
  sbomRequestDigest,
  SupabaseSbomRepository,
} from "./supabase-sbom.repository";

describe("sbomRequestDigest", () => {
  const input = {
    productId: "11111111-1111-4111-8111-111111111111",
    releaseId: "22222222-2222-4222-8222-222222222222",
    filename: "release.sbom.json",
    byteSize: 42,
    mediaType: "application/json",
    sha256: "a".repeat(64),
    source: "manual_upload" as const,
    idempotencyKey: "33333333-3333-4333-8333-333333333333",
  };

  it("is stable when server-generated correlation and verified identity change", () => {
    const firstInput = {
      ...input,
      // Deliberately excess values: the digest accepts and ignores these.
      correlationId: "44444444-4444-4444-8444-444444444444",
      organizationId: "55555555-5555-4555-8555-555555555555",
      actorId: "66666666-6666-4666-8666-666666666666",
    };
    const retriedInput = {
      ...input,
      correlationId: "77777777-7777-4777-8777-777777777777",
      organizationId: "88888888-8888-4888-8888-888888888888",
      actorId: "99999999-9999-4999-8999-999999999999",
    };
    const first = sbomRequestDigest(firstInput);
    const retried = sbomRequestDigest(retriedInput);

    expect(retried).toBe(first);
  });

  it("changes for a materially different client intake request", () => {
    expect(sbomRequestDigest({ ...input, byteSize: 43 })).not.toBe(
      sbomRequestDigest(input),
    );
  });
});

describe("SupabaseSbomRepository replay mapping", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const actorId = "22222222-2222-4222-8222-222222222222";
  const jobId = "33333333-3333-4333-8333-333333333333";
  const sourceId = "44444444-4444-4444-8444-444444444444";
  const input = {
    jobId,
    actorId,
    idempotencyKey: "55555555-5555-4555-8555-555555555555",
  };
  const job = {
    id: jobId,
    organizationId,
    releaseId: "66666666-6666-4666-8666-666666666666",
    sourceId,
    inputSha256: "a".repeat(64),
    correlationId: "77777777-7777-4777-8777-777777777777",
    status: "queued",
    progress: { stage: "queued", percent: 0, message: "Queued" },
    attempts: 0,
    maxAttempts: 5,
    error: null,
    result: null,
    createdAt: "2026-08-20T11:00:00.000Z",
    updatedAt: "2026-08-20T11:00:00.000Z",
    completedAt: null,
  };
  const subject = (row: Record<string, unknown>) =>
    new SupabaseSbomRepository({
      admin: () => ({
        rpc: () => Promise.resolve({ data: [row], error: null }),
      }),
    } as unknown as SupabaseService);

  it.each(["queued", "replayed"] as const)(
    "returns the job for %s replay outcomes",
    async (outcome) => {
      await expect(
        subject({ outcome, job }).replay(organizationId, input),
      ).resolves.toMatchObject({
        outcome,
        job: { id: jobId },
      });
    },
  );

  it.each(["invalid_state", "idempotency_mismatch"] as const)(
    "maps %s replay outcome to a stable conflict",
    async (outcome) => {
      await expect(
        subject({ outcome, job: null }).replay(organizationId, input),
      ).resolves.toEqual({
        outcome: "conflict",
      });
    },
  );
});

describe("SupabaseSbomRepository deduplicated completion", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const sourceId = "22222222-2222-4222-8222-222222222222";
  const jobId = "33333333-3333-4333-8333-333333333333";
  const actorId = "44444444-4444-4444-8444-444444444444";
  const rpc = jest.fn();
  const repository = () =>
    new SupabaseSbomRepository({
      admin: () => ({ rpc }),
    } as unknown as SupabaseService);

  beforeEach(() => rpc.mockReset());

  it("uses the atomic content-addressed finalizer and returns its canonical job", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "deduplicated", job: queuedJob() }],
      error: null,
    });

    await expect(
      repository().complete(organizationId, {
        sourceId,
        actorId,
        idempotencyKey: "55555555-5555-4555-8555-555555555555",
        actualHash: "a".repeat(64),
        actualByteSize: 42,
        actualMediaType: "application/json",
        correlationId: "66666666-6666-4666-8666-666666666666",
      }),
    ).resolves.toMatchObject({ outcome: "deduplicated", job: { id: jobId } });

    expect(rpc).toHaveBeenCalledWith(
      "finalize_sbom_source_deduplicated_atomic",
      {
        p_organization_id: organizationId,
        p_source_id: sourceId,
        p_actor_user_id: actorId,
        p_actor_credential_id: null,
        p_actual_sha256: "a".repeat(64),
        p_actual_byte_size: 42,
        p_actual_media_type: "application/json",
        p_idempotency_key: "55555555-5555-4555-8555-555555555555",
        p_correlation_id: "66666666-6666-4666-8666-666666666666",
      },
    );
  });

  function queuedJob() {
    return {
      id: jobId,
      organizationId,
      releaseId: "77777777-7777-4777-8777-777777777777",
      sourceId,
      inputSha256: "a".repeat(64),
      correlationId: "66666666-6666-4666-8666-666666666666",
      status: "queued",
      progress: { stage: "queued", percent: 0, message: "Queued" },
      attempts: 0,
      maxAttempts: 5,
      error: null,
      result: null,
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
      completedAt: null,
    };
  }
});

describe("SupabaseSbomRepository source diff lookup", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const actorId = "22222222-2222-4222-8222-222222222222";
  const sourceId = "33333333-3333-4333-8333-333333333333";
  const baselineSourceId = "44444444-4444-4444-8444-444444444444";
  const reportId = "55555555-5555-4555-8555-555555555555";
  const rpc = jest.fn();
  const repository = () =>
    new SupabaseSbomRepository({
      admin: () => ({ rpc }),
    } as unknown as SupabaseService);

  beforeEach(() => rpc.mockReset());

  it("returns a read-only not-started result for a valid comparable lineage", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          outcome: "not_started",
          result: { baselineSourceId },
        },
      ],
      error: null,
    });

    await expect(
      repository().getSourceDiff(organizationId, { actorId, sourceId }),
    ).resolves.toEqual({
      status: "not_started",
      sourceId,
      baselineSourceId,
    });
    expect(rpc).toHaveBeenCalledWith("get_sbom_source_diff_report", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_source_id: sourceId,
      p_baseline_source_id: null,
    });
  });

  it("parses explicit comparison status instead of inferring identical from a zero count", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          outcome: "found",
          report: diffReport(),
        },
      ],
      error: null,
    });

    await expect(
      repository().getSourceDiff(organizationId, {
        actorId,
        sourceId,
        baseSourceId: baselineSourceId,
      }),
    ).resolves.toMatchObject({
      status: "found",
      report: {
        id: reportId,
        comparisonStatus: "partial_integration_unavailable",
      },
    });
  });

  function diffReport() {
    return {
      id: reportId,
      sourceId,
      baselineSourceId,
      releaseId: "66666666-6666-4666-8666-666666666666",
      documentId: "77777777-7777-4777-8777-777777777777",
      baselineDocumentId: "88888888-8888-4888-8888-888888888888",
      state: "completed",
      comparisonStatus: "partial_integration_unavailable",
      comparatorVersion: "m4-unavailable.v1",
      findingDelta: { state: "partial_integration_unavailable" },
      counts: { componentChanges: 0 },
      progress: { stage: "completed", percent: 100 },
      error: null,
      completedAt: "2026-08-25T00:00:00.000Z",
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
    };
  }
});

describe("SupabaseSbomRepository validation persistence", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const actorId = "22222222-2222-4222-8222-222222222222";
  const productId = "33333333-3333-4333-8333-333333333333";
  const releaseId = "44444444-4444-4444-8444-444444444444";
  const sourceId = "55555555-5555-4555-8555-555555555555";
  const jobId = "66666666-6666-4666-8666-666666666666";
  const rpc = jest.fn();
  const repository = () =>
    new SupabaseSbomRepository({
      admin: () => ({ rpc }),
    } as unknown as SupabaseService);

  beforeEach(() => {
    rpc.mockReset();
  });

  it("atomically records validation and completes the legacy evidence job", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "completed", job: sbomJob("completed") }],
      error: null,
    });

    await expect(
      repository().completeWithValidation(organizationId, {
        jobId,
        workerId: "sbom-worker",
        report: validationReport("invalid"),
      }),
    ).resolves.toBeUndefined();

    expect(rpc).toHaveBeenCalledWith("record_sbom_validation_atomic", {
      p_organization_id: organizationId,
      p_job_id: jobId,
      p_worker_id: "sbom-worker",
      p_report: validationReport("invalid"),
    });
  });

  it("lists release sources with validation summaries from the org-scoped RPC", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          outcome: "found",
          sources: [
            {
              source: sbomSource(),
              validation: {
                status: "invalid",
                errorCount: 1,
                warningCount: 0,
                omittedDiagnosticCount: 0,
                completedAt: "2026-08-21T00:00:00.000Z",
              },
            },
          ],
          next_cursor: null,
        },
      ],
      error: null,
    });

    await expect(
      repository().listSourcesForRelease(organizationId, {
        actorId,
        productId,
        releaseId,
        limit: 25,
      }),
    ).resolves.toMatchObject({
      outcome: "found",
      response: {
        sources: [
          { source: { id: sourceId }, validation: { status: "invalid" } },
        ],
        nextCursor: null,
      },
    });
    expect(rpc).toHaveBeenCalledWith("list_sbom_sources_for_release", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_product_id: productId,
      p_release_id: releaseId,
      p_limit: 25,
      p_cursor: null,
    });
  });

  it("returns a parsed validation report without private storage fields", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          outcome: "found",
          source: sbomSource(),
          report: validationReport("valid_with_warnings"),
        },
      ],
      error: null,
    });

    await expect(
      repository().getValidationReport(organizationId, {
        actorId,
        sourceId,
      }),
    ).resolves.toMatchObject({
      outcome: "found",
      response: {
        source: { id: sourceId },
        report: { status: "valid_with_warnings" },
      },
    });
    expect(rpc).toHaveBeenCalledWith("get_sbom_validation_report", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_source_id: sourceId,
    });
  });

  function sbomSource() {
    return {
      id: sourceId,
      organizationId,
      productId,
      releaseId,
      source: "manual_upload",
      fileName: "release.sbom.json",
      mediaType: "application/json",
      byteSize: 42,
      sha256: "a".repeat(64),
      status: "verified",
      declaredFormat: "spdx",
      declaredSpecVersion: "2.3",
      createdAt: "2026-08-21T00:00:00.000Z",
      completedAt: "2026-08-21T00:00:00.000Z",
    };
  }

  function sbomJob(status: "processing" | "completed") {
    return {
      id: jobId,
      organizationId,
      releaseId,
      sourceId,
      inputSha256: "a".repeat(64),
      correlationId: "77777777-7777-4777-8777-777777777777",
      status,
      progress: {
        stage: status === "completed" ? "completed" : "recording_evidence",
        percent: status === "completed" ? 100 : 90,
        message:
          status === "completed"
            ? "Original evidence captured"
            : "Recording immutable original evidence",
      },
      attempts: 1,
      maxAttempts: 5,
      error: null,
      result:
        status === "completed"
          ? {
              outcome: "original_evidence_captured",
              sourceId,
              sha256: "a".repeat(64),
            }
          : null,
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
      completedAt: status === "completed" ? "2026-08-21T00:00:00.000Z" : null,
    };
  }
});

describe("SupabaseSbomRepository worker checkpoints", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const jobId = "22222222-2222-4222-8222-222222222222";
  const rpc = jest.fn();
  const repository = () =>
    new SupabaseSbomRepository({
      admin: () => ({ rpc }),
    } as unknown as SupabaseService);

  beforeEach(() => {
    rpc.mockReset();
  });

  it("requires the durable checkpoint RPC to accept the requested worker stage", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ outcome: "invalid_request", job: null }],
      error: null,
    });

    await expect(
      repository().checkpoint(organizationId, {
        jobId,
        workerId: "sbom-worker",
        stage: "parsing",
        percent: 30,
        message: "Streaming SBOM components",
      }),
    ).rejects.toThrow("unavailable");
  });

  it("maps a completed immutable-hash replay to a no-rewrite worker outcome", async () => {
    rpc.mockResolvedValueOnce({
      data: [
        {
          outcome: "replayed",
          document: {
            id: "33333333-3333-4333-8333-333333333333",
            state: "completed",
          },
        },
      ],
      error: null,
    });

    await expect(
      repository().beginNormalization(organizationId, {
        jobId,
        workerId: "sbom-worker",
        format: "cyclonedx",
        serialization: "json",
        specificationVersion: "1.6",
        report: validationReport("valid_with_warnings"),
      }),
    ).resolves.toEqual({
      outcome: "complete",
      documentId: "33333333-3333-4333-8333-333333333333",
    });
  });
});

describe("SupabaseSbomRepository normalized graph reads", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const actorId = "22222222-2222-4222-8222-222222222222";
  const documentId = "33333333-3333-4333-8333-333333333333";
  const rpc = jest.fn();
  const subject = () =>
    new SupabaseSbomRepository({
      admin: () => ({ rpc }),
    } as unknown as SupabaseService);
  const document = Object.freeze({
    id: documentId,
    sourceId: "44444444-4444-4444-8444-444444444444",
    format: "cyclonedx",
    specificationVersion: "1.6",
    parser: { name: "CRA streaming parser", version: "1.0.0" },
    normalizer: { name: "CRA SBOM normalizer", version: "1.0.0" },
    state: "completed",
    validationStatus: "valid",
    componentCount: 0,
    dependencyCount: 0,
    maximumDepth: 0,
    warningCount: 0,
    error: null,
    completedAt: "2026-08-24T00:00:00.000Z",
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
  });

  beforeEach(() => rpc.mockReset());

  it("parses only the completed document RPC envelope", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          outcome: "found",
          result: { documents: [document], nextCursor: null },
        },
      ],
      error: null,
    });

    await expect(
      subject().listDocuments(organizationId, {
        actorId,
        productId: "55555555-5555-4555-8555-555555555555",
        releaseId: "66666666-6666-4666-8666-666666666666",
        limit: 25,
      }),
    ).resolves.toEqual({ documents: [document], nextCursor: null });
    expect(rpc).toHaveBeenCalledWith("list_sbom_documents_for_release", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_product_id: "55555555-5555-4555-8555-555555555555",
      p_release_id: "66666666-6666-4666-8666-666666666666",
      p_limit: 25,
      p_cursor: null,
    });
  });

  it("treats a foreign document as absent before parsing its response", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "not_found", result: null }],
      error: null,
    });
    await expect(
      subject().searchComponents(organizationId, {
        actorId,
        documentId,
        limit: 50,
      }),
    ).resolves.toBeNull();
    expect(rpc).toHaveBeenCalledWith("search_sbom_components", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_document_id: documentId,
      p_q: null,
      p_limit: 50,
      p_cursor: null,
    });
  });
});

describe("SupabaseSbomRepository quality reads", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const actorId = "22222222-2222-4222-8222-222222222222";
  const sourceId = "33333333-3333-4333-8333-333333333333";
  const rpc = jest.fn();
  const subject = () =>
    new SupabaseSbomRepository({
      admin: () => ({ rpc }),
    } as unknown as SupabaseService);

  beforeEach(() => rpc.mockReset());

  it("reads a source-scoped quality report through the canonical contract", async () => {
    const report = qualityReport();
    rpc.mockResolvedValue({
      data: [{ outcome: "found", result: { report } }],
      error: null,
    });

    await expect(
      subject().getQualityReport(organizationId, { actorId, sourceId }),
    ).resolves.toEqual({ report });
    expect(rpc).toHaveBeenCalledWith("get_sbom_quality_report", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_source_id: sourceId,
    });
  });

  it("passes findings filters to the tenant-scoped quality RPC", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "found", result: { findings: [], nextCursor: null } }],
      error: null,
    });

    await expect(
      subject().listQualityFindings(organizationId, {
        actorId,
        sourceId,
        limit: 25,
        severity: "warning",
        kind: "bsi_rule",
      }),
    ).resolves.toEqual({ findings: [], nextCursor: null });
    expect(rpc).toHaveBeenCalledWith("list_sbom_quality_findings", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_source_id: sourceId,
      p_limit: 25,
      p_cursor: null,
      p_severity: "warning",
      p_kind: "bsi_rule",
    });
  });

  it("uses owner-scoped settings RPCs without trusting browser state", async () => {
    const result = {
      settings: {
        version: 2,
        bsiProfileEnabled: true,
        rulesetVersion: "bsi-tr-03183-2.v2.0.0",
        updatedAt: "2026-08-24T00:00:00.000Z",
      },
    };
    rpc.mockResolvedValueOnce({
      data: [{ outcome: "found", result }],
      error: null,
    });
    rpc.mockResolvedValueOnce({
      data: [{ outcome: "updated", result }],
      error: null,
    });

    await expect(
      subject().getQualitySettings(organizationId, { actorId }),
    ).resolves.toEqual(result);
    await expect(
      subject().updateQualitySettings(organizationId, {
        actorId,
        expectedVersion: 2,
        bsiProfileEnabled: true,
        idempotencyKey: "44444444-4444-4444-8444-444444444444",
      }),
    ).resolves.toEqual({ outcome: "updated", response: result });
    expect(rpc).toHaveBeenNthCalledWith(1, "get_sbom_quality_settings", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
    });
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "update_sbom_quality_settings_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_expected_version: 2,
        p_bsi_profile_enabled: true,
        p_idempotency_key: "44444444-4444-4444-8444-444444444444",
      },
    );
  });

  it("forwards supplier and license raw arrays in normalization batches", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "persisted" }],
      error: null,
    });

    await expect(
      subject().persistNormalizationBatch(organizationId, {
        jobId: "55555555-5555-4555-8555-555555555555",
        workerId: "sbom-worker",
        documentId: "66666666-6666-4666-8666-666666666666",
        diagnostics: [],
        sourceOffset: 0,
        batch: {
          edges: [],
          components: [
            {
              localRef: "pkg:one",
              rawName: "One",
              normalizedName: "one",
              rawVersion: "1.0.0",
              normalizedVersion: "1.0.0",
              rawPurl: null,
              canonicalPurl: null,
              rawCpe: null,
              ecosystem: "npm",
              scope: null,
              supplier: "Supplier One",
              supplierValues: ["Supplier One", "NOASSERTION"],
              licenseExpression: "MIT",
              licenseValues: ["MIT", "Apache-2.0"],
              hashes: [],
              source: { offset: 12, path: "$.components[0]", line: 3 },
            },
          ],
        },
      }),
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith(
      "persist_sbom_normalization_batch_atomic",
      expect.objectContaining({
        p_components: [
          expect.objectContaining({
            supplier_values: ["Supplier One", "NOASSERTION"],
            license_values: ["MIT", "Apache-2.0"],
          }),
        ],
      }),
    );
  });
});

function validationReport(status: "valid_with_warnings" | "invalid") {
  return {
    status,
    detected: {
      format: "spdx" as const,
      serialization: "json" as const,
      specificationVersion: "2.3",
    },
    validator: {
      name: "CRA deterministic SBOM validator",
      version: "m3-test",
      schemaAssetSha256: "a".repeat(64),
    },
    diagnostics: [
      {
        severity:
          status === "invalid" ? ("error" as const) : ("warning" as const),
        code: "declared_mismatch",
        location: "$",
        message: "The declared metadata differs from the detected SBOM.",
        remediation: "Update the declaration or upload the matching SBOM.",
      },
    ],
    errorCount: status === "invalid" ? 1 : 0,
    warningCount: status === "invalid" ? 0 : 1,
    omittedDiagnosticCount: 0,
    completedAt: "2026-08-21T00:00:00.000Z",
  };
}

function qualityReport() {
  const now = "2026-08-24T00:00:00.000Z";
  return {
    id: "77777777-7777-4777-8777-777777777777",
    sourceId: "33333333-3333-4333-8333-333333333333",
    releaseId: "88888888-8888-4888-8888-888888888888",
    documentId: "99999999-9999-4999-8999-999999999999",
    state: "completed",
    assessmentStatus: "valid",
    formulaVersion: "sbom-quality.v1",
    rulesetVersion: "bsi-tr-03183-2.v2.0.0",
    configurationVersion: 1,
    inputs: {
      componentCount: 0,
      componentsWithCanonicalPurl: 0,
      componentsWithValidHash: 0,
      componentsWithSupplier: 0,
      componentsWithLicense: 0,
      primaryComponentIdentified: false,
      primaryComponentDirectDependencyCount: 0,
      maximumDepth: 0,
    },
    dimensions: [
      {
        id: "purl",
        eligibleCount: 0,
        satisfiedCount: 0,
        coveragePercent: 0,
        score: 0,
        weight: 20,
        weightedScore: 0,
        status: "not_assessable",
      },
    ],
    totalScore: 0,
    bsiProfile: {
      enabled: false,
      status: "disabled",
      rulesetVersion: "bsi-tr-03183-2.v2.0.0",
      findingCount: 0,
    },
    baseline: { status: "first_document" },
    regression: {
      status: "none",
      totalScoreDelta: 0,
      changedDimensions: [],
    },
    progress: {
      stage: "completed",
      percent: 100,
      message: "Quality report completed.",
    },
    error: null,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}
