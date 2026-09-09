import type {
  CancelReportingObligationInput,
  CorrectReportingObligationAnchorInput,
  CreateReportingObligationInput,
  RecordReportingObligationStageSubmissionInput,
  ReportingObligationListQuery,
} from "@repo/contracts/reporting";

import type { ReportingObligationRepository } from "./reporting-obligation.port";

export class ReportingObligationUseCases {
  constructor(private readonly repository: ReportingObligationRepository) {}

  list(
    organizationId: string,
    input: Readonly<{ actorId: string } & ReportingObligationListQuery>,
  ) {
    return this.repository.list(organizationId, input);
  }

  detail(
    organizationId: string,
    input: Readonly<{ actorId: string; obligationId: string }>,
  ) {
    return this.repository.detail(organizationId, input);
  }

  create(
    organizationId: string,
    input: Readonly<{ actorId: string } & CreateReportingObligationInput>,
  ) {
    return this.repository.create(organizationId, input);
  }

  correctAnchor(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
      } & CorrectReportingObligationAnchorInput
    >,
  ) {
    return this.repository.correctAnchor(organizationId, input);
  }

  recordSubmission(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
      } & RecordReportingObligationStageSubmissionInput
    >,
  ) {
    return this.repository.recordSubmission(organizationId, input);
  }

  cancel(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
      } & CancelReportingObligationInput
    >,
  ) {
    return this.repository.cancel(organizationId, input);
  }
}
