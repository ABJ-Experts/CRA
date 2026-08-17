import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { MailModule } from "../mail/mail.module";
import { OrganizationsModule } from "../organizations/organizations.module";
import { SupabaseModule } from "../supabase/supabase.module";
import {
  LEGAL_ENTITY_DIRECTORY,
  type LegalEntityDirectory,
} from "../organizations/legal-entities/application/legal-entity-ports";
import { PermissionsModule } from "../permissions/permissions.module";
import {
  PRODUCT_REPOSITORY,
  ProductUseCases,
  type ProductRepository,
} from "./application/product-use-cases";
import {
  RELEASE_MARKET_AVAILABILITY_READER,
  RELEASE_REGULATORY_STATE_READER,
} from "./application/release-regulatory-reader.port";
import {
  PRODUCT_RETENTION_PROJECTION,
  PRODUCT_RETENTION_READER,
} from "./application/product-retention-reader.port";
import { PRODUCT_RELATIONSHIP_RESOLVER } from "./application/product-relationship-reader.port";
import {
  PRODUCT_RELATIONSHIP_GRAPH_EVENT_WORKER,
  PRODUCT_RELATIONSHIP_PROPAGATION_WORKER,
} from "./application/product-relationship-worker.port";
import { SupabaseProductRepository } from "./infrastructure/supabase-product.repository";
import { SupabaseProductRelationshipWorkerAdapter } from "./infrastructure/supabase-product-relationship-worker.adapter";
import { ProductsController } from "./products.controller";
import { ProductsService } from "./products.service";
import { ProductRetentionWorker } from "./worker/product-retention-worker";
import {
  MailProductRetentionDeliveryAdapter,
  SupabaseProductRetentionWorkerRepository,
} from "./worker/supabase-product-retention-worker.adapter";

@Module({
  imports: [SupabaseModule, OrganizationsModule, PermissionsModule, MailModule],
  controllers: [ProductsController],
  providers: [
    SupabaseProductRepository,
    { provide: PRODUCT_REPOSITORY, useExisting: SupabaseProductRepository },
    {
      provide: ProductUseCases,
      inject: [PRODUCT_REPOSITORY, LEGAL_ENTITY_DIRECTORY],
      useFactory: (
        repository: ProductRepository,
        legalEntities: LegalEntityDirectory,
      ) => new ProductUseCases(repository, legalEntities),
    },
    {
      provide: RELEASE_REGULATORY_STATE_READER,
      useExisting: ProductUseCases,
    },
    {
      provide: RELEASE_MARKET_AVAILABILITY_READER,
      useExisting: ProductUseCases,
    },
    {
      provide: PRODUCT_RETENTION_READER,
      useExisting: ProductUseCases,
    },
    {
      provide: PRODUCT_RETENTION_PROJECTION,
      useExisting: ProductUseCases,
    },
    {
      provide: PRODUCT_RELATIONSHIP_RESOLVER,
      useExisting: ProductUseCases,
    },
    SupabaseProductRelationshipWorkerAdapter,
    {
      provide: PRODUCT_RELATIONSHIP_GRAPH_EVENT_WORKER,
      useExisting: SupabaseProductRelationshipWorkerAdapter,
    },
    {
      provide: PRODUCT_RELATIONSHIP_PROPAGATION_WORKER,
      useExisting: SupabaseProductRelationshipWorkerAdapter,
    },
    SupabaseProductRetentionWorkerRepository,
    MailProductRetentionDeliveryAdapter,
    {
      provide: ProductRetentionWorker,
      inject: [
        SupabaseProductRetentionWorkerRepository,
        MailProductRetentionDeliveryAdapter,
        ConfigService,
      ],
      useFactory: (
        repository: SupabaseProductRetentionWorkerRepository,
        delivery: MailProductRetentionDeliveryAdapter,
        config: ConfigService,
      ) =>
        new ProductRetentionWorker({
          workerId: randomUUID(),
          leaseSeconds: config.getOrThrow<number>(
            "PRODUCT_RETENTION_ALERT_LEASE_SECONDS",
          ),
          maximumClockSkewMilliseconds: config.getOrThrow<number>(
            "PRODUCT_RETENTION_MAX_CLOCK_SKEW_MILLISECONDS",
          ),
          clock: repository.clock,
          queue: repository.queue,
          recipients: repository.recipients,
          delivery,
        }),
    },
    ProductsService,
  ],
  exports: [
    ProductUseCases,
    RELEASE_REGULATORY_STATE_READER,
    RELEASE_MARKET_AVAILABILITY_READER,
    PRODUCT_RETENTION_READER,
    PRODUCT_RETENTION_PROJECTION,
    PRODUCT_RELATIONSHIP_RESOLVER,
    PRODUCT_RELATIONSHIP_GRAPH_EVENT_WORKER,
    PRODUCT_RELATIONSHIP_PROPAGATION_WORKER,
    ProductRetentionWorker,
  ],
})
export class ProductsModule {}
