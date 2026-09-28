import { sbomValidationReportSchema } from "@repo/contracts/sboms";
import { z } from "zod";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { SbomStorageError } from "../infrastructure/supabase-sbom-storage.adapter";
import { SbomIngestWorker } from "./sbom-ingest-worker";
import { SbomValidationInfrastructureError } from "../validation/sbom-validator";

const organizationId = "11111111-1111-4111-8111-111111111111";
const jobId = "33333333-3333-4333-8333-333333333333";
function setup(
  text: string,
  declaredFormat: "cyclonedx" | "spdx" | null = null,
  extra: Partial<ConstructorParameters<typeof SbomIngestWorker>[0]> = {},
) {
  const bytes = Buffer.from(text);
  const queue = {
    dueOrganizationIds: jest.fn().mockResolvedValue([organizationId]),
    claim: jest
      .fn()
      .mockResolvedValueOnce({
        outcome: "claimed",
        organizationId,
        jobId,
        sourceId: jobId,
        objectKey: "unused-test-key",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteSize: bytes.length,
        mediaType: "application/json",
        fileName: "original",
        declaredFormat,
        declaredSpecVersion: null,
        retryCount: 0,
      })
      .mockResolvedValue({ outcome: "none_available" }),
    checkpoint: jest.fn().mockResolvedValue(undefined),
    completeWithValidation: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
    beginNormalization: jest
      .fn()
      .mockResolvedValue({ outcome: "ready", documentId: jobId }),
    persistNormalizationBatch: jest.fn().mockResolvedValue(undefined),
    finalizeNormalization: jest.fn().mockResolvedValue(undefined),
  };
  const openVerified = jest.fn().mockResolvedValue({
    outcome: "verified",
    stream: Readable.from([bytes]),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteSize: bytes.length,
    contentType: "application/json",
  });
  const worker = new SbomIngestWorker({
    workerId: "44444444-4444-4444-8444-444444444444",
    leaseSeconds: 60,
    queue,
    storage: { openVerified, readVerified: jest.fn() },
    ...extra,
  });
  return { queue, worker, openVerified };
}

