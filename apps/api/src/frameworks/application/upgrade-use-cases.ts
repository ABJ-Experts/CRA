import type { z } from "zod";
import type {
  commitFrameworkUpgradeInputSchema,
  commitFrameworkUpgradeResponseSchema,
  createFrameworkUpgradeReviewInputSchema,
  createFrameworkUpgradeReviewResponseSchema,
  frameworkCrosswalkEvidenceReuseResponseSchema,
  frameworkCrosswalkQuerySchema,
  frameworkCrosswalkResponseSchema,
  frameworkUpgradePreviewQuerySchema,
  frameworkUpgradePreviewResponseSchema,
  frameworkUpgradeReviewQuerySchema,
  frameworkUpgradeReviewResponseSchema,
  upsertFrameworkUpgradeDecisionInputSchema,
  frameworkUpgradeDecisionResponseSchema,
} from "@repo/contracts/frameworks";

export const UPGRADE_REPOSITORY = Symbol("UPGRADE_REPOSITORY");

export class UpgradeConflictError extends Error {}
export class UpgradeForbiddenError extends Error {}
export class UpgradeInvalidRequestError extends Error {}
export class UpgradeNotFoundError extends Error {}
export class UpgradeBlockedError extends Error {}

type CrosswalkQuery = z.output<typeof frameworkCrosswalkQuerySchema>;
type PreviewQuery = z.output<typeof frameworkUpgradePreviewQuerySchema>;
type ReviewQuery = z.output<typeof frameworkUpgradeReviewQuerySchema>;
type CreateInput = z.output<typeof createFrameworkUpgradeReviewInputSchema>;
type DecisionInput = z.output<typeof upsertFrameworkUpgradeDecisionInputSchema>;
type CommitInput = z.output<typeof commitFrameworkUpgradeInputSchema>;

export interface UpgradeRepository {
  crosswalks(
    orgId: string,
    input: Readonly<
      { actorId: string; packKey: string; versionKey: string } & CrosswalkQuery
    >,
  ): Promise<z.output<typeof frameworkCrosswalkResponseSchema>>;
  preview(
    orgId: string,
    input: Readonly<
      {
        actorId: string;
        packKey: string;
        targetVersionKey: string;
      } & PreviewQuery
    >,
  ): Promise<z.output<typeof frameworkUpgradePreviewResponseSchema>>;
  createReview(
    orgId: string,
    input: Readonly<{ actorId: string; packKey: string } & CreateInput>,
  ): Promise<z.output<typeof createFrameworkUpgradeReviewResponseSchema>>;
  review(
    orgId: string,
    input: Readonly<
      { actorId: string; packKey: string; reviewId: string } & ReviewQuery
    >,
  ): Promise<z.output<typeof frameworkUpgradeReviewResponseSchema>>;
  decide(
    orgId: string,
    input: Readonly<
      {
        actorId: string;
        packKey: string;
        reviewId: string;
        mappingId: string;
      } & DecisionInput
    >,
  ): Promise<z.output<typeof frameworkUpgradeDecisionResponseSchema>>;
  commit(
    orgId: string,
    input: Readonly<
      { actorId: string; packKey: string; reviewId: string } & CommitInput
    >,
  ): Promise<z.output<typeof commitFrameworkUpgradeResponseSchema>>;
  evidenceReuse(
    orgId: string,
    input: Readonly<
      {
        actorId: string;
        evidenceVersionId: string;
        productId: string;
      } & CrosswalkQuery
    >,
  ): Promise<z.output<typeof frameworkCrosswalkEvidenceReuseResponseSchema>>;
}

export class UpgradeUseCases {
  constructor(private readonly repository: UpgradeRepository) {}

  crosswalks(
    orgId: string,
    input: Parameters<UpgradeRepository["crosswalks"]>[1],
  ) {
    return this.repository.crosswalks(orgId, input);
  }

  preview(orgId: string, input: Parameters<UpgradeRepository["preview"]>[1]) {
    return this.repository.preview(orgId, input);
  }

  createReview(
    orgId: string,
    input: Parameters<UpgradeRepository["createReview"]>[1],
  ) {
    return this.repository.createReview(orgId, input);
  }

  review(orgId: string, input: Parameters<UpgradeRepository["review"]>[1]) {
    return this.repository.review(orgId, input);
  }

  decide(orgId: string, input: Parameters<UpgradeRepository["decide"]>[1]) {
    return this.repository.decide(orgId, input);
  }

  commit(orgId: string, input: Parameters<UpgradeRepository["commit"]>[1]) {
    return this.repository.commit(orgId, input);
  }

  evidenceReuse(
    orgId: string,
    input: Parameters<UpgradeRepository["evidenceReuse"]>[1],
  ) {
    return this.repository.evidenceReuse(orgId, input);
  }
}
