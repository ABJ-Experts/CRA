import type {
  CancelReportingObligationInput,
  CorrectReportingObligationAnchorInput,
  CreateReportingObligationInput,
  RecordReportingObligationStageSubmissionInput,
  ReportingObligationDetailResponse,
  ReportingObligationListQuery,
  ReportingObligationListResponse,
  ReportingObligationMutationResponse,
  ReportingDeadlineSummaryResponse,
} from "@repo/contracts/reporting";

export const REPORTING_OBLIGATION_REPOSITORY = Symbol(
  "REPORTING_OBLIGATION_REPOSITORY",
);

export class ReportingObligationConflictError extends Error {}
export class ReportingObligationInvalidRequestError extends Error {}
export class ReportingObligationInvalidStateError extends Error {}

export interface ReportingObligationRepository {
  deadlineSummary(
    organizationId: string,
    input: Readonly<{ actorId: string }>,
  ): Promise<ReportingDeadlineSummaryResponse | null>;
  list(
    organizationId: string,
    input: Readonly<{ actorId: string } & ReportingObligationListQuery>,
  ): Promise<ReportingObligationListResponse | null>;
  detail(
    organizationId: string,
    input: Readonly<{ actorId: string; obligationId: string }>,
  ): Promise<ReportingObligationDetailResponse | null>;
  create(
    organizationId: string,
    input: Readonly<{ actorId: string } & CreateReportingObligationInput>,
  ): Promise<ReportingObligationMutationResponse | null>;
  correctAnchor(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
      } & CorrectReportingObligationAnchorInput
    >,
  ): Promise<ReportingObligationMutationResponse | null>;
  recordSubmission(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
      } & RecordReportingObligationStageSubmissionInput
    >,
  ): Promise<ReportingObligationMutationResponse | null>;
  cancel(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
      } & CancelReportingObligationInput
    >,
  ): Promise<ReportingObligationMutationResponse | null>;
}
