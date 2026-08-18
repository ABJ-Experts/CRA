import { describe, expect, it } from "vitest";

import {
  createSubstantialModificationAssessmentDraftInputSchema,
  createSubstantialModificationAssessmentInputSchema,
  externalReferenceCandidateSchema,
  publishSecurityUpdateArtifactInputSchema,
  reserveSecurityUpdateArtifactInputSchema,
  securityUpdateArtifactUploadReservationSchema,
  securityUpdateArtifactReserveResponseSchema,
  securityUpdateArtifactSchema,
  substantialModificationAssessmentSchema,
  substantialModificationEvidenceReferenceSchema,
  utcZDateTimeSchema,
} from "./index.js";

const id = "11111111-1111-4111-8111-111111111111";
const releaseId = "22222222-2222-4222-8222-222222222222";
const now = "2026-08-17T12:00:00.000Z";

describe("M2 V2 substantial-modification contracts", () => {
  it("allows a minimal in-progress draft without pretending it is reviewable", () => {
    expect(
      createSubstantialModificationAssessmentDraftInputSchema.parse({
        policyVersion: "m2.v2.substantial-modification.v1",
        completenessState: "in_progress",
        title: "Draft secure-boot change",
        idempotencyKey: id,
      }),
    ).toMatchObject({ completenessState: "in_progress" });
  });

  it("keeps policy suggestion absent until a draft has all five answers", () => {
    expect(
      substantialModificationAssessmentSchema.parse({
        id,
        organizationId: "33333333-3333-4333-8333-333333333333",
        productId: "44444444-4444-4444-8444-444444444444",
        modificationId: "55555555-5555-4555-8555-555555555555",
        supersedesId: null,
        modificationIdentifier: null,
        title: "Draft secure-boot change",
        description: null,
        technicalScope: null,
        introducedAt: null,
        detectedOrAssessedAt: null,
        previousState: null,
        resultingState: null,
        requiredFollowUpActions: null,
        completenessState: "in_progress",
        releaseIds: [],
        policyVersion: "m2.v2.substantial-modification.v1",
        answers: {
          changesIntendedPurpose: null,
          changesSecurityArchitectureOrTrustBoundary: null,
          changesNetworkInterfaceOrPrivilegedRemoteControl: null,
          changesCryptographyOrIdentityAccessControl: null,
          changesSafetyOrSecurityRelevantComponent: null,
        },
        rationale: null,
        evidenceReferences: [],
        suggestion: null,
        status: "in_progress",
        determination: null,
        determinationRationale: null,
        overrideReason: null,
        reviewedAt: null,
        reviewedBy: null,
        version: 0,
        createdAt: now,
        createdBy: id,
        updatedAt: now,
        updatedBy: id,
      }).suggestion,
    ).toBeNull();
  });

  it("requires all five versioned assessment answers and idempotency on creation", () => {
    expect(
      createSubstantialModificationAssessmentInputSchema.parse({
        releaseIds: [releaseId],
        policyVersion: "m2.v2.substantial-modification.v1",
        modificationIdentifier: "MOD-2026-0817",
        title: "Secure boot trust-anchor rotation",
        description: "Rotates the secure-boot trust anchor for the appliance.",
        technicalScope: "Boot chain verification and signing-key enrollment.",
        introducedAt: "2026-08-16T12:00:00.000Z",
        detectedOrAssessedAt: now,
        previousState: "The former trust anchor verifies boot payloads.",
        resultingState: "The rotated anchor verifies the same payload scope.",
        requiredFollowUpActions: ["Verify field deployment telemetry."],
        answers: {
          changesIntendedPurpose: "no",
          changesSecurityArchitectureOrTrustBoundary: "unknown",
          changesNetworkInterfaceOrPrivilegedRemoteControl: "no",
          changesCryptographyOrIdentityAccessControl: "no",
          changesSafetyOrSecurityRelevantComponent: "yes",
        },
        rationale: "Updated the authenticated safety component.",
        evidenceReferences: [],
        idempotencyKey: id,
      }).policyVersion,
    ).toBe("m2.v2.substantial-modification.v1");

    expect(
      createSubstantialModificationAssessmentInputSchema.safeParse({
        releaseIds: [releaseId],
        policyVersion: "m2.v2.substantial-modification.v1",
        answers: { changesIntendedPurpose: "no" },
        rationale: "Incomplete assessment.",
        evidenceReferences: [],
        idempotencyKey: id,
      }).success,
    ).toBe(false);
  });

  it("allows evidence only when it has a lowercase hash or credential-free HTTPS URI", () => {
    expect(
      substantialModificationEvidenceReferenceSchema.parse({
        id,
        title: "Threat model revision",
        sha256: "a".repeat(64),
      }),
    ).toMatchObject({ id });
    expect(
      substantialModificationEvidenceReferenceSchema.parse({
        id,
        title: "Published advisory",
        uri: "https://example.test/advisories/123",
      }),
    ).toMatchObject({ id });
    expect(
      substantialModificationEvidenceReferenceSchema.safeParse({
        id,
        title: "Unverifiable",
      }).success,
    ).toBe(false);
    expect(
      substantialModificationEvidenceReferenceSchema.safeParse({
        id,
        title: "Insecure URI",
        uri: "http://example.test/evidence",
      }).success,
    ).toBe(false);
    expect(
      substantialModificationEvidenceReferenceSchema.safeParse({
        id,
        title: "Malformed URI",
        uri: "https://example.test:not-a-port/evidence",
      }).success,
    ).toBe(false);
    expect(
      externalReferenceCandidateSchema.safeParse({
        id,
        title: "Credentialed reference",
        uri: "https://user:password@example.test/update",
      }).success,
    ).toBe(false);
  });

  it("publishes from the immutable, already server-validated reservation source", () => {
    const candidate = {
      id,
      title: "Manufacturer update bulletin",
      uri: "https://updates.example.test/bulletins/2026-08",
    };
    expect(externalReferenceCandidateSchema.parse(candidate)).toEqual(
      candidate,
    );
    expect(
      publishSecurityUpdateArtifactInputSchema.parse({
        expectedVersion: 1,
        idempotencyKey: id,
      }),
    ).toMatchObject({ expectedVersion: 1 });
    expect(
      publishSecurityUpdateArtifactInputSchema.safeParse({
        externalReferenceCandidates: [candidate],
        serverValidationRequired: true,
        expectedVersion: 1,
        idempotencyKey: id,
      }).success,
    ).toBe(false);
  });

  it("requires a distribution kind and accepts only server-stamped external references at reservation", () => {
    const candidate = {
      id,
      title: "Manufacturer update package",
      uri: "https://updates.example.test/packages/2026-08.bin",
    };
    const reservation = {
      releaseId,
      updateVersion: "2026.08.17",
      title: "August security update",
      artifactType: "software_update",
      supportedPlatform: "CRA appliance v2",
      fileName: "security-update.bin",
      contentType: "application/octet-stream",
      byteSize: 1024,
      sha256: "b".repeat(64),
      issuedAt: now,
      idempotencyKey: id,
    };

    expect(
      reserveSecurityUpdateArtifactInputSchema.safeParse(reservation).success,
    ).toBe(false);
    expect(
      reserveSecurityUpdateArtifactInputSchema.safeParse({
        ...reservation,
        distributionKind: "external_reference",
        externalReferenceCandidates: [candidate],
      }).success,
    ).toBe(false);
    expect(
      reserveSecurityUpdateArtifactInputSchema.parse({
        ...reservation,
        distributionKind: "external_reference",
        externalReferenceCandidates: [candidate],
        serverValidationRequired: true,
      }).distributionKind,
    ).toBe("external_reference");
  });

  it("keeps stored artifact metadata URL-free while retaining availability and distribution facts", () => {
    const artifact = {
      id,
      organizationId: "33333333-3333-4333-8333-333333333333",
      productId: "44444444-4444-4444-8444-444444444444",
      releaseId,
      updateVersion: "2026.08.17",
      title: "August security update",
      artifactType: "software_update",
      supportedPlatform: "CRA appliance v2",
      signatureMetadata: {
        algorithm: "ES256",
        signer: "CRA release signing service",
        certificateSha256: "c".repeat(64),
      },
      fileName: "security-update.bin",
      contentType: "application/octet-stream",
      byteSize: 1024,
      sha256: "b".repeat(64),
      uploadStatus: "finalized",
      integrityStatus: "verified",
      reviewStatus: "cleared",
      publicationStatus: "published",
      availabilityStatus: "available",
      statusExplanation: null,
      issuedAt: now,
      supportPeriodId: "55555555-5555-4555-8555-555555555555",
      supportPeriodRevision: 2,
      supportEndsAt: "2030-08-17T12:00:00.000Z",
      availabilityRuleVersion: "m2.v2.security-update-availability.v1",
      issuedCandidate: "2036-08-17T12:00:00.000Z",
      supportCandidate: "2030-08-17T12:00:00.000Z",
      availabilityWinningRule: "issued_at_plus_10_calendar_years",
      computedAvailabilityUntil: "2036-08-17T12:00:00.000Z",
      availabilityUntil: "2036-08-17T12:00:00.000Z",
      nonReductionApplied: false,
      distributionKind: "authenticated_download",
      distributionReference: null,
      publishedExternalReferences: [],
      replacementArtifactId: null,
      withdrawnAt: null,
      withdrawnReason: null,
      version: 0,
      createdAt: now,
      createdBy: id,
      updatedAt: now,
      updatedBy: id,
    };
    expect(securityUpdateArtifactSchema.parse(artifact)).not.toHaveProperty(
      "downloadUrl",
    );
  });

  it("permits an unpublishable external draft with a server-validated source and no upload URL", () => {
    const draft = {
      id,
      organizationId: "33333333-3333-4333-8333-333333333333",
      productId: "44444444-4444-4444-8444-444444444444",
      releaseId,
      updateVersion: "2026.08.17",
      title: "August security update",
      artifactType: "software_update",
      supportedPlatform: "CRA appliance v2",
      signatureMetadata: null,
      fileName: "security-update.bin",
      contentType: "application/octet-stream",
      byteSize: 1024,
      sha256: "b".repeat(64),
      uploadStatus: "reserved",
      integrityStatus: "pending",
      reviewStatus: "pending_review",
      publicationStatus: "draft",
      availabilityStatus: "pending",
      statusExplanation: null,
      issuedAt: now,
      supportPeriodId: null,
      supportPeriodRevision: null,
      supportEndsAt: null,
      availabilityRuleVersion: "m2.v2.security-update-availability.v1",
      issuedCandidate: null,
      supportCandidate: null,
      availabilityWinningRule: null,
      computedAvailabilityUntil: null,
      availabilityUntil: null,
      nonReductionApplied: false,
      distributionKind: "external_reference",
      distributionReference: {
        id: "66666666-6666-4666-8666-666666666666",
        title: "Manufacturer update package",
        uri: "https://updates.example.test/packages/2026-08.bin",
        validationState: "validated_by_server",
        validatedAt: now,
      },
      publishedExternalReferences: [],
      replacementArtifactId: null,
      withdrawnAt: null,
      withdrawnReason: null,
      version: 0,
      createdAt: now,
      createdBy: id,
      updatedAt: now,
      updatedBy: id,
    };
    expect(securityUpdateArtifactSchema.parse(draft)).toMatchObject({
      distributionKind: "external_reference",
      distributionReference: expect.objectContaining({
        validationState: "validated_by_server",
      }),
    });
    expect(
      securityUpdateArtifactReserveResponseSchema.parse({
        artifact: draft,
        upload: null,
      }).upload,
    ).toBeNull();
  });

  it("allows loopback HTTP only for local signed Storage URLs", () => {
    expect(
      securityUpdateArtifactUploadReservationSchema.parse({
        uploadUrl:
          "http://127.0.0.1:54321/storage/v1/object/upload/security-update-artifacts/test",
        expiresAt: now,
      }).uploadUrl,
    ).toContain("127.0.0.1");
    expect(
      securityUpdateArtifactUploadReservationSchema.safeParse({
        uploadUrl: "http://storage.example.test/upload",
        expiresAt: now,
      }).success,
    ).toBe(false);
  });

  it("preserves a reviewer override reason in the immutable reviewed record", () => {
    expect(
      substantialModificationAssessmentSchema.parse({
        id,
        organizationId: "33333333-3333-4333-8333-333333333333",
        productId: "44444444-4444-4444-8444-444444444444",
        modificationId: "55555555-5555-4555-8555-555555555555",
        supersedesId: null,
        modificationIdentifier: "MOD-2026-0817",
        title: "Secure boot trust-anchor rotation",
        description: "Rotates the secure-boot trust anchor for the appliance.",
        technicalScope: "Boot chain verification and signing-key enrollment.",
        introducedAt: "2026-08-16T12:00:00.000Z",
        detectedOrAssessedAt: now,
        previousState: "The former trust anchor verifies boot payloads.",
        resultingState: "The rotated anchor verifies the same payload scope.",
        requiredFollowUpActions: ["Verify field deployment telemetry."],
        completenessState: "complete",
        releaseIds: [releaseId],
        policyVersion: "m2.v2.substantial-modification.v1",
        answers: {
          changesIntendedPurpose: "no",
          changesSecurityArchitectureOrTrustBoundary: "no",
          changesNetworkInterfaceOrPrivilegedRemoteControl: "no",
          changesCryptographyOrIdentityAccessControl: "no",
          changesSafetyOrSecurityRelevantComponent: "unknown",
        },
        rationale: "Impact assessed against the fixed question set.",
        evidenceReferences: [],
        suggestion: "undetermined",
        status: "reviewed",
        determination: "not_substantial",
        determinationRationale: "The changed component remains isolated.",
        overrideReason:
          "Reviewed supporting evidence resolving the unknown answer.",
        reviewedAt: now,
        reviewedBy: id,
        version: 1,
        createdAt: now,
        createdBy: id,
        updatedAt: now,
        updatedBy: id,
      }).overrideReason,
    ).toContain("supporting evidence");
  });

  it("accepts a superseded assessment that retains its complete prior review", () => {
    expect(
      substantialModificationAssessmentSchema.parse({
        id,
        organizationId: "33333333-3333-4333-8333-333333333333",
        productId: "44444444-4444-4444-8444-444444444444",
        modificationId: "55555555-5555-4555-8555-555555555555",
        supersedesId: "66666666-6666-4666-8666-666666666666",
        modificationIdentifier: "MOD-2026-0817",
        title: "Secure boot trust-anchor rotation",
        description: "Rotates the secure-boot trust anchor for the appliance.",
        technicalScope: "Boot chain verification and signing-key enrollment.",
        introducedAt: "2026-08-16T12:00:00.000Z",
        detectedOrAssessedAt: now,
        previousState: "The former trust anchor verifies boot payloads.",
        resultingState: "The rotated anchor verifies the same payload scope.",
        requiredFollowUpActions: ["Verify field deployment telemetry."],
        completenessState: "complete",
        releaseIds: [releaseId],
        policyVersion: "m2.v2.substantial-modification.v1",
        answers: {
          changesIntendedPurpose: "no",
          changesSecurityArchitectureOrTrustBoundary: "no",
          changesNetworkInterfaceOrPrivilegedRemoteControl: "no",
          changesCryptographyOrIdentityAccessControl: "no",
          changesSafetyOrSecurityRelevantComponent: "unknown",
        },
        rationale: "Superseded by a newly assessed modification revision.",
        evidenceReferences: [],
        suggestion: "undetermined",
        status: "superseded",
        determination: "not_substantial",
        determinationRationale: "The predecessor review remains auditable.",
        overrideReason: null,
        reviewedAt: now,
        reviewedBy: id,
        version: 2,
        createdAt: now,
        createdBy: id,
        updatedAt: now,
        updatedBy: id,
      }).status,
    ).toBe("superseded");
  });

  it("rejects non-UTC timestamps at the shared boundary", () => {
    expect(
      utcZDateTimeSchema.safeParse("2026-08-17T12:00:00+05:30").success,
    ).toBe(false);
  });
});
