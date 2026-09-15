import type {
  CreateSubstantialModificationAssessmentInput,
  CreateSubstantialModificationAssessmentDraftInput,
  FinalizeSecurityUpdateArtifactInput,
  PublishSecurityUpdateArtifactInput,
  ReassessSubstantialModificationAssessmentInput,
  ReplaceSecurityUpdateArtifactInput,
  ReserveSecurityUpdateArtifactInput,
  ReviewSecurityUpdateArtifactInput,
  ReviewSubstantialModificationAssessmentInput,
  SecurityUpdateArtifact,
  SecurityUpdateArtifactDownloadResponse,
  SecurityUpdateArtifactListQuery,
  SecurityUpdateArtifactListResponse,
  SecurityUpdateArtifactReserveResponse,
  SecurityUpdateArtifactResponse,
  SubstantialModificationAssessment,
  SubstantialModificationAssessmentListQuery,
  SubstantialModificationAssessmentListResponse,
  SubstantialModificationAssessmentResponse,
  UpdateSecurityUpdateArtifactMetadataInput,
  WithdrawSecurityUpdateArtifactInput,
} from "@repo/contracts/products";

import type { Result } from "../../common/domain/result";
import { failure, success } from "../../common/domain/result";
import {
  suggestSubstantialModification,
  type SubstantialModificationSuggestion,
} from "./substantial-modification-policy";

type ComplianceMutationOutcome<T, Success extends string> =
  | Readonly<{ outcome: Success; value: T }>
  | Readonly<{
      outcome:
        | "conflict"
        | "not_found"
        | "invalid_request"
        | "invalid_state"
        | "incomplete"
        | "blocked";
    }>;

export type ProductComplianceProviderErrorCode = "unavailable" | "malformed";

export class ProductComplianceProviderError extends Error {
  readonly name = "ProductComplianceProviderError";

  constructor(readonly code: ProductComplianceProviderErrorCode) {
    super(code);
  }
}

export type ProductComplianceError = Readonly<{
  code:
    | "invalid_request"
    | "conflict"
    | "not_found"
    | "invalid_state"
    | "incomplete"
    | "blocked"
    | "unavailable"
    | "malformed_provider";
}>;

type ProductComplianceResult<T> = Result<T, ProductComplianceError>;

type AssessmentDraft = CreateSubstantialModificationAssessmentInput &
  Readonly<{ suggestion: SubstantialModificationSuggestion }>;

type IncompleteAssessmentDraft =
  CreateSubstantialModificationAssessmentDraftInput &
    Readonly<{ suggestion: null }>;

type ReassessmentDraft = ReassessSubstantialModificationAssessmentInput &
  Readonly<{ suggestion: SubstantialModificationSuggestion }>;

type ExternalReferenceCandidate = NonNullable<
  ReserveSecurityUpdateArtifactInput["externalReferenceCandidates"]
>[number];
type ValidatedExternalReference =
  SecurityUpdateArtifact["publishedExternalReferences"][number];
type StorageSafeArtifactReservationRequest = Omit<
  ReserveSecurityUpdateArtifactInput,
  "externalReferenceCandidates" | "serverValidationRequired"
>;
type ArtifactReservationCommand = Readonly<{
  request: StorageSafeArtifactReservationRequest;
  validatedExternalReferences: readonly ValidatedExternalReference[];
}>;

