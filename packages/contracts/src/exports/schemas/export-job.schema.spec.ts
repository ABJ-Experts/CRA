import { describe, expect, it } from "vitest";
import {
  createReadinessExportSchema,
  exportArtifactSchema,
  exportDownloadGrantSchema,
  exportJobSchema,
  exportManifestSchema,
  exportReadinessReportSchema,
  exportMutationSchema,
} from "./export-job.schema.js";
const id = "e8a43815-631a-4363-9744-4dd067f49ab1";
const time = "2026-10-09T10:00:00Z";
const hash = "a".repeat(64);
const artifact = {
  id,
  name: "products.csv",
  mediaType: "text/csv",
  byteLength: 64,
  sha256: hash,
  rowCount: 1,
};
const job = {
  id,
  source: "products.registry",
  kind: "list",
  format: "csv",
  state: "ready",
  version: 1,
  requestedAt: time,
  snapshotAsOf: time,
  rowCount: 1,
  progress: { processedRows: 1, totalRows: 1 },
  artifacts: [artifact],
  expiresAt: time,
  failure: null,
};
describe("export response and delivery contracts", () => {
  it("exposes a parsed reproducibility manifest only for the matching ready job", () => {
    const manifest = {
      version: "m14_03_v1",
      jobId: id,
      source: job.source,
      requestedAt: time,
      snapshotAsOf: time,
      scope: "all_filtered",
      requestDigest: hash,
      rowCount: 1,
      columns: [{ key: "id", label: "ID", type: "text" }],
      artifacts: [artifact],
      sourceVersionsDigest: hash,
      documentationReadinessOnly: false,
    };
    expect(exportJobSchema.parse({ ...job, manifest }).manifest).toEqual(
      manifest,
    );
    expect(
      exportJobSchema.parse({ ...job, manifest: null }).manifest,
    ).toBeNull();
    expect(exportJobSchema.parse(job).manifest).toBeUndefined();
    for (const values of [
      { jobId: "e8a43815-631a-4363-9744-4dd067f49ab2" },
      { rowCount: 2 },
      { source: "evidence.documents" },
      { artifacts: [{ ...artifact, sha256: "b".repeat(64) }] },
      { objectPath: "private/storage/path" },
    ])
      expect(
        exportJobSchema.safeParse({
          ...job,
          manifest: { ...manifest, ...values },
        }).success,
      ).toBe(false);
    expect(
      exportJobSchema.safeParse({ ...job, state: "rendering", manifest })
        .success,
    ).toBe(false);
  });
  it("requires reproducibility and artifacts for ready jobs", () => {
    expect(exportJobSchema.parse(job)).toEqual(job);
    for (const values of [
      { artifacts: [] },
      { snapshotAsOf: null },
      { rowCount: null },
      { progress: { processedRows: 2, totalRows: 1 } },
      { artifacts: [artifact, artifact] },
    ])
      expect(exportJobSchema.safeParse({ ...job, ...values }).success).toBe(
        false,
      );
  });
  it("caps output parts and refuses unsafe names", () => {
    expect(
      exportArtifactSchema.safeParse({
        ...artifact,
        byteLength: 64 * 1024 * 1024 + 1,
      }).success,
    ).toBe(false);
    for (const name of ["../file.csv", "a\\b.csv", "a\n.csv"])
      expect(
        exportArtifactSchema.safeParse({ ...artifact, name }).success,
      ).toBe(false);
  });
  it("requires request identity and optimistic mutation versions", () => {
    expect(
      createReadinessExportSchema.parse({ productId: id, idempotencyKey: id }),
    ).toBeDefined();
    expect(exportMutationSchema.safeParse({ expectedVersion: 1 }).success).toBe(
      false,
    );
    expect(
      exportMutationSchema.parse({ expectedVersion: 1, idempotencyKey: id }),
    ).toBeDefined();
  });
  it("only accepts an API-local, bounded download grant", () => {
    const grant = {
      grantId: id,
      expiresAt: time,
      downloadPath: `/api/v1/exports/${id}/download/${id}`,
    };
    expect(exportDownloadGrantSchema.parse(grant)).toEqual(grant);
    for (const path of [
      "https://storage.example/path",
      "/api/v1/../secret",
      "/api/v1/a\\b",
      "/api/v1/a b",
    ])
      expect(
        exportDownloadGrantSchema.safeParse({ ...grant, downloadPath: path })
          .success,
      ).toBe(false);
  });
  it("keeps missing documentation and native validity states explicit", () => {
    const report = {
      version: "m14_03_v1",
      product: { id, name: "Product", version: 1 },
      snapshotAsOf: time,
      technicalFileVersion: 1,
      canonicalReadiness: null,
      evidence: [],
      degraded: true,
      notices: ["Restricted evidence omitted"],
      documentationReadinessOnly: true,
      sourceVersions: [],
    };
    expect(exportReadinessReportSchema.parse(report)).toEqual(report);
    expect(
      exportReadinessReportSchema.safeParse({
        ...report,
        documentationReadinessOnly: false,
      }).success,
    ).toBe(false);
    const evidence = {
      id,
      name: "Evidence",
      sourceKind: "evidence_document",
      sourceVersion: "1",
      validityStatus: "expired",
      validFrom: null,
      validUntil: time,
      stale: true,
      unavailable: false,
    };
    expect(
      exportReadinessReportSchema.parse({ ...report, evidence: [evidence] })
        .evidence[0]?.validityStatus,
    ).toBe("expired");
    expect(
      exportReadinessReportSchema.safeParse({
        ...report,
        evidence: [{ ...evidence, validityStatus: "valid" }],
      }).success,
    ).toBe(false);
  });
  it("publishes hashes and ordered source metadata without private storage keys", () => {
    const manifest = {
      version: "m14_03_v1",
      jobId: id,
      source: "products.registry",
      requestedAt: time,
      snapshotAsOf: time,
      scope: "all_filtered",
      requestDigest: hash,
      rowCount: 1,
      columns: [{ key: "id", label: "ID", type: "text" }],
      artifacts: [artifact],
      sourceVersionsDigest: hash,
      documentationReadinessOnly: false,
    };
    expect(exportManifestSchema.parse(manifest)).toEqual(manifest);
    expect(
      exportManifestSchema.safeParse({ ...manifest, storageKey: "private" })
        .success,
    ).toBe(false);
  });
});
