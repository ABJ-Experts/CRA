import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import {
  securityUpdateArtifactListResponseSchema,
  securityUpdateArtifactResponseSchema,
  substantialModificationAssessmentListResponseSchema,
  substantialModificationAssessmentResponseSchema,
  type SecurityUpdateArtifact,
  type SubstantialModificationAssessment,
} from "@repo/contracts/products";

import { SupabaseService } from "../../supabase/supabase.service";
import {
  ProductComplianceProviderError,
  type ProductComplianceInspection,
  type ProductComplianceRepository,
} from "../application/product-compliance-use-cases";

type ProviderRow = Readonly<Record<string, unknown>>;
type ProviderResult = Readonly<{ data: unknown; error: unknown }>;
type RpcClient = Readonly<{
  rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<ProviderResult>;
}>;

const sharedContentAddressedObjectKey =
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/[a-f0-9]{64}$/;
const legacyContentAddressedObjectKey =
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/[a-f0-9]{64}$/;

/**
 * All reads and writes use org-first RPCs. Provider data is parsed against the
 * shared wire schemas before it reaches the application layer.
 */
@Injectable()
export class SupabaseProductComplianceRepository implements ProductComplianceRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async listAssessments(
    organizationId: string,
    actorId: string,
    productId: string,
    query: Parameters<ProductComplianceRepository["listAssessments"]>[3],
  ) {
    const row = await this.singleRpc(
      "list_product_substantial_modification_assessments",
      {
        p_organization_id: organizationId,
        p_product_id: productId,
        p_actor_user_id: actorId,
        p_release_id: query.releaseId ?? null,
        p_status: query.status ?? null,
        p_page: query.page,
        p_page_size: query.pageSize,
      },
    );
    if (this.outcome(row, new Set(["found", "not_found"])) === "not_found") {
      return Object.freeze({ outcome: "not_found" as const });
    }
    return Object.freeze({
      outcome: "found" as const,
      assessments: this.assessmentList(row.assessments),
    });
  }

  async getAssessment(
    organizationId: string,
    actorId: string,
    productId: string,
    assessmentId: string,
  ) {
    const row = await this.singleRpc(
      "get_product_substantial_modification_assessment",
      {
        p_organization_id: organizationId,
        p_product_id: productId,
        p_assessment_id: assessmentId,
        p_actor_user_id: actorId,
      },
    );
    if (this.outcome(row, new Set(["found", "not_found"])) === "not_found") {
      return Object.freeze({ outcome: "not_found" as const });
    }
    return Object.freeze({
      outcome: "found" as const,
      assessment: this.assessment(row.assessment),
    });
  }

  async createAssessment(
    organizationId: string,
    actorId: string,
    productId: string,
    input: Parameters<ProductComplianceRepository["createAssessment"]>[3],
  ): ReturnType<ProductComplianceRepository["createAssessment"]> {
    const row = await this.singleRpc(
      "create_product_substantial_modification_assessment_atomic",
      {
        p_organization_id: organizationId,
        p_product_id: productId,
        p_actor_user_id: actorId,
        p_modification_id: randomUUID(),
        p_modification_identifier: input.modificationIdentifier,
        p_title: input.title,
        p_description: input.description,
        p_technical_scope: input.technicalScope,
        p_introduced_at: input.introducedAt,
        p_detected_or_assessed_at: input.detectedOrAssessedAt,
        p_previous_state: input.previousState,
        p_resulting_state: input.resultingState,
        p_required_follow_up_actions: input.requiredFollowUpActions,
        p_answers: input.answers,
        p_rationale: input.rationale,
        p_evidence_references: input.evidenceReferences,
        p_suggestion: input.suggestion,
        p_release_ids: input.releaseIds,
        p_idempotency_key: input.idempotencyKey,
        p_correlation_id: randomUUID(),
      },
    );
    return this.assessmentMutation(row, new Set(["created", "replayed"]));
  }

  async createAssessmentDraft(
    organizationId: string,
    actorId: string,
    productId: string,
    input: Parameters<ProductComplianceRepository["createAssessmentDraft"]>[3],
  ): ReturnType<ProductComplianceRepository["createAssessmentDraft"]> {
    const row = await this.singleRpc(
      "create_product_substantial_modification_assessment_draft_atomic",
      {
        p_organization_id: organizationId,
        p_product_id: productId,
        p_actor_user_id: actorId,
        p_modification_id: randomUUID(),
        p_modification_identifier: input.modificationIdentifier ?? null,
        p_title: input.title ?? null,
        p_description: input.description ?? null,
        p_technical_scope: input.technicalScope ?? null,
        p_introduced_at: input.introducedAt ?? null,
        p_detected_or_assessed_at: input.detectedOrAssessedAt ?? null,
        p_previous_state: input.previousState ?? null,
        p_resulting_state: input.resultingState ?? null,
        p_required_follow_up_actions: input.requiredFollowUpActions ?? null,
        p_release_ids: input.releaseIds ?? null,
        p_answers: input.answers ?? null,
        p_rationale: input.rationale ?? null,
        p_evidence_references: input.evidenceReferences ?? null,
        p_completeness_state: input.completenessState,
        p_idempotency_key: input.idempotencyKey,
        p_correlation_id: randomUUID(),
      },
    );
    return this.assessmentMutation(row, new Set(["created", "replayed"]));
  }

  async reassessAssessment(
    organizationId: string,
    actorId: string,
    productId: string,
    assessmentId: string,
    input: Parameters<ProductComplianceRepository["reassessAssessment"]>[4],
  ): ReturnType<ProductComplianceRepository["reassessAssessment"]> {
    const row = await this.singleRpc(
      "reassess_product_substantial_modification_atomic",
      {
        p_organization_id: organizationId,
        p_product_id: productId,
        p_assessment_id: assessmentId,
        p_actor_user_id: actorId,
        p_expected_version: input.expectedVersion,
        p_modification_identifier: input.modificationIdentifier,
        p_title: input.title,
        p_description: input.description,
        p_technical_scope: input.technicalScope,
        p_introduced_at: input.introducedAt,
        p_detected_or_assessed_at: input.detectedOrAssessedAt,
        p_previous_state: input.previousState,
        p_resulting_state: input.resultingState,
        p_required_follow_up_actions: input.requiredFollowUpActions,
        p_answers: input.answers,
        p_rationale: input.rationale,
        p_evidence_references: input.evidenceReferences,
        p_suggestion: input.suggestion,
        p_release_ids: input.releaseIds,
        p_idempotency_key: input.idempotencyKey,
        p_correlation_id: randomUUID(),
      },
    );
    return this.assessmentMutation(row, new Set(["reassessed", "replayed"]));
  }

  async reviewAssessment(
    organizationId: string,
    actorId: string,
    productId: string,
    assessmentId: string,
    input: Parameters<ProductComplianceRepository["reviewAssessment"]>[4],
  ): ReturnType<ProductComplianceRepository["reviewAssessment"]> {
    const row = await this.singleRpc(
      "review_product_substantial_modification_assessment_atomic",
      {
        p_organization_id: organizationId,
        p_product_id: productId,
        p_assessment_id: assessmentId,
        p_actor_user_id: actorId,
        p_expected_version: input.expectedVersion,
        p_determination: input.determination,
        p_determination_rationale: input.rationale,
        p_override_reason: input.overrideReason ?? null,
        p_correlation_id: randomUUID(),
      },
    );
    return this.assessmentMutation(row, new Set(["reviewed", "replayed"]));
  }

  async listArtifacts(
    organizationId: string,
    actorId: string,
    productId: string,
    query: Parameters<ProductComplianceRepository["listArtifacts"]>[3],
  ): ReturnType<ProductComplianceRepository["listArtifacts"]> {
    const row = await this.singleRpc("list_product_security_update_artifacts", {
      p_organization_id: organizationId,
      p_product_id: productId,
      p_release_id: query.releaseId ?? null,
      p_actor_user_id: actorId,
      p_publication_status: query.publicationStatus ?? null,
      p_page: query.page,
      p_page_size: query.pageSize,
    });
    if (this.outcome(row, new Set(["found", "not_found"])) === "not_found") {
      return Object.freeze({ outcome: "not_found" as const });
    }
    return Object.freeze({
      outcome: "found" as const,
      artifacts: this.artifactList(row.artifacts),
    });
  }

  async getArtifact(
    organizationId: string,
    actorId: string,
    productId: string,
    artifactId: string,
  ) {
    const row = await this.singleRpc("get_product_security_update_artifact", {
      p_organization_id: organizationId,
      p_product_id: productId,
      p_artifact_id: artifactId,
      p_actor_user_id: actorId,
    });
    if (this.outcome(row, new Set(["found", "not_found"])) === "not_found") {
      return Object.freeze({ outcome: "not_found" as const });
    }
    return Object.freeze({
      outcome: "found" as const,
      artifact: this.artifact(row.artifact),
    });
  }

  async reserveArtifact(
    organizationId: string,
    actorId: string,
    productId: string,
    input: Parameters<ProductComplianceRepository["reserveArtifact"]>[3],
  ): ReturnType<ProductComplianceRepository["reserveArtifact"]> {
    const row = await this.singleRpc(
      "reserve_product_security_update_artifact_atomic",
      {
        p_organization_id: organizationId,
        p_product_id: productId,
        p_release_id: input.request.releaseId,
        p_actor_user_id: actorId,
        p_update_version: input.request.updateVersion,
        p_title: input.request.title,
        p_artifact_type: input.request.artifactType,
        p_supported_platform: input.request.supportedPlatform,
        p_signature_metadata: input.request.signatureMetadata ?? null,
        p_distribution_kind: input.request.distributionKind,
        p_validated_external_references: input.validatedExternalReferences,
        p_file_name: input.request.fileName,
        p_content_type: input.request.contentType,
        p_byte_size: input.request.byteSize,
        p_sha256: input.request.sha256,
        p_issued_at: input.request.issuedAt,
        p_idempotency_key: input.request.idempotencyKey,
        p_correlation_id: randomUUID(),
      },
    );
    const outcome = this.outcome(
      row,
      new Set([
        "reserved",
        "replayed",
        "conflict",
        "not_found",
        "invalid_request",
        "invalid_state",
        "incomplete",
        "blocked",
        "idempotency_mismatch",
      ]),
    );
    if (outcome === "idempotency_mismatch") {
      return Object.freeze({ outcome: "conflict" });
    }
    if (outcome !== "reserved" && outcome !== "replayed") {
      return Object.freeze({ outcome }) as Awaited<
        ReturnType<ProductComplianceRepository["reserveArtifact"]>
      >;
    }
    const artifact = this.artifact(row.artifact);
    const objectKey =
      artifact.distributionKind === "authenticated_download"
        ? this.reservationObjectKey(
            row.artifact,
            organizationId,
            artifact.sha256,
          )
        : this.noObjectKey(row.artifact);
    return Object.freeze({ outcome, artifact, objectKey });
  }

  async finalizeArtifact(
    organizationId: string,
    actorId: string,
    productId: string,
    artifactId: string,
    input: Parameters<ProductComplianceRepository["finalizeArtifact"]>[4],
  ): ReturnType<ProductComplianceRepository["finalizeArtifact"]> {
    const inspected = inspectionArguments(input.inspection);
    const row = await this.singleRpc(
      "finalize_product_security_update_artifact_atomic",
      {
        p_organization_id: organizationId,
        p_product_id: productId,
        p_artifact_id: artifactId,
        p_actor_user_id: actorId,
        p_expected_version: input.request.expectedVersion,
        ...inspected,
        p_correlation_id: randomUUID(),
      },
    );
    return this.artifactMutation(row, new Set(["finalized", "replayed"]));
  }

  async reviewArtifact(
    organizationId: string,
    actorId: string,
    productId: string,
    artifactId: string,
    input: Parameters<ProductComplianceRepository["reviewArtifact"]>[4],
  ): ReturnType<ProductComplianceRepository["reviewArtifact"]> {
    const row = await this.singleRpc(
      "review_product_security_update_artifact_atomic",
      {
        p_organization_id: organizationId,
        p_product_id: productId,
        p_artifact_id: artifactId,
        p_actor_user_id: actorId,
        p_expected_version: input.expectedVersion,
        p_review_decision: input.decision === "clear" ? "cleared" : "rejected",
        p_review_reason: input.reason,
        p_correlation_id: randomUUID(),
      },
    );
    return this.artifactMutation(row, new Set(["reviewed", "replayed"]));
  }

  async publishArtifact(
    organizationId: string,
    actorId: string,
    productId: string,
    artifactId: string,
    input: Parameters<ProductComplianceRepository["publishArtifact"]>[4],
  ): ReturnType<ProductComplianceRepository["publishArtifact"]> {
    const row = await this.singleRpc(
      "publish_product_security_update_artifact_atomic",
      {
        p_organization_id: organizationId,
        p_product_id: productId,
        p_artifact_id: artifactId,
        p_actor_user_id: actorId,
        p_expected_version: input.request.expectedVersion,
        p_published_external_references: input.publishedExternalReferences,
        p_correlation_id: randomUUID(),
      },
    );
    return this.artifactMutation(row, new Set(["published", "replayed"]));
  }

  async replaceArtifact(
    organizationId: string,
    actorId: string,
    productId: string,
    artifactId: string,
    input: Parameters<ProductComplianceRepository["replaceArtifact"]>[4],
  ): ReturnType<ProductComplianceRepository["replaceArtifact"]> {
    const row = await this.singleRpc(
      "replace_product_security_update_artifact_atomic",
      {
        p_organization_id: organizationId,
        p_product_id: productId,
        p_artifact_id: artifactId,
        p_replacement_artifact_id: input.replacementArtifactId,
        p_actor_user_id: actorId,
        p_expected_version: input.expectedVersion,
        p_reason: input.reason,
        p_correlation_id: randomUUID(),
      },
    );
    return this.artifactMutation(row, new Set(["replaced", "replayed"]));
  }

  async withdrawArtifact(
    organizationId: string,
    actorId: string,
    productId: string,
    artifactId: string,
    input: Parameters<ProductComplianceRepository["withdrawArtifact"]>[4],
  ): ReturnType<ProductComplianceRepository["withdrawArtifact"]> {
    const row = await this.singleRpc(
      "withdraw_product_security_update_artifact_atomic",
      {
        p_organization_id: organizationId,
        p_product_id: productId,
        p_artifact_id: artifactId,
        p_actor_user_id: actorId,
        p_expected_version: input.expectedVersion,
        p_reason: input.reason,
        p_correlation_id: randomUUID(),
      },
    );
    return this.artifactMutation(row, new Set(["withdrawn", "replayed"]));
  }

  async requestArtifactDownload(
    organizationId: string,
    actorId: string,
    productId: string,
    artifactId: string,
  ): ReturnType<ProductComplianceRepository["requestArtifactDownload"]> {
    const row = await this.singleRpc(
      "download_product_security_update_artifact_atomic",
      {
        p_organization_id: organizationId,
        p_product_id: productId,
        p_artifact_id: artifactId,
        p_actor_user_id: actorId,
      },
    );
    const outcome = this.outcome(
      row,
      new Set(["found", "not_found", "invalid_state", "incomplete", "blocked"]),
    );
    if (outcome !== "found") {
      return Object.freeze({ outcome }) as Awaited<
        ReturnType<ProductComplianceRepository["requestArtifactDownload"]>
      >;
    }
    const artifact = this.artifact(row.artifact);
    return Object.freeze({
      outcome,
      artifact,
      objectKey: this.readableObjectKey(
        row.artifact,
        organizationId,
        artifact.sha256,
      ),
    });
  }

  private assessmentMutation<Success extends string>(
    row: ProviderRow,
    successOutcomes: ReadonlySet<Success>,
  ) {
    const outcome = this.outcome(
      row,
      new Set([
        ...successOutcomes,
        "conflict",
        "not_found",
        "invalid_request",
        "invalid_state",
        "incomplete",
        "blocked",
        "idempotency_mismatch",
      ]),
    );
    if (outcome === "idempotency_mismatch") {
      return Object.freeze({ outcome: "conflict" });
    }
    return successOutcomes.has(outcome as Success)
      ? Object.freeze({
          outcome: outcome as Success,
          value: this.assessment(row.assessment),
        })
      : Object.freeze({
          outcome: outcome as
            | "conflict"
            | "not_found"
            | "invalid_request"
            | "invalid_state"
            | "incomplete"
            | "blocked",
        });
  }

  private artifactMutation<Success extends string>(
    row: ProviderRow,
    successOutcomes: ReadonlySet<Success>,
  ) {
    const outcome = this.outcome(
      row,
      new Set([
        ...successOutcomes,
        "conflict",
        "not_found",
        "invalid_request",
        "invalid_state",
        "incomplete",
        "blocked",
      ]),
    );
    return successOutcomes.has(outcome as Success)
      ? Object.freeze({
          outcome: outcome as Success,
          value: this.artifact(row.artifact),
        })
      : Object.freeze({
          outcome: outcome as
            | "conflict"
            | "not_found"
            | "invalid_request"
            | "invalid_state"
            | "incomplete"
            | "blocked",
        });
  }

  private assessment(value: unknown): SubstantialModificationAssessment {
    return this.parse(substantialModificationAssessmentResponseSchema, {
      assessment: value,
    }).assessment;
  }

  private assessmentList(value: unknown) {
    return this.parse(substantialModificationAssessmentListResponseSchema, {
      assessments: value,
    }).assessments;
  }

  private artifact(value: unknown): SecurityUpdateArtifact {
    return this.parse(securityUpdateArtifactResponseSchema, {
      artifact: withoutObjectKey(value),
    }).artifact;
  }

  private artifactList(value: unknown) {
    return this.parse(securityUpdateArtifactListResponseSchema, {
      artifacts: value,
    }).artifacts;
  }

  private reservationObjectKey(
    value: unknown,
    organizationId: string,
    contentHash: string,
  ): string {
    const record = this.record(value);
    const objectKey = record.objectKey;
    const expected = `${organizationId}/${contentHash}`;
    if (
      objectKey !== expected ||
      !sharedContentAddressedObjectKey.test(expected)
    ) {
      throw new ProductComplianceProviderError("malformed");
    }
    return expected;
  }

  private readableObjectKey(
    value: unknown,
    organizationId: string,
    contentHash: string,
  ): string {
    const objectKey = this.record(value).objectKey;
    if (
      typeof objectKey !== "string" ||
      (!sharedContentAddressedObjectKey.test(objectKey) &&
        !legacyContentAddressedObjectKey.test(objectKey))
    ) {
      throw new ProductComplianceProviderError("malformed");
    }
    const segments = objectKey.split("/");
    if (
      segments[0] !== organizationId ||
      segments[segments.length - 1] !== contentHash
    ) {
      throw new ProductComplianceProviderError("malformed");
    }
    return objectKey;
  }

  private noObjectKey(value: unknown): null {
    const objectKey = this.record(value).objectKey;
    if (objectKey !== null && objectKey !== undefined) {
      throw new ProductComplianceProviderError("malformed");
    }
    return null;
  }

  private async singleRpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<ProviderRow> {
    let result: ProviderResult;
    try {
      result = await (this.supabase.admin() as unknown as RpcClient).rpc(
        name,
        args,
      );
    } catch {
      throw new ProductComplianceProviderError("unavailable");
    }
    if (
      result.error ||
      !Array.isArray(result.data) ||
      result.data.length !== 1
    ) {
      throw new ProductComplianceProviderError("unavailable");
    }
    return this.record(result.data[0]);
  }

  private outcome<T extends string>(
    row: ProviderRow,
    allowed: ReadonlySet<T>,
  ): T {
    const outcome = row.outcome;
    if (typeof outcome !== "string" || !allowed.has(outcome as T)) {
      throw new ProductComplianceProviderError("malformed");
    }
    return outcome as T;
  }

  private parse<T>(
    schema: Readonly<{
      safeParse(value: unknown): Readonly<{ success: boolean; data?: T }>;
    }>,
    value: unknown,
  ): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success || parsed.data === undefined) {
      throw new ProductComplianceProviderError("malformed");
    }
    return parsed.data;
  }

  private record(value: unknown): ProviderRow {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new ProductComplianceProviderError("malformed");
    }
    return value as ProviderRow;
  }
}

const withoutObjectKey = (value: unknown): unknown => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([key]) => key !== "objectKey",
    ),
  );
};

const inspectionArguments = (inspection: ProductComplianceInspection) => {
  if (inspection.outcome === "verified") {
    return Object.freeze({
      p_integrity_status: "verified",
      p_verified_sha256: inspection.sha256,
      p_verified_byte_size: inspection.byteSize,
      p_verified_content_type: inspection.contentType,
    });
  }
  const integrityStatus =
    inspection.outcome === "unavailable"
      ? "provider_unavailable"
      : inspection.outcome;
  return Object.freeze({
    p_integrity_status: integrityStatus,
    p_verified_sha256: null,
    p_verified_byte_size: null,
    p_verified_content_type: null,
  });
};