export interface ProductComplianceRepository {
  listAssessments(
    organizationId: string,
    actorId: string,
    productId: string,
    query: SubstantialModificationAssessmentListQuery,
  ): Promise<
    | Readonly<{
        outcome: "found";
        assessments: SubstantialModificationAssessmentListResponse["assessments"];
      }>
    | Readonly<{ outcome: "not_found" }>
  >;
  getAssessment(
    organizationId: string,
    actorId: string,
    productId: string,
    assessmentId: string,
  ): Promise<
    | Readonly<{
        outcome: "found";
        assessment: SubstantialModificationAssessment;
      }>
    | Readonly<{ outcome: "not_found" }>
  >;
  createAssessment(
    organizationId: string,
    actorId: string,
    productId: string,
    input: AssessmentDraft,
  ): Promise<
    ComplianceMutationOutcome<
      SubstantialModificationAssessment,
      "created" | "replayed"
    >
  >;
  createAssessmentDraft(
    organizationId: string,
    actorId: string,
    productId: string,
    input: IncompleteAssessmentDraft,
  ): Promise<
    ComplianceMutationOutcome<
      SubstantialModificationAssessment,
      "created" | "replayed"
    >
  >;
  reassessAssessment(
    organizationId: string,
    actorId: string,
    productId: string,
    assessmentId: string,
    input: ReassessmentDraft,
  ): Promise<
    ComplianceMutationOutcome<
      SubstantialModificationAssessment,
      "reassessed" | "replayed"
    >
  >;
  reviewAssessment(
    organizationId: string,
    actorId: string,
    productId: string,
    assessmentId: string,
    input: ReviewSubstantialModificationAssessmentInput,
  ): Promise<
    ComplianceMutationOutcome<
      SubstantialModificationAssessment,
      "reviewed" | "replayed"
    >
  >;
  listArtifacts(
    organizationId: string,
    actorId: string,
    productId: string,
    query: SecurityUpdateArtifactListQuery,
  ): Promise<
    | Readonly<{
        outcome: "found";
        artifacts: SecurityUpdateArtifactListResponse["artifacts"];
      }>
    | Readonly<{ outcome: "not_found" }>
  >;
  getArtifact(
    organizationId: string,
    actorId: string,
    productId: string,
    artifactId: string,
  ): Promise<
    | Readonly<{ outcome: "found"; artifact: SecurityUpdateArtifact }>
    | Readonly<{ outcome: "not_found" }>
  >;
  reserveArtifact(
    organizationId: string,
    actorId: string,
    productId: string,
    input: ArtifactReservationCommand,
  ): Promise<
    | Readonly<{
        outcome: "reserved" | "replayed";
        artifact: SecurityUpdateArtifact;
        objectKey: string | null;
      }>
    | Readonly<{
        outcome:
          | "conflict"
          | "not_found"
          | "invalid_request"
          | "invalid_state"
          | "incomplete"
          | "blocked";
      }>
  >;
  finalizeArtifact(
    organizationId: string,
    actorId: string,
    productId: string,
    artifactId: string,
    input: Readonly<{
      request: FinalizeSecurityUpdateArtifactInput;
      inspection: ProductComplianceInspection;
    }>,
  ): Promise<
    ComplianceMutationOutcome<SecurityUpdateArtifact, "finalized" | "replayed">
  >;
  reviewArtifact(
    organizationId: string,
    actorId: string,
    productId: string,
    artifactId: string,
    input: ReviewSecurityUpdateArtifactInput,
  ): Promise<
    ComplianceMutationOutcome<SecurityUpdateArtifact, "reviewed" | "replayed">
  >;
  publishArtifact(
    organizationId: string,
    actorId: string,
    productId: string,
    artifactId: string,
    input: Readonly<{
      request: PublishSecurityUpdateArtifactInput;
      publishedExternalReferences: readonly ValidatedExternalReference[];
    }>,
  ): Promise<
    ComplianceMutationOutcome<SecurityUpdateArtifact, "published" | "replayed">
  >;
  replaceArtifact(
    organizationId: string,
    actorId: string,
    productId: string,
    artifactId: string,
    input: ReplaceSecurityUpdateArtifactInput,
  ): Promise<
    ComplianceMutationOutcome<SecurityUpdateArtifact, "replaced" | "replayed">
  >;
  withdrawArtifact(
    organizationId: string,
    actorId: string,
    productId: string,
    artifactId: string,
    input: WithdrawSecurityUpdateArtifactInput,
  ): Promise<
    ComplianceMutationOutcome<SecurityUpdateArtifact, "withdrawn" | "replayed">
  >;
  updateArtifactMetadata(
    organizationId: string,
    actorId: string,
    productId: string,
    artifactId: string,
    input: UpdateSecurityUpdateArtifactMetadataInput,
  ): Promise<ComplianceMutationOutcome<SecurityUpdateArtifact, "updated">>;
  requestArtifactDownload(
    organizationId: string,
    actorId: string,
    productId: string,
    artifactId: string,
  ): Promise<
    | Readonly<{
        outcome: "found";
        artifact: SecurityUpdateArtifact;
        objectKey: string;
      }>
    | Readonly<{
        outcome: "not_found" | "invalid_state" | "incomplete" | "blocked";
      }>
  >;
}

