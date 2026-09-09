import { Module } from "@nestjs/common";

import { SupabaseModule } from "../supabase/supabase.module";
import {
  REPORTING_OBLIGATION_REPOSITORY,
  type ReportingObligationRepository,
} from "./application/reporting-obligation.port";
import { ReportingObligationUseCases } from "./application/reporting-obligation-use-cases";
import { SupabaseReportingObligationRepository } from "./infrastructure/supabase-reporting-obligation.repository";
import { ReportingObligationController } from "./reporting-obligation.controller";

@Module({
  imports: [SupabaseModule],
  controllers: [ReportingObligationController],
  providers: [
    SupabaseReportingObligationRepository,
    {
      provide: REPORTING_OBLIGATION_REPOSITORY,
      useExisting: SupabaseReportingObligationRepository,
    },
    {
      provide: ReportingObligationUseCases,
      inject: [REPORTING_OBLIGATION_REPOSITORY],
      useFactory: (repository: ReportingObligationRepository) =>
        new ReportingObligationUseCases(repository),
    },
  ],
})
export class ReportingModule {}
