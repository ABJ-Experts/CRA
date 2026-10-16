import type {
  CreateSbomCompositeReviewInput,
  GenerateSbomCompositeInput,
  ResolveSbomCompositeConflictInput,
  ResolveSbomCompositeRelationshipInput,
  SbomCompositeGenerationResponse,
  SbomCompositeReviewResponse,
} from "@repo/contracts/sboms";

import { failure, success, type Result } from "../../common/domain/result";
import type { SbomIntakeError } from "./sbom-intake-use-cases";

export const SBOM_COMPOSITE_REPOSITORY = Symbol("SBOM_COMPOSITE_REPOSITORY");

/**
 * Persistence boundary for immutable composite reviews.  Every operation is
 * organization-first so a service-role adapter can make cross-tenant lookup
 * indistinguishable from a missing resource.
 */
export interface SbomCompositeRepository {
  validateScope(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      releaseId: string;
      sourceIds: readonly string[];
    }>,
  ): Promise<"compatible" | "not_found" | "conflict">;
  createReview(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        releaseId: string;
      } & CreateSbomCompositeReviewInput
    >,
  ): Promise<
    | Readonly<{
        outcome: "created" | "replayed";
        response: SbomCompositeReviewResponse;
      }>
    | Readonly<{
        outcome: "not_found" | "conflict" | "invalid_request";
      }>
  >;
  getReview(
    organizationId: string,
    input: Readonly<{ actorId: string; reviewId: string }>,
  ): Promise<SbomCompositeReviewResponse | null>;
  resolveConflict(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        reviewId: string;
        conflictId: string;
      } & ResolveSbomCompositeConflictInput
    >,
  ): Promise<
    | Readonly<{
        outcome: "resolved" | "replayed";
        response: SbomCompositeReviewResponse;
      }>
    | Readonly<{ outcome: "not_found" | "conflict" | "invalid_request" }>
  >;
  resolveRelationship(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        reviewId: string;
        relationshipId: string;
      } & ResolveSbomCompositeRelationshipInput
    >,
  ): Promise<
    | Readonly<{
        outcome: "resolved" | "replayed";
        response: SbomCompositeReviewResponse;
      }>
    | Readonly<{ outcome: "not_found" | "conflict" | "invalid_request" }>
  >;
  generate(
    organizationId: string,
    input: Readonly<
      { actorId: string; reviewId: string } & GenerateSbomCompositeInput
    >,
  ): Promise<
    | Readonly<{
        outcome: "queued" | "replayed";
        response: SbomCompositeGenerationResponse;
      }>
    | Readonly<{ outcome: "not_found" | "conflict" | "invalid_request" }>
  >;
}

/** Framework-free composite workflow. Conflict choices are persisted by the adapter. */
export class SbomCompositeUseCases {
  constructor(private readonly repository: SbomCompositeRepository) {}

  async create(
    command: Readonly<
      {
        organizationId: string;
        actorId: string;
        productId: string;
        releaseId: string;
      } & CreateSbomCompositeReviewInput
    >,
  ): Promise<Result<SbomCompositeReviewResponse, SbomIntakeError>> {
    try {
      const scope = await this.repository.validateScope(
        command.organizationId,
        {
          actorId: command.actorId,
          productId: command.productId,
          releaseId: command.releaseId,
          sourceIds: command.sourceIds,
        },
      );
      if (scope !== "compatible") {
        return failure({
          code: scope === "not_found" ? "not_found" : "conflict",
        });
      }
      const result = await this.repository.createReview(
        command.organizationId,
        command,
      );
      return this.writeResult(result);
    } catch {
      return failure({ code: "unavailable" });
    }
  }

  async review(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      reviewId: string;
    }>,
  ): Promise<Result<SbomCompositeReviewResponse, SbomIntakeError>> {
    try {
      const review = await this.repository.getReview(command.organizationId, {
        actorId: command.actorId,
        reviewId: command.reviewId,
      });
      return review ? success(review) : failure({ code: "not_found" });
    } catch {
      return failure({ code: "unavailable" });
    }
  }

  async resolveConflict(
    command: Readonly<
      {
        organizationId: string;
        actorId: string;
        reviewId: string;
        conflictId: string;
      } & ResolveSbomCompositeConflictInput
    >,
  ): Promise<Result<SbomCompositeReviewResponse, SbomIntakeError>> {
    try {
      return this.writeResult(
        await this.repository.resolveConflict(command.organizationId, command),
      );
    } catch {
      return failure({ code: "unavailable" });
    }
  }

  async resolveRelationship(
    command: Readonly<
      {
        organizationId: string;
        actorId: string;
        reviewId: string;
        relationshipId: string;
      } & ResolveSbomCompositeRelationshipInput
    >,
  ): Promise<Result<SbomCompositeReviewResponse, SbomIntakeError>> {
    try {
      return this.writeResult(
        await this.repository.resolveRelationship(
          command.organizationId,
          command,
        ),
      );
    } catch {
      return failure({ code: "unavailable" });
    }
  }

  async generate(
    command: Readonly<
      {
        organizationId: string;
        actorId: string;
        reviewId: string;
      } & GenerateSbomCompositeInput
    >,
  ): Promise<Result<SbomCompositeGenerationResponse, SbomIntakeError>> {
    try {
      const result = await this.repository.generate(
        command.organizationId,
        command,
      );
      if ("response" in result) return success(result.response);
      return failure({
        code:
          result.outcome === "not_found"
            ? "not_found"
            : result.outcome === "invalid_request"
              ? "invalid_request"
              : "conflict",
      });
    } catch {
      return failure({ code: "unavailable" });
    }
  }

  private writeResult(
    result:
      | Readonly<{
          outcome: "created" | "replayed" | "resolved" | "queued";
          response: SbomCompositeReviewResponse;
        }>
      | Readonly<{ outcome: "not_found" | "conflict" | "invalid_request" }>,
  ): Result<SbomCompositeReviewResponse, SbomIntakeError> {
    if ("response" in result) return success(result.response);
    return failure({
      code:
        result.outcome === "not_found"
          ? "not_found"
          : result.outcome === "invalid_request"
            ? "invalid_request"
            : "conflict",
    });
  }
}