/** Product-owned private-object boundary; signed URLs never enter persistence. */
export interface ProductComplianceStoragePort {
  createSignedUpload(
    input: Readonly<{
      objectKey: string;
      contentType: string;
      byteSize: number;
    }>,
  ): Promise<NonNullable<SecurityUpdateArtifactReserveResponse["upload"]>>;
  createSignedDownload(
    input: Readonly<{
      objectKey: string;
      fileName: string;
      contentType: string;
    }>,
  ): Promise<SecurityUpdateArtifactDownloadResponse["download"]>;
  inspect(
    input: Readonly<{
      objectKey: string;
      sha256: string;
      byteSize: number;
      contentType: string;
    }>,
  ): Promise<ProductComplianceInspection>;
  /** The only place storage bytes are ever deleted; callers never touch storage directly. */
  remove(objectKey: string): Promise<void>;
}

/** Trust boundary for externally hosted update references. */
export interface ProductComplianceExternalReferenceValidator {
  validate(candidates: readonly ExternalReferenceCandidate[]): Promise<
    | Readonly<{
        outcome: "validated";
        references: readonly ValidatedExternalReference[];
      }>
    | Readonly<{ outcome: "invalid_reference" }>
  >;
}

export type ProductComplianceInspection =
  | Readonly<{
      outcome: "verified";
      sha256: string;
      byteSize: number;
      contentType: string;
    }>
  | Readonly<{
      outcome:
        | "missing"
        | "hash_mismatch"
        | "type_mismatch"
        | "corrupt"
        | "unavailable";
    }>;

/** Framework-free, tenant-scoped M2 V2 compliance workflows. */
export class ProductComplianceUseCases {
  constructor(
    private readonly repository: ProductComplianceRepository,
    private readonly storage: ProductComplianceStoragePort,
    private readonly externalReferences?: ProductComplianceExternalReferenceValidator,
    private readonly maxSyncInspectBytes: number = 67_108_864,
  ) {}

