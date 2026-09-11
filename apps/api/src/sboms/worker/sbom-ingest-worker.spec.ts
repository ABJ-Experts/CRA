import {
  SbomIngestWorker,
  type SbomIngestQueue,
  type SbomIngestStorage,
} from "./sbom-ingest-worker";
import {
  type normalizeSbomStream,
  type SbomNormalizationOptions,
} from "../normalization/sbom-normalizer";
import { SbomStorageError } from "../infrastructure/supabase-sbom-storage.adapter";
import { Readable } from "node:stream";

const orgA = "11111111-1111-4111-8111-111111111111";
const orgB = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";

describe("SbomIngestWorker", () => {
  const queue = {
    dueOrganizationIds: jest.fn(),
    claim: jest.fn(),
    checkpoint: jest.fn(),
    completeWithValidation: jest.fn(),
    fail: jest.fn(),
  };
  const storage = { readVerified: jest.fn() };
  const validate = jest.fn();

  beforeEach(() => jest.resetAllMocks());

  it("takes one job per tenant per round before a second from a busy tenant", async () => {
    queue.dueOrganizationIds.mockResolvedValue([orgA, orgB]);
    queue.claim
      .mockResolvedValueOnce(claim(orgA))
      .mockResolvedValueOnce(claim(orgB))
      .mockResolvedValue({ outcome: "none_available" });
    storage.readVerified.mockResolvedValue(verifiedBytes());
    validate.mockResolvedValue({
      outcome: "validated",
      report: report("valid"),
    });

    await subject().runOnce();

    expect(queue.claim).toHaveBeenNthCalledWith(1, orgA, expect.any(Object));
    expect(queue.claim).toHaveBeenNthCalledWith(2, orgB, expect.any(Object));
    expect(queue.claim).toHaveBeenNthCalledWith(3, orgA, expect.any(Object));
    expect(queue.claim).toHaveBeenNthCalledWith(4, orgB, expect.any(Object));
    expect(queue.completeWithValidation).toHaveBeenCalledTimes(2);
  });

  it("validates verified bytes and atomically completes legacy evidence with its report", async () => {
    queue.dueOrganizationIds.mockResolvedValue([orgA]);
    queue.claim
      .mockResolvedValueOnce({
        ...claim(orgA),
        fileName: "release.sbom.json",
        declaredFormat: "spdx",
        declaredSpecVersion: "2.3",
      })
      .mockResolvedValue({ outcome: "none_available" });
    storage.readVerified.mockResolvedValue(verifiedBytes());
    validate.mockResolvedValue({
      outcome: "validated",
      report: report("invalid"),
    });

    await subject().runOnce();

    expect(storage.readVerified).toHaveBeenCalledWith({
      objectKey: claim(orgA).objectKey,
      sha256: "a".repeat(64),
      byteSize: 12,
      contentType: "application/json",
    });
    expect(validate).toHaveBeenCalledWith({
      bytes: Buffer.from('{"spdxVersion":"SPDX-2.3"}'),
      fileName: "release.sbom.json",
      mediaType: "application/json",
      declaredFormat: "spdx",
      declaredSpecVersion: "2.3",
    });
    expect(queue.completeWithValidation).toHaveBeenCalledWith(orgA, {
      jobId,
      workerId: "44444444-4444-4444-8444-444444444444",
      report: report("invalid"),
    });
  });

  it("stamps the persisted report at the worker boundary without changing deterministic validation output", async () => {
    queue.dueOrganizationIds.mockResolvedValue([orgA]);
    queue.claim
      .mockResolvedValueOnce(claim(orgA))
      .mockResolvedValue({ outcome: "none_available" });
    storage.readVerified.mockResolvedValue(verifiedBytes());
    validate.mockResolvedValue({
      outcome: "validated",
      report: report("valid", "1970-01-01T00:00:00.000Z"),
    });

    await subject({
      now: () => new Date("2026-08-21T14:42:00.000Z"),
    }).runOnce();

    expect(queue.completeWithValidation).toHaveBeenCalledWith(orgA, {
      jobId,
      workerId: "44444444-4444-4444-8444-444444444444",
      report: report("valid", "2026-08-21T14:42:00.000Z"),
    });
  });

  it("leaves a claimed job restartable when terminal report persistence fails", async () => {
    queue.dueOrganizationIds.mockResolvedValue([orgA]);
    queue.claim
      .mockResolvedValueOnce(claim(orgA))
      .mockResolvedValue({ outcome: "none_available" });
    storage.readVerified.mockResolvedValue(verifiedBytes());
    validate.mockResolvedValue({
      outcome: "validated",
      report: report("valid"),
    });
    queue.completeWithValidation.mockRejectedValue(new Error("db unavailable"));

    await subject().runOnce();

    expect(queue.completeWithValidation).toHaveBeenCalledWith(orgA, {
      jobId,
      workerId: "44444444-4444-4444-8444-444444444444",
      report: report("valid"),
    });
    expect(queue.fail).not.toHaveBeenCalled();
  });

  it("persists a retryable storage outage rather than dropping a claimed job", async () => {
    queue.dueOrganizationIds.mockResolvedValue([orgA]);
    queue.claim
      .mockResolvedValueOnce(claim(orgA))
      .mockResolvedValue({ outcome: "none_available" });
    storage.readVerified.mockResolvedValue({ outcome: "unavailable" });

    await subject().runOnce();

    expect(queue.fail).toHaveBeenCalledWith(
      orgA,
      expect.objectContaining({
        jobId,
        retryable: true,
        errorCode: "unavailable",
      }),
    );
  });

  it("keeps validator infrastructure failures in the retry/dead-letter path", async () => {
    queue.dueOrganizationIds.mockResolvedValue([orgA]);
    queue.claim
      .mockResolvedValueOnce(claim(orgA))
      .mockResolvedValue({ outcome: "none_available" });
    storage.readVerified.mockResolvedValue(verifiedBytes());
    validate.mockResolvedValue({
      outcome: "unavailable",
      code: "validator_timeout",
      retryable: true,
      message: "SBOM validation worker timed out.",
    });

    await subject().runOnce();

    expect(queue.fail).toHaveBeenCalledWith(
      orgA,
      expect.objectContaining({
        jobId,
        retryable: true,
        errorCode: "unavailable",
      }),
    );
    expect(queue.completeWithValidation).not.toHaveBeenCalled();
  });

  it("streams durable normalization batches and exposes the graph only after finalization", async () => {
    const beginNormalization = jest.fn().mockResolvedValue({
      outcome: "ready",
      documentId: "77777777-7777-4777-8777-777777777777",
    });
    const persistNormalizationBatch = jest.fn().mockResolvedValue(undefined);
    const finalizeNormalization = jest.fn().mockResolvedValue(undefined);
    const normalizedQueue = {
      ...queue,
      beginNormalization,
      persistNormalizationBatch,
      finalizeNormalization,
    };
    queue.dueOrganizationIds.mockResolvedValue([orgA]);
    queue.claim
      .mockResolvedValueOnce(claim(orgA))
      .mockResolvedValue({ outcome: "none_available" });
    const openVerified = jest.fn().mockResolvedValue({
      outcome: "verified",
      stream: Readable.from([Buffer.from('{"bomFormat":"CycloneDX"}')]),
      sha256: "a".repeat(64),
      byteSize: 12,
      contentType: "application/json",
    });
    const normalize = jest
      .fn()
      .mockResolvedValueOnce(normalizedResult())
      .mockImplementationOnce(
        async (_stream: unknown, options: SbomNormalizationOptions) => {
          await options.onBatch?.({ components: [], edges: [] });
          return normalizedResult();
        },
      );

    await subject({
      queue: normalizedQueue,
      storage: { openVerified, readVerified: jest.fn() },
      normalize,
    }).runOnce();

    expect(openVerified).toHaveBeenCalledTimes(2);
    expect(beginNormalization).toHaveBeenCalledWith(
      orgA,
      expect.objectContaining({ format: "cyclonedx", serialization: "json" }),
    );
    expect(persistNormalizationBatch).toHaveBeenCalledWith(
      orgA,
      expect.objectContaining({
        documentId: "77777777-7777-4777-8777-777777777777",
      }),
    );
    expect(finalizeNormalization).toHaveBeenCalledWith(orgA, {
      jobId,
      workerId: "44444444-4444-4444-8444-444444444444",
      documentId: "77777777-7777-4777-8777-777777777777",
    });
  });

  it("preserves invalid evidence as a terminal validation report without opening a graph", async () => {
    const beginNormalization = jest.fn();
    const normalizedQueue = {
      ...queue,
      beginNormalization,
      persistNormalizationBatch: jest.fn(),
      finalizeNormalization: jest.fn(),
    };
    queue.dueOrganizationIds.mockResolvedValue([orgA]);
    queue.claim
      .mockResolvedValueOnce(claim(orgA))
      .mockResolvedValue({ outcome: "none_available" });
    const openVerified = jest.fn().mockResolvedValue({
      outcome: "verified",
      stream: Readable.from([Buffer.from('{"bomFormat":"CycloneDX"}')]),
      sha256: "a".repeat(64),
      byteSize: 12,
      contentType: "application/json",
    });
    const normalize = jest.fn().mockResolvedValue({
      ...normalizedResult(),
      diagnostics: [
        {
          severity: "error" as const,
          code: "missing_component_name",
          message: "A package or component name is required.",
          source: { offset: 0, path: "$.components", line: null },
        },
      ],
    });

    await subject({
      queue: normalizedQueue,
      storage: { openVerified, readVerified: jest.fn() },
      normalize,
    }).runOnce();

    expect(queue.completeWithValidation).toHaveBeenCalledWith(
      orgA,
      expect.objectContaining({
        jobId,
      }),
    );
    expect(beginNormalization).not.toHaveBeenCalled();
    expect(openVerified).toHaveBeenCalledTimes(1);
  });

  it("does not rewrite batches when the immutable document hash already completed", async () => {
    const beginNormalization = jest.fn().mockResolvedValue({
      outcome: "complete",
      documentId: "77777777-7777-4777-8777-777777777777",
    });
    const persistNormalizationBatch = jest.fn();
    const finalizeNormalization = jest.fn();
    const normalizedQueue = {
      ...queue,
      beginNormalization,
      persistNormalizationBatch,
      finalizeNormalization,
    };
    queue.dueOrganizationIds.mockResolvedValue([orgA]);
    queue.claim
      .mockResolvedValueOnce(claim(orgA))
      .mockResolvedValue({ outcome: "none_available" });
    const openVerified = jest.fn().mockResolvedValue({
      outcome: "verified",
      stream: Readable.from([Buffer.from('{"bomFormat":"CycloneDX"}')]),
      sha256: "a".repeat(64),
      byteSize: 12,
      contentType: "application/json",
    });
    const normalize = jest.fn().mockResolvedValue(normalizedResult());

    await subject({
      queue: normalizedQueue,
      storage: { openVerified, readVerified: jest.fn() },
      normalize,
    }).runOnce();

    expect(openVerified).toHaveBeenCalledTimes(1);
    expect(normalize).toHaveBeenCalledTimes(1);
    expect(persistNormalizationBatch).not.toHaveBeenCalled();
    expect(finalizeNormalization).not.toHaveBeenCalled();
  });

  it("marks a stream integrity failure terminally instead of leaving corrupt evidence leased", async () => {
    const beginNormalization = jest.fn().mockResolvedValue({
      outcome: "ready",
      documentId: "77777777-7777-4777-8777-777777777777",
    });
    queue.dueOrganizationIds.mockResolvedValue([orgA]);
    queue.claim
      .mockResolvedValueOnce(claim(orgA))
      .mockResolvedValue({ outcome: "none_available" });
    const openVerified = jest.fn().mockResolvedValueOnce({
      outcome: "verified",
      stream: Readable.from([Buffer.from('{"bomFormat":"CycloneDX"}')]),
      sha256: "a".repeat(64),
      byteSize: 12,
      contentType: "application/json",
    });
    const normalize = jest
      .fn()
      .mockRejectedValue(new SbomStorageError("malformed"));

    await subject({
      queue: {
        ...queue,
        beginNormalization,
        persistNormalizationBatch: jest.fn(),
        finalizeNormalization: jest.fn(),
      },
      storage: { openVerified, readVerified: jest.fn() },
      normalize,
    }).runOnce();

    expect(queue.fail).toHaveBeenCalledWith(
      orgA,
      expect.objectContaining({
        errorCode: "content_hash_mismatch",
        retryable: false,
      }),
    );
    expect(beginNormalization).not.toHaveBeenCalled();
  });

  function subject(
    options: Readonly<{
      now?: () => Date;
      queue?: SbomIngestQueue;
      storage?: SbomIngestStorage;
      normalize?: typeof normalizeSbomStream;
    }> = {},
  ) {
    return new SbomIngestWorker({
      workerId: "44444444-4444-4444-8444-444444444444",
      leaseSeconds: 60,
      queue: options.queue ?? queue,
      storage: options.storage ?? storage,
      validate,
      now: () => new Date("2026-08-21T00:00:00.000Z"),
      ...options,
    });
  }
});

