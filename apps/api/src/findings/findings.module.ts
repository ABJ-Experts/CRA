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
import {
  FindingPropagationWorker,
  type FindingPropagationWorkerRepository,
} from "./worker/finding-propagation-worker";

@Module({
  imports: [SupabaseModule, ProductsModule],
  controllers: [
    FindingPropagationSourcesController,
    ProductFindingImpactSummaryController,
  ],
  providers: [
    SupabaseFindingPropagationRepository,
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