  async listAssessments(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      query: SubstantialModificationAssessmentListQuery;
    }>,
  ): Promise<
    ProductComplianceResult<SubstantialModificationAssessmentListResponse>
  > {
    try {
      const result = await this.repository.listAssessments(
        command.organizationId,
        command.actorId,
        command.productId,
        command.query,
      );
      return result.outcome === "found"
        ? success(Object.freeze({ assessments: result.assessments }))
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async getAssessment(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      assessmentId: string;
    }>,
  ): Promise<
    ProductComplianceResult<SubstantialModificationAssessmentResponse>
  > {
    try {
      const result = await this.repository.getAssessment(
        command.organizationId,
        command.actorId,
        command.productId,
        command.assessmentId,
      );
      return result.outcome === "found"
        ? success(Object.freeze({ assessment: result.assessment }))
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async createAssessment(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      input: CreateSubstantialModificationAssessmentInput;
    }>,
  ): Promise<
    ProductComplianceResult<SubstantialModificationAssessmentResponse>
  > {
    const input = Object.freeze({
      ...command.input,
      suggestion: suggestSubstantialModification(command.input.answers)
        .suggestion,
    });
    try {
      return this.assessmentMutation(
        await this.repository.createAssessment(
          command.organizationId,
          command.actorId,
          command.productId,
          input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async createAssessmentDraft(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      input: CreateSubstantialModificationAssessmentDraftInput;
    }>,
  ): Promise<
    ProductComplianceResult<SubstantialModificationAssessmentResponse>
  > {
    const input: IncompleteAssessmentDraft = Object.freeze({
      ...command.input,
      suggestion: null,
    });
    try {
      return this.assessmentMutation(
        await this.repository.createAssessmentDraft(
          command.organizationId,
          command.actorId,
          command.productId,
          input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async reassessAssessment(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      assessmentId: string;
      input: ReassessSubstantialModificationAssessmentInput;
    }>,
  ): Promise<
    ProductComplianceResult<SubstantialModificationAssessmentResponse>
  > {
    const input = Object.freeze({
      ...command.input,
      suggestion: suggestSubstantialModification(command.input.answers)
        .suggestion,
    });
    try {
      return this.assessmentMutation(
        await this.repository.reassessAssessment(
          command.organizationId,
          command.actorId,
          command.productId,
          command.assessmentId,
          input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async reviewAssessment(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      assessmentId: string;
      input: ReviewSubstantialModificationAssessmentInput;
    }>,
  ): Promise<
    ProductComplianceResult<SubstantialModificationAssessmentResponse>
  > {
    try {
      const current = await this.repository.getAssessment(
        command.organizationId,
        command.actorId,
        command.productId,
        command.assessmentId,
      );
      if (current.outcome !== "found") return this.notFound();
      if (
        current.assessment.completenessState !== "complete" ||
        current.assessment.suggestion === null
      ) {
        return failure(Object.freeze({ code: "invalid_state" as const }));
      }
      if (
        command.input.determination !== current.assessment.suggestion &&
        !command.input.overrideReason?.trim()
      ) {
        return failure(Object.freeze({ code: "invalid_request" as const }));
      }
      return this.assessmentMutation(
        await this.repository.reviewAssessment(
          command.organizationId,
          command.actorId,
          command.productId,
          command.assessmentId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async listArtifacts(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      query: SecurityUpdateArtifactListQuery;
    }>,
  ): Promise<ProductComplianceResult<SecurityUpdateArtifactListResponse>> {
    try {
      const result = await this.repository.listArtifacts(
        command.organizationId,
        command.actorId,
        command.productId,
        command.query,
      );
      return result.outcome === "found"
        ? success(Object.freeze({ artifacts: result.artifacts }))
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async getArtifact(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      artifactId: string;
    }>,
  ): Promise<ProductComplianceResult<SecurityUpdateArtifactResponse>> {
    try {
      const result = await this.repository.getArtifact(
        command.organizationId,
        command.actorId,
        command.productId,
        command.artifactId,
      );
      return result.outcome === "found"
        ? success(Object.freeze({ artifact: result.artifact }))
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async reserveArtifact(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      input: ReserveSecurityUpdateArtifactInput;
    }>,
  ): Promise<ProductComplianceResult<SecurityUpdateArtifactReserveResponse>> {
    try {
      const reservationInput = await this.reservationInput(command.input);
      if (!reservationInput.ok) return reservationInput;
      const reservation = await this.repository.reserveArtifact(
        command.organizationId,
        command.actorId,
        command.productId,
        reservationInput.value,
      );
      if (
        reservation.outcome !== "reserved" &&
        reservation.outcome !== "replayed"
      ) {
        return this.mutationFailure(reservation.outcome);
      }
      if (reservation.artifact.distributionKind === "external_reference") {
        if (reservation.objectKey !== null) {
          return failure(
            Object.freeze({ code: "malformed_provider" as const }),
          );
        }
        return success(
          Object.freeze({ artifact: reservation.artifact, upload: null }),
        );
      }
      if (reservation.objectKey === null) {
        return failure(Object.freeze({ code: "malformed_provider" as const }));
      }
      const upload = await this.storage.createSignedUpload({
        objectKey: reservation.objectKey,
        contentType: reservation.artifact.contentType,
        byteSize: reservation.artifact.byteSize,
      });
      return success(Object.freeze({ artifact: reservation.artifact, upload }));
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  private async reservationInput(
    input: ReserveSecurityUpdateArtifactInput,
  ): Promise<ProductComplianceResult<ArtifactReservationCommand>> {
    const {
      externalReferenceCandidates,
      serverValidationRequired,
      ...request
    } = input;
    if (input.distributionKind !== "external_reference") {
      return success(
        Object.freeze({
          request,
          validatedExternalReferences: Object.freeze([]),
        }),
      );
    }
    if (
      !this.externalReferences ||
      !externalReferenceCandidates ||
      serverValidationRequired !== true
    ) {
      return failure(Object.freeze({ code: "invalid_request" as const }));
    }
    const validated = await this.externalReferences.validate(
      externalReferenceCandidates,
    );
    if (validated.outcome !== "validated") {
      return failure(Object.freeze({ code: "invalid_request" as const }));
    }
    return success(
      Object.freeze({
        request,
        validatedExternalReferences: validated.references,
      }),
    );
  }

  async finalizeArtifact(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      artifactId: string;
      input: FinalizeSecurityUpdateArtifactInput;
    }>,
  ): Promise<ProductComplianceResult<SecurityUpdateArtifactResponse>> {
    try {
      const current = await this.repository.getArtifact(
        command.organizationId,
        command.actorId,
        command.productId,
        command.artifactId,
      );
      if (current.outcome !== "found") return this.notFound();
      if (current.artifact.distributionKind === "external_reference") {
        return failure(Object.freeze({ code: "invalid_state" as const }));
      }
      if (current.artifact.byteSize > this.maxSyncInspectBytes) {
        // Large objects never buffer through the API request. Reservation
        // already enqueued the durable inspect event, so the worker
        // finalizes them out of band; return the pending state for polling.
        return success(Object.freeze({ artifact: current.artifact }));
      }
      const inspection = await this.storage.inspect({
        objectKey: artifactObjectKey(
          command.organizationId,
          current.artifact.sha256,
        ),
        sha256: current.artifact.sha256,
        byteSize: current.artifact.byteSize,
        contentType: current.artifact.contentType,
      });
      return this.artifactMutation(
        await this.repository.finalizeArtifact(
          command.organizationId,
          command.actorId,
          command.productId,
          command.artifactId,
          Object.freeze({ request: command.input, inspection }),
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async reviewArtifact(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      artifactId: string;
      input: ReviewSecurityUpdateArtifactInput;
    }>,
  ): Promise<ProductComplianceResult<SecurityUpdateArtifactResponse>> {
    try {
      const current = await this.repository.getArtifact(
        command.organizationId,
        command.actorId,
        command.productId,
        command.artifactId,
      );
      if (current.outcome !== "found") return this.notFound();
      if (current.artifact.integrityStatus !== "verified") {
        return failure(Object.freeze({ code: "invalid_state" as const }));
      }
      return this.artifactMutation(
        await this.repository.reviewArtifact(
          command.organizationId,
          command.actorId,
          command.productId,
          command.artifactId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async publishArtifact(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      artifactId: string;
      input: PublishSecurityUpdateArtifactInput;
    }>,
  ): Promise<ProductComplianceResult<SecurityUpdateArtifactResponse>> {
    try {
      const current = await this.repository.getArtifact(
        command.organizationId,
        command.actorId,
        command.productId,
        command.artifactId,
      );
      if (current.outcome !== "found") return this.notFound();
      if (current.artifact.integrityStatus !== "verified") {
        return failure(Object.freeze({ code: "invalid_state" as const }));
      }
      const publishedExternalReferences =
        current.artifact.distributionKind === "external_reference"
          ? current.artifact.distributionReference === null ||
            current.artifact.publishedExternalReferences.length === 0
            ? null
            : current.artifact.publishedExternalReferences
          : Object.freeze([]);
      if (publishedExternalReferences === null) {
        return failure(Object.freeze({ code: "invalid_state" as const }));
      }
      return this.artifactMutation(
        await this.repository.publishArtifact(
          command.organizationId,
          command.actorId,
          command.productId,
          command.artifactId,
          Object.freeze({
            request: command.input,
            publishedExternalReferences,
          }),
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async replaceArtifact(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      artifactId: string;
      input: ReplaceSecurityUpdateArtifactInput;
    }>,
  ): Promise<ProductComplianceResult<SecurityUpdateArtifactResponse>> {
    try {
      return this.artifactMutation(
        await this.repository.replaceArtifact(
          command.organizationId,
          command.actorId,
          command.productId,
          command.artifactId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async withdrawArtifact(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      artifactId: string;
      input: WithdrawSecurityUpdateArtifactInput;
    }>,
  ): Promise<ProductComplianceResult<SecurityUpdateArtifactResponse>> {
    try {
      return this.artifactMutation(
        await this.repository.withdrawArtifact(
          command.organizationId,
          command.actorId,
          command.productId,
          command.artifactId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async updateArtifactMetadata(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      artifactId: string;
      input: UpdateSecurityUpdateArtifactMetadataInput;
    }>,
  ): Promise<ProductComplianceResult<SecurityUpdateArtifactResponse>> {
    try {
      return this.artifactMutation(
        await this.repository.updateArtifactMetadata(
          command.organizationId,
          command.actorId,
          command.productId,
          command.artifactId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async downloadArtifact(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      artifactId: string;
    }>,
  ): Promise<ProductComplianceResult<SecurityUpdateArtifactDownloadResponse>> {
    try {
      const result = await this.repository.requestArtifactDownload(
        command.organizationId,
        command.actorId,
        command.productId,
        command.artifactId,
      );
      if (result.outcome !== "found")
        return this.mutationFailure(result.outcome);
      const download = await this.storage.createSignedDownload({
        objectKey: result.objectKey,
        fileName: result.artifact.fileName,
        contentType: result.artifact.contentType,
      });
      return success(Object.freeze({ download }));
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  private assessmentMutation(
    result: ComplianceMutationOutcome<
      SubstantialModificationAssessment,
      "created" | "reassessed" | "replayed" | "reviewed"
    >,
  ): ProductComplianceResult<SubstantialModificationAssessmentResponse> {
    return "value" in result
      ? success(Object.freeze({ assessment: result.value }))
      : this.mutationFailure(result.outcome);
  }

  private artifactMutation(
    result: ComplianceMutationOutcome<
      SecurityUpdateArtifact,
      | "finalized"
      | "replayed"
      | "reviewed"
      | "published"
      | "replaced"
      | "withdrawn"
      | "updated"
    >,
  ): ProductComplianceResult<SecurityUpdateArtifactResponse> {
    return "value" in result
      ? success(Object.freeze({ artifact: result.value }))
      : this.mutationFailure(result.outcome);
  }

  private mutationFailure(
    outcome:
      | "conflict"
      | "not_found"
      | "invalid_request"
      | "invalid_state"
      | "incomplete"
      | "blocked",
  ): ProductComplianceResult<never> {
    return failure(Object.freeze({ code: outcome }));
  }

  private notFound(): ProductComplianceResult<never> {
    return failure(Object.freeze({ code: "not_found" as const }));
  }

  private providerFailure(error: unknown): ProductComplianceResult<never> {
    return failure(
      Object.freeze({
        code:
          error instanceof ProductComplianceProviderError &&
          error.code === "malformed"
            ? ("malformed_provider" as const)
            : ("unavailable" as const),
      }),
    );
  }
}

export const PRODUCT_COMPLIANCE_REPOSITORY = Symbol(
  "PRODUCT_COMPLIANCE_REPOSITORY",
);

const artifactObjectKey = (
  organizationId: string,
  contentHash: string,
): string => `${organizationId}/${contentHash}`;
