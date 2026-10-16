import type {
  RecalculateTechnicalFileReadinessRequest,
  ReviewTechnicalFileSourceRequest,
  SignalTechnicalFileSourceMaterialChangeRequest,
  TechnicalFileEvidenceLink,
  TechnicalFileEvidenceReviewResponse,
  TechnicalFileReadiness,
} from "@repo/contracts/technical-files";

export const TECHNICAL_FILE_READINESS_REPOSITORY = Symbol(
  "TECHNICAL_FILE_READINESS_REPOSITORY",
);

export interface TechnicalFileReadinessRepository {
  get(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string }>,
  ): Promise<TechnicalFileReadiness | null>;
  recalculate(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
      } & RecalculateTechnicalFileReadinessRequest
    >,
  ): Promise<TechnicalFileReadiness | null>;
  reviewSource(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        sectionKey: string;
        sourceId: string;
      } & ReviewTechnicalFileSourceRequest
    >,
  ): Promise<TechnicalFileEvidenceReviewResponse | null>;
  signalMaterialChange(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        sectionKey: string;
        sourceId: string;
      } & SignalTechnicalFileSourceMaterialChangeRequest
    >,
  ): Promise<TechnicalFileEvidenceLink | null>;
}

export class TechnicalFileReadinessConflictError extends Error {
  constructor(readonly currentVersion: number | null = null) {
    super("The evidence link changed.");
  }
}

/** A scoped evidence/source reference was unavailable or cannot be reviewed. */
export class TechnicalFileReadinessInvalidRequestError extends Error {}
