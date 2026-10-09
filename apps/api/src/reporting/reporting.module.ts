import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { MailModule } from "../mail/mail.module";
import { SupabaseModule } from "../supabase/supabase.module";
import { AuthModule } from "../auth/auth.module";
import {
  REPORTING_DEADLINE_MONITOR_HEALTH_READER,
  ReportingDeadlineMonitorHealthUseCases,
  type ReportingDeadlineMonitorHealthReader,
} from "./application/reporting-deadline-monitor-health.port";
import {
  REPORTING_OBLIGATION_REPOSITORY,
  REPORTING_STAGE_APPROVAL_REAUTHENTICATION,
  type ReportingObligationRepository,
  type ReportingStageApprovalReauthenticationPort,
} from "./application/reporting-obligation.port";
import { ReportingObligationUseCases } from "./application/reporting-obligation-use-cases";
import { SupabaseReportingObligationRepository } from "./infrastructure/supabase-reporting-obligation.repository";
import { ReportingEvidenceWorkflowService } from "./infrastructure/reporting-evidence-workflow.service";
import { ExistingAuthReportingStageApprovalReauthenticationAdapter } from "./infrastructure/reporting-stage-approval-reauthentication.adapter";
import { MailReportingDeadlineDeliveryAdapter } from "./infrastructure/mail-reporting-deadline-delivery.adapter";
import { SupabaseReportingDeadlineMonitorRepository } from "./infrastructure/supabase-reporting-deadline-monitor.repository";
import { ReportingObligationController } from "./reporting-obligation.controller";
import { ReportingRehearsalController } from "./reporting-rehearsal.controller";
import { ReportingDeadlineMonitorWorker } from "./worker/reporting-deadline-monitor-worker";

@Module({
  imports: [SupabaseModule, MailModule, AuthModule],
  controllers: [ReportingObligationController, ReportingRehearsalController],
  providers: [
    SupabaseReportingObligationRepository,
    ReportingEvidenceWorkflowService,
    ExistingAuthReportingStageApprovalReauthenticationAdapter,
    {
      provide: REPORTING_STAGE_APPROVAL_REAUTHENTICATION,
      useExisting: ExistingAuthReportingStageApprovalReauthenticationAdapter,
    },
    SupabaseReportingDeadlineMonitorRepository,
    MailReportingDeadlineDeliveryAdapter,
    {
      provide: REPORTING_OBLIGATION_REPOSITORY,
      useExisting: SupabaseReportingObligationRepository,
    },
    {
      provide: ReportingObligationUseCases,
      inject: [
        REPORTING_OBLIGATION_REPOSITORY,
        REPORTING_STAGE_APPROVAL_REAUTHENTICATION,
        ReportingEvidenceWorkflowService,
      ],
      useFactory: (
        repository: ReportingObligationRepository,
        reauthentication: ReportingStageApprovalReauthenticationPort,
        evidence: ReportingEvidenceWorkflowService,
      ) =>
        new ReportingObligationUseCases(repository, reauthentication, evidence),
    },
    {
      provide: ReportingDeadlineMonitorWorker,
      inject: [
        SupabaseReportingDeadlineMonitorRepository,
        MailReportingDeadlineDeliveryAdapter,
        ConfigService,
      ],
      useFactory: (
        repository: SupabaseReportingDeadlineMonitorRepository,
        delivery: MailReportingDeadlineDeliveryAdapter,
        config: ConfigService,
      ) =>
        new ReportingDeadlineMonitorWorker({
          workerId: randomUUID(),
          leaseSeconds: config.getOrThrow<number>(
            "REPORTING_DEADLINE_MONITOR_LEASE_SECONDS",
          ),
          maximumClockSkewMilliseconds: config.getOrThrow<number>(
            "REPORTING_DEADLINE_MONITOR_MAX_CLOCK_SKEW_MILLISECONDS",
          ),
          clock: repository.clock,
          queue: repository.queue,
          delivery,
        }),
    },
    {
      provide: REPORTING_DEADLINE_MONITOR_HEALTH_READER,
      useExisting: SupabaseReportingDeadlineMonitorRepository,
    },
    {
      provide: ReportingDeadlineMonitorHealthUseCases,
      inject: [REPORTING_DEADLINE_MONITOR_HEALTH_READER],
      useFactory: (reader: ReportingDeadlineMonitorHealthReader) =>
        new ReportingDeadlineMonitorHealthUseCases(reader),
    },
  ],
  exports: [ReportingDeadlineMonitorHealthUseCases],
})
export class ReportingModule {}