function claim(organizationId: string) {
  return {
    outcome: "claimed" as const,
    organizationId,
    jobId,
    sourceId: "55555555-5555-4555-8555-555555555555",
    objectKey: `${organizationId}/source/a`.replace(/a$/, "a".repeat(64)),
    sha256: "a".repeat(64),
    byteSize: 12,
    mediaType: "application/json",
    fileName: "release.sbom.json",
    declaredFormat: null,
    declaredSpecVersion: null,
    retryCount: 0,
  };
}

function verifiedBytes() {
  return {
    outcome: "verified" as const,
    bytes: Buffer.from('{"spdxVersion":"SPDX-2.3"}'),
    sha256: "a".repeat(64),
    byteSize: 12,
    contentType: "application/json",
  };
}

function report(
  status: "valid" | "invalid",
  completedAt = "2026-08-21T00:00:00.000Z",
) {
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
    diagnostics:
      status === "invalid"
        ? [
            {
              severity: "error" as const,
              code: "missing_required_field",
              location: "$",
              message: "The SBOM is missing a required field.",
              remediation: "Add the required SPDX field.",
            },
          ]
        : [],
    errorCount: status === "invalid" ? 1 : 0,
    warningCount: 0,
    omittedDiagnosticCount: 0,
    completedAt,
  };
}

function normalizedResult() {
  return {
    format: "cyclonedx-json" as const,
    specVersion: "1.6",
    components: [],
    edges: [],
    diagnostics: [],
    byteSize: 12,
  };
}
