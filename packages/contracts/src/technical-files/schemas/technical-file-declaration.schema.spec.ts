import { describe, expect, it } from "vitest";

import {
  createTechnicalFileDeclarationDraftRequestSchema,
  issueTechnicalFileDeclarationRequestSchema,
  technicalFileDeclarationSchema,
} from "./technical-file-declaration.schema.js";

const id = "00000000-0000-4000-8000-000000000001";
const hash = "a".repeat(64);

describe("technical-file declaration contract boundaries", () => {
  it("requires notified-body details and a certificate reference for notified-body routes", () => {
    expect(() =>
      createTechnicalFileDeclarationDraftRequestSchema.parse({
        snapshotId: id,
        expectedVersion: 1,
        signatoryCapacity: "Chief compliance officer",
        signatoryPlace: "Brussels",
        assessmentRoute: "eu_type_examination",
        idempotencyKey: id,
      }),
    ).toThrow();
  });

  it("does not require V2 assessment data for a V1 declaration", () => {
    expect(
      createTechnicalFileDeclarationDraftRequestSchema.parse({
        snapshotId: id,
        expectedVersion: 1,
        signatoryCapacity: "Chief compliance officer",
        signatoryPlace: "Brussels",
        idempotencyKey: id,
      }),
    ).toMatchObject({ assessmentRoute: null });
  });

  it("requires a real place of issue rather than an adapter default", () => {
    expect(() =>
      createTechnicalFileDeclarationDraftRequestSchema.parse({
        snapshotId: id,
        expectedVersion: 1,
        signatoryCapacity: "Chief compliance officer",
        idempotencyKey: id,
      }),
    ).toThrow();
  });

  it("requires an explicit confirmation and exact immutable preview binding before issue", () => {
    expect(() =>
      issueTechnicalFileDeclarationRequestSchema.parse({
        expectedVersion: 1,
        previewDigest: hash,
        snapshotSha256: hash,
        confirmIssue: false,
        idempotencyKey: id,
      }),
    ).toThrow();
  });

  it("does not allow a draft to contain issued artifact metadata", () => {
    expect(() =>
      technicalFileDeclarationSchema.parse({
        id,
        organizationId: id,
        productId: id,
        snapshotId: id,
        templateId: id,
        version: 1,
        draftVersion: 1,
        status: "draft",
        signatory: { userId: id, name: "Alex Example", capacity: "Officer" },
        assessmentRoute: "internal_control",
        notifiedBody: null,
        certificateReferences: [],
        sourceProvenance: [],
        missingFacts: [],
        previewDigest: hash,
        snapshotSha256: hash,
        issuedPayload: null,
        issuedArtifact: {
          fileName: "declaration.pdf",
          mimeType: "application/pdf",
          byteLength: 1,
          sha256: hash,
        },
        issuedAt: null,
        supersededByDeclarationId: null,
        supersedesDeclarationId: null,
        reissueReason: null,
        createdAt: "2026-09-15T00:00:00.000Z",
        updatedAt: "2026-09-15T00:00:00.000Z",
      }),
    ).toThrow();
  });
});
