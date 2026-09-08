import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { ProductsModule } from "../products/products.module";
import {
  PRODUCT_RELATIONSHIP_GRAPH_EVENT_WORKER,
  PRODUCT_RELATIONSHIP_PROPAGATION_WORKER,
  type ProductRelationshipGraphEventWorkerPort,
  type ProductRelationshipPropagationWorkerPort,
} from "../products/application/product-relationship-worker.port";
import { SupabaseModule } from "../supabase/supabase.module";
import {
  FINDING_PROPAGATION_REPOSITORY,
  FindingPropagationUseCases,
  type FindingPropagationRepository,
} from "./application/finding-propagation-use-cases";
import {
  FindingPropagationSourcesController,
  ProductFindingImpactSummaryController,
} from "./findings.controller";
import { FindingsService } from "./findings.service";
import { SupabaseFindingPropagationRepository } from "./infrastructure/supabase-finding-propagation.repository";
import { VulnerabilityAssessmentController } from "./assessments/vulnerability-assessment.controller";
import { VulnerabilityAssessmentBulkController } from "./assessments/bulk/vulnerability-assessment-bulk.controller";
import {
  VULNERABILITY_ASSESSMENT_BULK_REPOSITORY,
  type VulnerabilityAssessmentBulkRepository,
} from "./assessments/bulk/application/vulnerability-assessment-bulk.port";
import { VulnerabilityAssessmentBulkUseCases } from "./assessments/bulk/application/vulnerability-assessment-bulk-use-cases";
import { SupabaseVulnerabilityAssessmentBulkRepository } from "./assessments/bulk/infrastructure/supabase-vulnerability-assessment-bulk.repository";
import {
  VULNERABILITY_ASSESSMENT_REPOSITORY,
  type VulnerabilityAssessmentRepository,
} from "./assessments/application/vulnerability-assessment.port";
import { VulnerabilityAssessmentUseCases } from "./assessments/application/vulnerability-assessment-use-cases";
import { SupabaseVulnerabilityAssessmentRepository } from "./assessments/infrastructure/supabase-vulnerability-assessment.repository";
import { VulnerabilityTriageController } from "./triage/vulnerability-triage.controller";
import {
  VULNERABILITY_TRIAGE_REPOSITORY,
  type VulnerabilityTriageRepository,
} from "./triage/application/vulnerability-triage.port";
import { VulnerabilityTriageUseCases } from "./triage/application/vulnerability-triage-use-cases";
import { SupabaseVulnerabilityTriageRepository } from "./triage/infrastructure/supabase-vulnerability-triage.repository";
import {
  FindingPropagationWorker,
  type FindingPropagationWorkerRepository,
} from "./worker/finding-propagation-worker";

@Module({
  imports: [SupabaseModule, ProductsModule],
  controllers: [
    FindingPropagationSourcesController,
    ProductFindingImpactSummaryController,
    // This controller must precede triage's GET :findingId route so the
    // policy static path cannot be parsed as a finding ID.
    VulnerabilityAssessmentController,
    VulnerabilityAssessmentBulkController,
    VulnerabilityTriageController,
  ],
  providers: [
    SupabaseFindingPropagationRepository,
    SupabaseVulnerabilityAssessmentRepository,
    SupabaseVulnerabilityAssessmentBulkRepository,
    SupabaseVulnerabilityTriageRepository,
    {
      provide: VULNERABILITY_ASSESSMENT_REPOSITORY,
      useExisting: SupabaseVulnerabilityAssessmentRepository,
    },
    {
      provide: VULNERABILITY_ASSESSMENT_BULK_REPOSITORY,
      useExisting: SupabaseVulnerabilityAssessmentBulkRepository,
    },
    {
      provide: VulnerabilityAssessmentUseCases,
      inject: [VULNERABILITY_ASSESSMENT_REPOSITORY],
      useFactory: (repository: VulnerabilityAssessmentRepository) =>
        new VulnerabilityAssessmentUseCases(repository),
    },
    {
      provide: VulnerabilityAssessmentBulkUseCases,
      inject: [VULNERABILITY_ASSESSMENT_BULK_REPOSITORY],
      useFactory: (repository: VulnerabilityAssessmentBulkRepository) =>
        new VulnerabilityAssessmentBulkUseCases(repository),
    },
    {
      provide: VULNERABILITY_TRIAGE_REPOSITORY,
      useExisting: SupabaseVulnerabilityTriageRepository,
    },
    {
      provide: VulnerabilityTriageUseCases,
      inject: [VULNERABILITY_TRIAGE_REPOSITORY],
      useFactory: (repository: VulnerabilityTriageRepository) =>
        new VulnerabilityTriageUseCases(repository),
    },
    {
      provide: FINDING_PROPAGATION_REPOSITORY,
      useExisting: SupabaseFindingPropagationRepository,
    },
    {
      provide: FindingPropagationUseCases,
      inject: [FINDING_PROPAGATION_REPOSITORY],
      useFactory: (repository: FindingPropagationRepository) =>
        new FindingPropagationUseCases(repository),
    },
    {
      provide: FindingPropagationWorker,
      inject: [
        SupabaseFindingPropagationRepository,
        PRODUCT_RELATIONSHIP_GRAPH_EVENT_WORKER,
        PRODUCT_RELATIONSHIP_PROPAGATION_WORKER,
        ConfigService,
      ],
      useFactory: (
        queue: FindingPropagationWorkerRepository,
        productEvents: ProductRelationshipGraphEventWorkerPort,
        relationships: ProductRelationshipPropagationWorkerPort,
        config: ConfigService,
      ) =>
        new FindingPropagationWorker({
          workerId: randomUUID(),
          leaseSeconds: config.get<number>(
            "FINDING_PROPAGATION_LEASE_SECONDS",
            60,
          ),
          queue,
          productEvents,
          relationships,
        }),
    },
    FindingsService,
  ],
  exports: [FindingPropagationUseCases, FindingPropagationWorker],
})
export class FindingsModule {}
