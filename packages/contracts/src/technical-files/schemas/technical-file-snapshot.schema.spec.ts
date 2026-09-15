import { describe, expect, it } from "vitest";

import {
  createTechnicalFileSnapshotRequestSchema,
  technicalFileSnapshotDownloadQuerySchema,
  technicalFileSnapshotArtifactSchema,
  technicalFileSnapshotExportSchema,
} from "./technical-file-snapshot.schema.js";

const id = "00000000-0000-4000-8000-000000000001";
const hash = "a".repeat(64);

describe("technical-file snapshot contract boundaries", () => {
  it("requires an active-release identifier for release snapshots", () => {
    expect(() =>
      createTechnicalFileSnapshotRequestSchema.parse({
        expectedTechnicalFileVersion: 3,
        purpose: "release",
        auditRationale: null,
        idempotencyKey: id,
      }),
    ).toThrow();
  });

  it("requires a bounded audit rationale and forbids a release link for audit snapshots", () => {
    expect(() =>
      createTechnicalFileSnapshotRequestSchema.parse({
        expectedTechnicalFileVersion: 3,
        purpose: "audit",
        releaseId: id,
        auditRationale: "",
        idempotencyKey: id,
      }),
    ).toThrow();
  });

  it("rejects unsafe artifact paths and uppercase or malformed SHA-256 values", () => {
    expect(() =>
      technicalFileSnapshotArtifactSchema.parse({
        kind: "pdf",
        fileName: "../technical-file.pdf",
        mimeType: "application/pdf",
        byteLength: 1024,
        sha256: hash.toUpperCase(),
        generatedAt: "2026-09-14T10:00:00.000Z",
      }),
    ).toThrow();
  });

  it("requires ready exports to contain PDF, archive, and manifest artifacts", () => {
    expect(() =>
      technicalFileSnapshotExportSchema.parse({
        id,
        snapshotId: id,
        status: "ready",
        failureCode: null,
        cancellationReason: null,
        artifacts: [],
        manifestSha256: hash,
        createdAt: "2026-09-14T10:00:00.000Z",
        startedAt: "2026-09-14T10:00:01.000Z",
        completedAt: "2026-09-14T10:00:02.000Z",
        idempotencyKey: id,
      }),
    ).toThrow();
  });

  it("accepts only an explicit PDF or archive download selector", () => {
    expect(technicalFileSnapshotDownloadQuerySchema.parse({ artifact: "pdf" })).toEqual({ artifact: "pdf" });
    expect(() => technicalFileSnapshotDownloadQuerySchema.parse({ artifact: "manifest" })).toThrow();
    expect(() => technicalFileSnapshotDownloadQuerySchema.parse({ artifact: "archive", unused: true })).toThrow();
  });
});