describe("production streaming ingestion parity", () => {
  afterEach(() => jest.restoreAllMocks());
  it.each([
    { workerId: "invalid" },
    { leaseSeconds: 0 },
    { leaseSeconds: 3601 },
    { maximumBytes: 0 },
    { maximumBytes: 1.5 },
    { maximumComponents: 0 },
    { maximumComponents: 1.5 },
  ])("rejects invalid worker configuration %j", (extra) => {
    expect(() => setup("{}", null, extra)).toThrow(/invalid sbom/u);
  });
  it("records native validator outages as retryable provider failures", async () => {
    const { queue, worker } = setup(
      '{"bomFormat":"CycloneDX","specVersion":"1.6"}',
      null,
      {
        validateFile: async () => {
          await Promise.resolve();
          throw new SbomValidationInfrastructureError(
            "validator_unavailable",
            "provider unavailable",
          );
        },
      },
    );
    await worker.runOnce();
    expect(queue.fail).toHaveBeenCalledWith(
      organizationId,
      expect.objectContaining({ errorCode: "unavailable", retryable: true }),
    );
    expect(queue.completeWithValidation).not.toHaveBeenCalled();
  });
  it("refreshes lease while source, scan and schema passes are running", async () => {
    let now = 0;
    jest.spyOn(Date, "now").mockImplementation(() => {
      now += 20_000;
      return now;
    });
    const { queue, worker } = setup(
      '{"bomFormat":"CycloneDX","specVersion":"1.6","components":[{"type":"library","name":"ok"}]}',
    );
    await worker.runOnce();
    expect(queue.checkpoint.mock.calls.length).toBeGreaterThan(4);
    expect(queue.finalizeNormalization).toHaveBeenCalledTimes(1);
  });
  it("reports the configured byte ceiling without opening a graph", async () => {
    const { queue, worker } = setup(
      '{"bomFormat":"CycloneDX","specVersion":"1.6"}',
      null,
      { maximumBytes: 2, maximumComponents: 100 },
    );
    await worker.runOnce();
    expect(
      recordedReport(queue.completeWithValidation).diagnostics,
    ).toContainEqual(expect.objectContaining({ code: "byte_limit_exceeded" }));
    expect(queue.beginNormalization).not.toHaveBeenCalled();
  });
  it.each([
    "{}",
    '{"bomFormat":"CycloneDX","specVersion":"9.9","components":[{"name":"ok"}]}',
    '{"bomFormat":"CycloneDX","specVersion":"1.6","components":[{"type":"invented","name":"ok"}]}',
    '{"bomFormat":"CycloneDX",',
    '<!DOCTYPE bom [<!ENTITY ex SYSTEM "file:///etc/passwd">]><bom><name>&ex;</name></bom>',
  ])(
    "retains invalid reports without opening a partial graph: %s",
    async (text) => {
      const { queue, worker } = setup(text);
      await worker.runOnce();
      const report = recordedReport(queue.completeWithValidation);
      expect(report.status).toBe("invalid");
      expect(report.errorCount).toBeGreaterThan(0);
      expect(queue.beginNormalization).not.toHaveBeenCalled();
      expect(queue.finalizeNormalization).not.toHaveBeenCalled();
      expect(queue.fail).not.toHaveBeenCalled();
    },
  );
  it("checks pinned schemas and declared metadata before publishing a complete graph", async () => {
    const { queue, worker, openVerified } = setup(
      '{"bomFormat":"CycloneDX","specVersion":"1.6","components":[{"type":"library","bom-ref":"a","name":"ok"}]}',
      "spdx",
    );
    await worker.runOnce();
    expect(openVerified).toHaveBeenCalledTimes(1);
    const report = recordedReport(queue.beginNormalization);
    expect(report.status).toBe("valid_with_warnings");
    expect(report.validator?.schemaAssetSha256).not.toBe("0".repeat(64));
    expect(report.validator?.version).toBe("m3-03.2026-09-28.1");
    expect(queue.persistNormalizationBatch).toHaveBeenCalledTimes(1);
    expect(queue.finalizeNormalization).toHaveBeenCalledTimes(1);
  });
  it.each(["2.2", "2.3"])(
    "preserves canonical SPDX %s report metadata",
    async (version) => {
      const text = await readFile(
        join(__dirname, "../validation/fixtures", `spdx-${version}.json`),
        "utf8",
      );
      const { queue, worker } = setup(text);
      await worker.runOnce();
      expect(
        recordedReport(queue.beginNormalization).detected?.specificationVersion,
      ).toBe(version);
    },
  );
  it("rejects 101 SPDX referenced hashes before opening or persisting a graph", async () => {
    const hashes = Array.from({ length: 101 }, (_, i) => ({
      type: "Hash",
      spdxId: `urn:hash:${i}`,
      algorithm: "sha256",
      hashValue: "a".repeat(64),
    }));
    const { queue, worker } = setup(
      JSON.stringify({
        "@context": "https://spdx.org/rdf/3.0.1/spdx-context.jsonld",
        "@graph": [
          {
            type: "software_Package",
            spdxId: "urn:pkg:a",
            name: "a",
            verifiedUsing: hashes.map((hash) => hash.spdxId),
          },
          ...hashes,
        ],
      }),
    );
    await worker.runOnce();
    expect(
      recordedReport(queue.completeWithValidation).diagnostics.map(
        (item) => item.message,
      ),
    ).toContain(
      "SPDX verification references exceed the 100-hash normalized persistence limit.",
    );
    expect(recordedReport(queue.completeWithValidation).status).toBe("invalid");
    expect(queue.beginNormalization).not.toHaveBeenCalled();
    expect(queue.persistNormalizationBatch).not.toHaveBeenCalled();
    expect(queue.fail).not.toHaveBeenCalled();
  });
  it("retains schema-valid overlong content as invalid before creating a graph", async () => {
    const { queue, worker } = setup(
      JSON.stringify({
        bomFormat: "CycloneDX",
        specVersion: "1.6",
        components: [{ type: "library", name: "x".repeat(1025) }],
      }),
    );
    await worker.runOnce();
    expect(recordedReport(queue.completeWithValidation)).toMatchObject({
      status: "invalid",
      diagnostics: [
        {
          code: "schema_violation",
          message:
            "The SBOM exceeds the normalized persistence contract limits.",
        },
      ],
    });
    expect(queue.beginNormalization).not.toHaveBeenCalled();
    expect(queue.persistNormalizationBatch).not.toHaveBeenCalled();
    expect(queue.fail).not.toHaveBeenCalled();
  });
  it("leaves durable partial batches recoverable after a database outage", async () => {
    const { queue, worker } = setup(
      '{"bomFormat":"CycloneDX","specVersion":"1.6","components":[{"type":"library","bom-ref":"a","name":"ok"}]}',
    );
    queue.persistNormalizationBatch.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    await worker.runOnce();
    expect(queue.beginNormalization).toHaveBeenCalledTimes(1);
    expect(queue.finalizeNormalization).not.toHaveBeenCalled();
    expect(queue.completeWithValidation).not.toHaveBeenCalled();
    expect(queue.fail).not.toHaveBeenCalled();
  });
  it("does not publish or record a validation success after a corrupt source EOF", async () => {
    const { queue, worker, openVerified } = setup(
      '{"bomFormat":"CycloneDX","specVersion":"1.6"}',
    );
    openVerified.mockResolvedValueOnce({
      outcome: "verified",
      stream: Readable.from(
        (async function* () {
          await Promise.resolve();
          yield Buffer.from('{"bomFormat":"CycloneDX","specVersion":"1.6"}');
          throw new SbomStorageError("malformed");
        })(),
      ),
      sha256: "a".repeat(64),
      byteSize: 44,
      contentType: "application/json",
    });
    await worker.runOnce();
    expect(queue.fail).toHaveBeenCalledWith(
      organizationId,
      expect.objectContaining({
        errorCode: "content_hash_mismatch",
        retryable: false,
      }),
    );
    expect(queue.beginNormalization).not.toHaveBeenCalled();
    expect(queue.completeWithValidation).not.toHaveBeenCalled();
  });
  it.each(["missing", "hash_mismatch", "corrupt", "unavailable"])(
    "retains scoped storage outcome %s",
    async (outcome) => {
      const { queue, worker, openVerified } = setup("{}");
      openVerified.mockResolvedValueOnce({ outcome });
      await worker.runOnce();
      expect(queue.fail).toHaveBeenCalledWith(
        organizationId,
        expect.objectContaining({ retryable: outcome === "unavailable" }),
      );
      expect(queue.beginNormalization).not.toHaveBeenCalled();
    },
  );
  it.each([
    { outcome: "failed" },
    { outcome: "ready" },
    { outcome: "deferred", documentId: jobId },
  ])("handles durable begin outcome %j", async (outcome) => {
    const { queue, worker } = setup(
      '{"bomFormat":"CycloneDX","specVersion":"1.6"}',
    );
    queue.beginNormalization.mockResolvedValueOnce(outcome);
    await worker.runOnce();
    expect(queue.finalizeNormalization).not.toHaveBeenCalled();
    if (outcome.outcome === "deferred")
      expect(queue.fail).toHaveBeenCalledWith(
        organizationId,
        expect.objectContaining({ retryable: true }),
      );
  });
  it.each([
    Object.assign(new Error("database interrupted"), {
      code: "40001",
      providerCode: "postgres",
    }),
    "provider interrupted",
  ])("keeps failed database transitions recoverable", async (failure) => {
    const { queue, worker } = setup(
      '{"bomFormat":"CycloneDX","specVersion":"1.6"}',
    );
    queue.beginNormalization.mockRejectedValueOnce(failure);
    await worker.runOnce();
    expect(queue.completeWithValidation).not.toHaveBeenCalled();
    expect(queue.finalizeNormalization).not.toHaveBeenCalled();
  });
});

function recordedReport(mock: jest.Mock) {
  const calls: unknown[] = mock.mock.calls;
  const first = calls.at(0);
  const payload: unknown = Array.isArray(first) ? first[1] : undefined;
  return z.object({ report: sbomValidationReportSchema }).parse(payload).report;
}
