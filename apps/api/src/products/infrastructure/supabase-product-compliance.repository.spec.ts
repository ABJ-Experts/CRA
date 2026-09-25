import { SupabaseProductComplianceRepository } from "./supabase-product-compliance.repository";

const organizationId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const productId = "00000000-0000-4000-8000-000000000003";
const releaseId = "00000000-0000-4000-8000-000000000004";
const artifactId = "00000000-0000-4000-8000-000000000005";
const sha256 = "a".repeat(64);
const legacyObjectKey = `${organizationId}/${artifactId}/${sha256}`;

describe("SupabaseProductComplianceRepository", () => {
  it("passes every complete assessment narrative field to the org-first creation RPC", async () => {
    const { repository, calls } = harness({ outcome: "invalid_request" });

    await repository.createAssessment(organizationId, actorId, productId, {
      modificationIdentifier: "M2V2-CRYPTO-001",
      title: "Key-management boundary change",
      description: "The authorization boundary for update keys changed.",
      technicalScope: "Device key management and authorization boundary.",
      introducedAt: "2026-08-17T10:00:00.000Z",
      detectedOrAssessedAt: "2026-08-17T12:00:00.000Z",
      previousState: "Keys used the prior device-bound service.",
      resultingState: "Keys use the reviewed authorization service.",
      requiredFollowUpActions: ["Complete the recorded security review."],
      releaseIds: [releaseId],
      policyVersion: "m2.v2.substantial-modification.v1",
      answers: {
        changesIntendedPurpose: "no",
        changesSecurityArchitectureOrTrustBoundary: "no",
        changesNetworkInterfaceOrPrivilegedRemoteControl: "no",
        changesCryptographyOrIdentityAccessControl: "yes",
        changesSafetyOrSecurityRelevantComponent: "no",
      },
      rationale: "The authorization boundary needs a documented assessment.",
      evidenceReferences: [],
      idempotencyKey: "00000000-0000-4000-8000-000000000010",
      suggestion: "potentially_substantial",
    });

    expect(calls[0]).toMatchObject({
      name: "create_product_substantial_modification_assessment_atomic",
      args: {
        p_organization_id: organizationId,
        p_product_id: productId,
        p_modification_identifier: "M2V2-CRYPTO-001",
        p_title: "Key-management boundary change",
        p_technical_scope: "Device key management and authorization boundary.",
        p_required_follow_up_actions: [
          "Complete the recorded security review.",
        ],
      },
    });
  });

  it("persists an incomplete assessment through the dedicated draft RPC with nullable fields", async () => {
    const { repository, calls } = harness({ outcome: "invalid_request" });

    await repository.createAssessmentDraft(organizationId, actorId, productId, {
      policyVersion: "m2.v2.substantial-modification.v1",
      completenessState: "draft",
      title: "Unfinished key-management change",
      idempotencyKey: "00000000-0000-4000-8000-000000000011",
      suggestion: null,
    });

    expect(calls[0]).toMatchObject({
      name: "create_product_substantial_modification_assessment_draft_atomic",
      args: {
        p_organization_id: organizationId,
        p_product_id: productId,
        p_title: "Unfinished key-management change",
        p_modification_identifier: null,
        p_answers: null,
        p_completeness_state: "draft",
      },
    });
  });

  it("reserves an artifact through the org-first RPC and returns only a transient storage key to the use case", async () => {
    const { repository, calls } = harness({
      outcome: "reserved",
      artifact: artifactJson({
        objectKey: `${organizationId}/${sha256}`,
      }),
    });

    await expect(
      repository.reserveArtifact(organizationId, actorId, productId, {
        request: {
          releaseId,
          updateVersion: "1.2.3",
          title: "Security update 1.2.3",
          artifactType: "software_update",
          supportedPlatform: "CRA test platform",
          distributionKind: "authenticated_download",
          fileName: "security-update.bin",
          contentType: "application/octet-stream",
          byteSize: 1024,
          sha256,
          issuedAt: "2026-08-17T12:00:00.000Z",
          idempotencyKey: "00000000-0000-4000-8000-000000000006",
        },
        validatedExternalReferences: [],
      }),
    ).resolves.toMatchObject({
      outcome: "reserved",
      objectKey: `${organizationId}/${sha256}`,
      artifact: { id: artifactId },
    });

    expect(calls[0]).toMatchObject({
      name: "reserve_product_security_update_artifact_atomic",
      args: {
        p_organization_id: organizationId,
        p_product_id: productId,
        p_release_id: releaseId,
        p_actor_user_id: actorId,
        p_distribution_kind: "authenticated_download",
        p_validated_external_references: [],
        p_sha256: sha256,
        p_idempotency_key: "00000000-0000-4000-8000-000000000006",
      },
    });
    expect(calls[0]?.args.p_correlation_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("passes only server-stamped external references to the org-first reservation RPC", async () => {
    const reference = {
      id: "00000000-0000-4000-8000-000000000007",
      title: "Vendor update package",
      uri: "https://updates.example.test/release-1.2.3.bin",
      validationState: "validated_by_server" as const,
      validatedAt: "2026-08-17T12:00:00.000Z",
    };
    const { repository, calls } = harness({
      outcome: "reserved",
      artifact: artifactJson({
        distributionKind: "external_reference",
        distributionReference: reference,
        objectKey: null,
        publicationStatus: "draft",
      }),
    });

    await expect(
      repository.reserveArtifact(organizationId, actorId, productId, {
        request: {
          releaseId,
          updateVersion: "1.2.3",
          title: "Security update 1.2.3",
          artifactType: "software_update",
          supportedPlatform: "CRA test platform",
          distributionKind: "external_reference",
          fileName: "security-update.bin",
          contentType: "application/octet-stream",
          byteSize: 1024,
          sha256,
          issuedAt: "2026-08-17T12:00:00.000Z",
          idempotencyKey: "00000000-0000-4000-8000-000000000008",
        },
        validatedExternalReferences: [reference],
      }),
    ).resolves.toMatchObject({
      outcome: "reserved",
      objectKey: null,
      artifact: { distributionKind: "external_reference" },
    });

    expect(calls[0]).toMatchObject({
      name: "reserve_product_security_update_artifact_atomic",
      args: {
        p_distribution_kind: "external_reference",
        p_validated_external_references: [reference],
      },
    });
  });

  it("uses a database-returned legacy content key only for an existing artifact download", async () => {
    const { repository } = harness({
      outcome: "found",
      artifact: artifactJson({ objectKey: legacyObjectKey }),
    });

    await expect(
      repository.requestArtifactDownload(
        organizationId,
        actorId,
        productId,
        artifactId,
      ),
    ).resolves.toMatchObject({
      outcome: "found",
      objectKey: legacyObjectKey,
    });
  });

  it("maps a foreign artifact to not_found without parsing or leaking a record", async () => {
    const { repository } = harness({ outcome: "not_found" });

    await expect(
      repository.getArtifact(organizationId, actorId, productId, artifactId),
    ).resolves.toEqual({ outcome: "not_found" });
  });

  it("sends bounded inspection results to the idempotent finalization RPC", async () => {
    const { repository, calls } = harness({
      outcome: "finalized",
      artifact: artifactJson(),
    });

    await repository.finalizeArtifact(
      organizationId,
      actorId,
      productId,
      artifactId,
      {
        request: {
          expectedVersion: 3,
          idempotencyKey: "00000000-0000-4000-8000-000000000007",
        },
        inspection: { outcome: "type_mismatch" },
      },
    );

    expect(calls[0]).toMatchObject({
      name: "finalize_product_security_update_artifact_atomic",
      args: {
        p_organization_id: organizationId,
        p_product_id: productId,
        p_artifact_id: artifactId,
        p_actor_user_id: actorId,
        p_expected_version: 3,
        p_integrity_status: "type_mismatch",
        p_verified_sha256: null,
        p_verified_byte_size: null,
        p_verified_content_type: null,
      },
    });
    // Finalization idempotency is owned by the atomic state transition; this
    // deployed RPC deliberately has no idempotency-key argument.
    expect(calls[0]?.args).not.toHaveProperty("p_idempotency_key");
  });

  it("sends a default empty signature-metadata object to the metadata-edit RPC when none is supplied", async () => {
    const { repository, calls } = harness({
      outcome: "updated",
      artifact: artifactJson({ title: "Updated title" }),
    });

    await repository.updateArtifactMetadata(
      organizationId,
      actorId,
      productId,
      artifactId,
      {
        expectedVersion: 3,
        title: "Updated title",
        supportedPlatform: "CRA test platform",
      },
    );

    expect(calls[0]).toMatchObject({
      name: "update_product_security_update_artifact_metadata_atomic",
      args: {
        p_organization_id: organizationId,
        p_product_id: productId,
        p_artifact_id: artifactId,
        p_actor_user_id: actorId,
        p_expected_version: 3,
        p_title: "Updated title",
        p_supported_platform: "CRA test platform",
        p_signature_metadata: {},
      },
    });
  });

  it("does not pass client idempotency metadata to RPCs that do not accept it", async () => {
    const { repository, calls } = harness({
      outcome: "reviewed",
      artifact: artifactJson(),
    });

    await repository.reviewArtifact(
      organizationId,
      actorId,
      productId,
      artifactId,
      {
        expectedVersion: 3,
        decision: "clear",
        reason: "Inspection and release evidence were reviewed.",
        idempotencyKey: "00000000-0000-4000-8000-000000000007",
      },
    );

    expect(calls[0]).toMatchObject({
      name: "review_product_security_update_artifact_atomic",
      args: { p_expected_version: 3, p_review_decision: "cleared" },
    });
    expect(calls[0]?.args).not.toHaveProperty("p_idempotency_key");
  });
});

function harness(row: Record<string, unknown>) {
  const calls: Array<
    Readonly<{ name: string; args: Readonly<Record<string, unknown>> }>
  > = [];
  const repository = new SupabaseProductComplianceRepository({
    admin: () => ({
      rpc: (name: string, args: Readonly<Record<string, unknown>>) => {
        calls.push(Object.freeze({ name, args }));
        return Promise.resolve({ data: [row], error: null });
      },
    }),
  } as never);
  return { repository, calls };
}

function artifactJson(overrides: Record<string, unknown> = {}) {
  return {
    id: artifactId,
    organizationId,
    productId,
    releaseId,
    updateVersion: "1.2.3",
    title: "Security update 1.2.3",
    artifactType: "software_update",
    supportedPlatform: "CRA test platform",
    signatureMetadata: null,
    fileName: "security-update.bin",
    contentType: "application/octet-stream",
    byteSize: 1024,
    sha256,
    uploadStatus: "finalized",
    integrityStatus: "verified",
    reviewStatus: "cleared",
    publicationStatus: "published",
    availabilityStatus: "available",
    statusExplanation: null,
    issuedAt: "2026-08-17T12:00:00.000Z",
    supportPeriodId: null,
    supportPeriodRevision: null,
    supportEndsAt: null,
    availabilityRuleVersion: "m2.v2.security-update-availability.v1",
    issuedCandidate: "2036-08-17T12:00:00.000Z",
    supportCandidate: null,
    availabilityWinningRule: null,
    computedAvailabilityUntil: null,
    availabilityUntil: null,
    nonReductionApplied: false,
    distributionKind: "authenticated_download",
    distributionReference: null,
    publishedExternalReferences: [],
    replacementArtifactId: null,
    withdrawnAt: null,
    withdrawnReason: null,
    version: 3,
    createdAt: "2026-08-17T12:00:00.000Z",
    createdBy: actorId,
    updatedAt: "2026-08-17T12:00:00.000Z",
    updatedBy: actorId,
    ...overrides,
  };
}
