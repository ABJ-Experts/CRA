import { ProductComplianceUseCases } from "./product-compliance-use-cases";

const organizationId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const productId = "00000000-0000-4000-8000-000000000003";
const releaseId = "00000000-0000-4000-8000-000000000004";
const assessmentId = "00000000-0000-4000-8000-000000000005";
const artifactId = "00000000-0000-4000-8000-000000000006";

const answers = Object.freeze({
  changesIntendedPurpose: "no" as const,
  changesSecurityArchitectureOrTrustBoundary: "no" as const,
  changesNetworkInterfaceOrPrivilegedRemoteControl: "no" as const,
  changesCryptographyOrIdentityAccessControl: "yes" as const,
  changesSafetyOrSecurityRelevantComponent: "no" as const,
});

describe("ProductComplianceUseCases", () => {
  it("persists a non-authoritative policy suggestion without letting it set the human determination", async () => {
    const repository = {
      createAssessment: jest.fn().mockResolvedValue({
        outcome: "created",
        value: { id: assessmentId },
      }),
    };
    const useCases = new ProductComplianceUseCases(
      repository as never,
      {} as never,
    );

    await expect(
      useCases.createAssessment({
        organizationId,
        actorId,
        productId,
        input: completeAssessmentInput(),
      }),
    ).resolves.toEqual({
      ok: true,
      value: { assessment: { id: assessmentId } },
    });

    expect(repository.createAssessment).toHaveBeenCalledWith(
      organizationId,
      actorId,
      productId,
      expect.objectContaining({
        suggestion: "potentially_substantial",
      }),
    );
    expect(repository.createAssessment).toHaveBeenCalledTimes(1);
  });

  it("persists an incomplete assessment through the draft command without evaluating a partial policy", async () => {
    const repository = {
      createAssessmentDraft: jest.fn().mockResolvedValue({
        outcome: "created",
        value: {
          id: assessmentId,
          suggestion: null,
          completenessState: "draft",
        },
      }),
    };
    const useCases = new ProductComplianceUseCases(
      repository as never,
      {} as never,
    );

    await expect(
      useCases.createAssessmentDraft({
        organizationId,
        actorId,
        productId,
        input: {
          policyVersion: "m2.v2.substantial-modification.v1",
          completenessState: "draft",
          title: "Unfinished key-management change",
          idempotencyKey: "00000000-0000-4000-8000-000000000014",
        },
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        assessment: {
          id: assessmentId,
          suggestion: null,
          completenessState: "draft",
        },
      },
    });
    expect(repository.createAssessmentDraft).toHaveBeenCalledWith(
      organizationId,
      actorId,
      productId,
      expect.objectContaining({ suggestion: null, completenessState: "draft" }),
    );
  });

  it("persists the artifact reservation before returning a transient signed upload URL", async () => {
    const sequence: string[] = [];
    const repository = {
      reserveArtifact: jest.fn().mockImplementation(() => {
        sequence.push("reserved");
        return {
          outcome: "reserved",
          artifact: { id: artifactId },
          objectKey: `${organizationId}/${"a".repeat(64)}`,
        };
      }),
    };
    const storage = {
      createSignedUpload: jest.fn().mockImplementation(() => {
        sequence.push("signed");
        return {
          uploadUrl: "https://storage.example.test/upload",
          expiresAt: "2026-08-17T12:05:00.000Z",
        };
      }),
    };
    const useCases = new ProductComplianceUseCases(
      repository as never,
      storage as never,
    );

    await expect(
      useCases.reserveArtifact({
        organizationId,
        actorId,
        productId,
        input: {
          releaseId,
          updateVersion: "1.2.3",
          title: "Security update 1.2.3",
          artifactType: "software_update",
          supportedPlatform: "CRA test platform",
          distributionKind: "authenticated_download",
          fileName: "security-update.bin",
          contentType: "application/octet-stream",
          byteSize: 1024,
          sha256: "a".repeat(64),
          issuedAt: "2026-08-17T12:00:00.000Z",
          idempotencyKey: "00000000-0000-4000-8000-000000000008",
        },
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        artifact: { id: artifactId },
        upload: {
          uploadUrl: "https://storage.example.test/upload",
          expiresAt: "2026-08-17T12:05:00.000Z",
        },
      },
    });

    expect(sequence).toEqual(["reserved", "signed"]);
    expect(repository.reserveArtifact).toHaveBeenCalledTimes(1);
  });

  it("leaves the durable reservation for normal inspection when a concurrent content-addressed upload wins", async () => {
    const repository = {
      reserveArtifact: jest.fn().mockResolvedValue({
        outcome: "reserved",
        artifact: { id: artifactId },
        objectKey: `${organizationId}/${"a".repeat(64)}`,
      }),
    };
    const storage = {
      createSignedUpload: jest
        .fn()
        .mockRejectedValue(new Error("object already exists")),
    };
    const useCases = new ProductComplianceUseCases(
      repository as never,
      storage as never,
    );

    await expect(
      useCases.reserveArtifact({
        organizationId,
        actorId,
        productId,
        input: {
          releaseId,
          updateVersion: "1.2.3",
          title: "Security update 1.2.3",
          artifactType: "software_update",
          supportedPlatform: "CRA test platform",
          distributionKind: "authenticated_download",
          fileName: "security-update.bin",
          contentType: "application/octet-stream",
          byteSize: 1024,
          sha256: "a".repeat(64),
          issuedAt: "2026-08-17T12:00:00.000Z",
          idempotencyKey: "00000000-0000-4000-8000-000000000009",
        },
      }),
    ).resolves.toEqual({ ok: false, error: { code: "unavailable" } });
    expect(repository.reserveArtifact).toHaveBeenCalledTimes(1);
    expect(storage.createSignedUpload).toHaveBeenCalledTimes(1);
  });

  it("server-validates an external source before the durable reservation and returns no storage upload", async () => {
    const repository = {
      reserveArtifact: jest.fn().mockImplementation(
        (
          _organizationId: string,
          _actorId: string,
          _productId: string,
          command: Readonly<{
            request: Readonly<Record<string, unknown>>;
            validatedExternalReferences: readonly Readonly<
              Record<string, unknown>
            >[];
          }>,
        ) => {
          expect(command.request).not.toHaveProperty(
            "externalReferenceCandidates",
          );
          expect(command.request.distributionKind).toBe("external_reference");
          expect(command.request.releaseId).toBe(releaseId);
          expect(command.validatedExternalReferences[0]?.validationState).toBe(
            "validated_by_server",
          );
          return Promise.resolve({
            outcome: "reserved" as const,
            artifact: {
              id: artifactId,
              distributionKind: "external_reference" as const,
            },
            objectKey: null,
          });
        },
      ),
    };
    const storage = { createSignedUpload: jest.fn() };
    const externalReferences = {
      validate: jest.fn().mockResolvedValue({
        outcome: "validated",
        references: [
          {
            id: "00000000-0000-4000-8000-000000000016",
            title: "Vendor update package",
            uri: "https://updates.example.test/release-1.2.3.bin",
            validationState: "validated_by_server",
            validatedAt: "2026-08-17T12:00:00.000Z",
          },
        ],
      }),
    };
    const useCases = new ProductComplianceUseCases(
      repository as never,
      storage as never,
      externalReferences,
    );
    const input = {
      releaseId,
      updateVersion: "1.2.3",
      title: "Security update 1.2.3",
      artifactType: "software_update" as const,
      supportedPlatform: "CRA test platform",
      distributionKind: "external_reference" as const,
      externalReferenceCandidates: [
        {
          id: "00000000-0000-4000-8000-000000000016",
          title: "Vendor update package",
          uri: "https://updates.example.test/release-1.2.3.bin",
        },
      ],
      serverValidationRequired: true as const,
      fileName: "security-update.bin",
      contentType: "application/octet-stream",
      byteSize: 1024,
      sha256: "a".repeat(64),
      issuedAt: "2026-08-17T12:00:00.000Z",
      idempotencyKey: "00000000-0000-4000-8000-000000000008",
    };

    await expect(
      useCases.reserveArtifact({ organizationId, actorId, productId, input }),
    ).resolves.toEqual({
      ok: true,
      value: {
        artifact: { id: artifactId, distributionKind: "external_reference" },
        upload: null,
      },
    });
    expect(externalReferences.validate).toHaveBeenCalledWith(
      input.externalReferenceCandidates,
    );
    expect(repository.reserveArtifact).toHaveBeenCalledTimes(1);
    expect(storage.createSignedUpload).not.toHaveBeenCalled();
  });

  it("requires a nonblank override reason before a human review differs from the persisted policy suggestion", async () => {
    const repository = {
      getAssessment: jest.fn().mockResolvedValue({
        outcome: "found",
        assessment: {
          suggestion: "not_substantial",
          completenessState: "complete",
        },
      }),
      reviewAssessment: jest.fn(),
    };
    const useCases = new ProductComplianceUseCases(
      repository as never,
      {} as never,
    );

    await expect(
      useCases.reviewAssessment({
        organizationId,
        actorId,
        productId,
        assessmentId,
        input: {
          determination: "substantial",
          rationale: "The reviewer found a substantial modification.",
          expectedVersion: 1,
          idempotencyKey: "00000000-0000-4000-8000-000000000010",
        },
      }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_request" } });
    expect(repository.reviewAssessment).not.toHaveBeenCalled();
  });

  it("does not allow a draft or in-progress assessment to enter human review", async () => {
    const repository = {
      getAssessment: jest.fn().mockResolvedValue({
        outcome: "found",
        assessment: { suggestion: null, completenessState: "in_progress" },
      }),
      reviewAssessment: jest.fn(),
    };
    const useCases = new ProductComplianceUseCases(
      repository as never,
      {} as never,
    );

    await expect(
      useCases.reviewAssessment({
        organizationId,
        actorId,
        productId,
        assessmentId,
        input: {
          determination: "not_substantial",
          rationale:
            "Review must wait until all required evidence is complete.",
          expectedVersion: 1,
          idempotencyKey: "00000000-0000-4000-8000-000000000015",
        },
      }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_state" } });
    expect(repository.reviewAssessment).not.toHaveBeenCalled();
  });

  it("requires an external artifact’s durable inspection to be verified before review or publication", async () => {
    const repository = {
      getArtifact: jest.fn().mockResolvedValue({
        outcome: "found",
        artifact: {
          integrityStatus: "hash_mismatch",
          distributionKind: "external_reference",
          distributionReference: {
            id: "00000000-0000-4000-8000-000000000011",
            title: "Unsafe private reference",
            uri: "https://updates.example.test/security-update",
            validationState: "validated_by_server",
            validatedAt: "2026-08-17T12:00:00.000Z",
          },
        },
      }),
      publishArtifact: jest.fn(),
      reviewArtifact: jest.fn(),
    };
    const useCases = new ProductComplianceUseCases(
      repository as never,
      {} as never,
    );

    await expect(
      useCases.publishArtifact({
        organizationId,
        actorId,
        productId,
        artifactId,
        input: {
          expectedVersion: 1,
          idempotencyKey: "00000000-0000-4000-8000-000000000012",
        },
      }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_state" } });
    expect(repository.publishArtifact).not.toHaveBeenCalled();

    await expect(
      useCases.reviewArtifact({
        organizationId,
        actorId,
        productId,
        artifactId,
        input: {
          decision: "clear",
          reason: "A verified artifact is required before release approval.",
          expectedVersion: 1,
          idempotencyKey: "00000000-0000-4000-8000-000000000013",
        },
      }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_state" } });
    expect(repository.reviewArtifact).not.toHaveBeenCalled();
  });

  it("does not let a caller bypass external inspection through the private-object finalization command", async () => {
    const repository = {
      getArtifact: jest.fn().mockResolvedValue({
        outcome: "found",
        artifact: { distributionKind: "external_reference" },
      }),
      finalizeArtifact: jest.fn(),
    };
    const storage = { inspect: jest.fn() };
    const useCases = new ProductComplianceUseCases(
      repository as never,
      storage as never,
    );

    await expect(
      useCases.finalizeArtifact({
        organizationId,
        actorId,
        productId,
        artifactId,
        input: {
          expectedVersion: 1,
          idempotencyKey: "00000000-0000-4000-8000-000000000013",
        },
      }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_state" } });
    expect(storage.inspect).not.toHaveBeenCalled();
    expect(repository.finalizeArtifact).not.toHaveBeenCalled();
  });

  it("publishes a verified authenticated download without external candidates or a validator", async () => {
    const repository = {
      getArtifact: jest.fn().mockResolvedValue({
        outcome: "found",
        artifact: {
          integrityStatus: "verified",
          distributionKind: "authenticated_download",
          distributionReference: null,
        },
      }),
      publishArtifact: jest.fn().mockResolvedValue({
        outcome: "published",
        value: { id: artifactId },
      }),
    };
    const useCases = new ProductComplianceUseCases(
      repository as never,
      {} as never,
    );

    await expect(
      useCases.publishArtifact({
        organizationId,
        actorId,
        productId,
        artifactId,
        input: {
          expectedVersion: 1,
          idempotencyKey: "00000000-0000-4000-8000-000000000014",
        },
      }),
    ).resolves.toEqual({ ok: true, value: { artifact: { id: artifactId } } });
    expect(repository.publishArtifact).toHaveBeenCalledWith(
      organizationId,
      actorId,
      productId,
      artifactId,
      expect.objectContaining({ publishedExternalReferences: [] }),
    );
  });

  it("re-downloads and verifies a finalized private object before recording its integrity state", async () => {
    const repository = {
      getArtifact: jest.fn().mockResolvedValue({
        outcome: "found",
        artifact: {
          id: artifactId,
          sha256: "a".repeat(64),
          byteSize: 1024,
          contentType: "application/octet-stream",
        },
      }),
      finalizeArtifact: jest.fn().mockResolvedValue({
        outcome: "finalized",
        value: { id: artifactId },
      }),
    };
    const storage = {
      inspect: jest.fn().mockResolvedValue({
        outcome: "verified",
        sha256: "a".repeat(64),
        byteSize: 1024,
        contentType: "application/octet-stream",
      }),
    };
    const useCases = new ProductComplianceUseCases(
      repository as never,
      storage as never,
    );

    await expect(
      useCases.finalizeArtifact({
        organizationId,
        actorId,
        productId,
        artifactId,
        input: {
          expectedVersion: 1,
          idempotencyKey: "00000000-0000-4000-8000-000000000013",
        },
      }),
    ).resolves.toEqual({ ok: true, value: { artifact: { id: artifactId } } });

    expect(storage.inspect).toHaveBeenCalledWith({
      objectKey: `${organizationId}/${"a".repeat(64)}`,
      sha256: "a".repeat(64),
      byteSize: 1024,
      contentType: "application/octet-stream",
    });
    expect(repository.finalizeArtifact).toHaveBeenCalledTimes(1);
  });

  it("linearizes a concurrent withdrawal at the atomic download decision before issuing a short-lived attachment URL", async () => {
    const repository = {
      requestArtifactDownload: jest.fn().mockResolvedValue({
        // This outcome represents a withdrawal that won the database lock
        // before the read/audit RPC could authorize a new signed link.
        outcome: "invalid_state",
      }),
    };
    const storage = { createSignedDownload: jest.fn() };
    const useCases = new ProductComplianceUseCases(
      repository as never,
      storage as never,
    );

    await expect(
      useCases.downloadArtifact({
        organizationId,
        actorId,
        productId,
        artifactId,
      }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_state" } });
    expect(repository.requestArtifactDownload).toHaveBeenCalledWith(
      organizationId,
      actorId,
      productId,
      artifactId,
    );
    expect(storage.createSignedDownload).not.toHaveBeenCalled();
  });
});

function completeAssessmentInput() {
  return {
    modificationIdentifier: "M2V2-CRYPTO-001",
    title: "Key-management boundary change",
    description: "A cryptographic key-management boundary was changed.",
    technicalScope: "Device key management and authorization boundary.",
    introducedAt: "2026-08-17T10:00:00.000Z",
    detectedOrAssessedAt: "2026-08-17T12:00:00.000Z",
    previousState: "Keys were managed by the prior device-bound service.",
    resultingState: "Keys are managed by the reviewed authorization service.",
    requiredFollowUpActions: ["Complete the recorded security review."],
    releaseIds: [releaseId],
    policyVersion: "m2.v2.substantial-modification.v1" as const,
    answers,
    rationale: "A cryptographic key-management boundary was changed.",
    evidenceReferences: [],
    idempotencyKey: "00000000-0000-4000-8000-000000000007",
  };
}
