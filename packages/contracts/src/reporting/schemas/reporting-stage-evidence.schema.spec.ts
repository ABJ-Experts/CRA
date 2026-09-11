import { describe, expect, it } from "vitest";

import {
  createReportingStageAcknowledgementInputSchema,
  generateReportingStageSubmissionPackageInputSchema,
  recordReportingStageExternalFilingFieldsSchema,
  reauthenticateReportingStageFilingInputSchema,
  reportingEvidencePublicVerificationKeySchema,
  reportingStageEvidencePackageSchema,
} from "./reporting-stage-evidence.schema";

const id = "11111111-1111-4111-8111-111111111111";
const laterId = "22222222-2222-4222-8222-222222222222";
const hash = "a".repeat(64);
const timestamp = "2026-09-10T09:20:00Z";

describe("reporting stage evidence contracts", () => {
  it("binds signed packages to an approved immutable draft snapshot", () => {
    expect(
      generateReportingStageSubmissionPackageInputSchema.parse({
        approvalId: id,
        draftRevision: 2,
        draftHash: hash,
        idempotencyKey: laterId,
      }),
    ).toHaveProperty("draftHash", hash);
    expect(
      reportingStageEvidencePackageSchema.parse({
        id,
        organizationId: laterId,
        obligationId: id,
        stageId: laterId,
        approvalId: id,
        draftRevision: 2,
        draftHash: hash,
        status: "ready",
        fileName: "cra-manual-submission.zip",
        byteLength: 1024,
        sha256: hash,
        manifestSha256: hash,
        signature: {
          algorithm: "Ed25519",
          keyId: "reporting-2026-09",
          detachedSignature: "s".repeat(86),
          publicKeyFingerprint: hash,
        },
        createdAt: timestamp,
        completedAt: timestamp,
        failureCode: null,
      }),
    ).toHaveProperty("signature.algorithm", "Ed25519");
  });

  it("does not allow filing metadata to stand in for a fresh action-bound proof or receipt", () => {
    expect(
      reauthenticateReportingStageFilingInputSchema.safeParse({
        packageId: id,
        password: "fresh-password",
        idempotencyKey: laterId,
      }).success,
    ).toBe(true);
    expect(
      recordReportingStageExternalFilingFieldsSchema.safeParse({
        packageId: id,
        filingReauthenticationProofId: laterId,
        submissionReference: "CRA-PORTAL-2026-0001",
        submittedAt: timestamp,
        submittedAtBasis: "Receipt from the regulator portal.",
        expectedStageVersion: 4,
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
      }).success,
    ).toBe(true);
    expect(
      recordReportingStageExternalFilingFieldsSchema.safeParse({
        packageId: id,
        filingReauthenticationProofId: laterId,
        submissionReference: "CRA-PORTAL-2026-0001",
        submittedAt: timestamp,
        submittedAtBasis: "Receipt from the regulator portal.",
        expectedStageVersion: 4,
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
        receipt: "a browser path is never trusted",
      }).success,
    ).toBe(false);
  });

  it("keeps acknowledgements append-only and makes public key metadata verification-only", () => {
    expect(
      createReportingStageAcknowledgementInputSchema.parse({
        submissionId: id,
        acknowledgedAt: timestamp,
        acknowledgementReference: "ACK-2026-001",
        acknowledgementBasis: "Authority acknowledgement received.",
        idempotencyKey: laterId,
      }),
    ).toHaveProperty("submissionId", id);
    expect(
      reportingEvidencePublicVerificationKeySchema.safeParse({
        keyId: "reporting-2026-09",
        algorithm: "Ed25519",
        publicKey:
          "MCowBQYDK2VwAyEA7f4cX9zOH6pZfx2WTqorM3BhiKDJ4wZQ4FQMvk11Pw0",
        fingerprint: hash,
        validFrom: timestamp,
        revokedAt: null,
        privateKey: "must never cross the contract boundary",
      }).success,
    ).toBe(false);
  });
});
