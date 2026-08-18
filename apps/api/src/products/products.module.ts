import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { MailModule } from "../mail/mail.module";
import { OrganizationsModule } from "../organizations/organizations.module";
import { SupabaseModule } from "../supabase/supabase.module";
import { SupabaseService } from "../supabase/supabase.service";
import {
  LEGAL_ENTITY_DIRECTORY,
  type LegalEntityDirectory,
} from "../organizations/legal-entities/application/legal-entity-ports";
import { PermissionsModule } from "../permissions/permissions.module";
import { PermissionsService } from "../permissions/permissions.service";
import {
  PRODUCT_REPOSITORY,
  ProductUseCases,
  type ProductRepository,
} from "./application/product-use-cases";
import {
  PRODUCT_COMPLIANCE_REPOSITORY,
  ProductComplianceUseCases,
  type ProductComplianceRepository,
  type ProductComplianceStoragePort,
} from "./application/product-compliance-use-cases";
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
import { NodeProductComplianceExternalReferenceValidator } from "./infrastructure/node-product-compliance-external-reference-validator";
import { SupabaseProductComplianceRepository } from "./infrastructure/supabase-product-compliance.repository";
import { SupabaseProductComplianceStorageAdapter } from "./infrastructure/supabase-product-compliance-storage.adapter";
import { SupabaseProductRelationshipWorkerAdapter } from "./infrastructure/supabase-product-relationship-worker.adapter";
import { ProductImportWorker } from "./imports/product-import-worker";
import { ProductImportsController } from "./imports/product-imports.controller";
import { ProductImportsService } from "./imports/product-imports.service";
import { ProductImportUseCases } from "./imports/product-release-import-use-cases";
import { SupabaseProductImportRepository } from "./imports/supabase-product-import.repository";
import { ProductsController } from "./products.controller";
import { ProductComplianceService } from "./product-compliance.service";
import { ProductsService } from "./products.service";
import { ProductRetentionWorker } from "./worker/product-retention-worker";
import { ProductComplianceWorker } from "./worker/product-compliance-worker";
import {
  MailProductRetentionDeliveryAdapter,
  SupabaseProductRetentionWorkerRepository,
} from "./worker/supabase-product-retention-worker.adapter";
import { SupabaseProductComplianceWorkerAdapter } from "./worker/supabase-product-compliance-worker.adapter";

@Module({
  imports: [SupabaseModule, OrganizationsModule, PermissionsModule, MailModule],
  controllers: [ProductImportsController, ProductsController],
  providers: [
    SupabaseProductRepository,
    SupabaseProductComplianceRepository,
    SupabaseProductComplianceStorageAdapter,
    {
      provide: SupabaseProductComplianceWorkerAdapter,
      inject: [
        SupabaseService,
        SupabaseProductComplianceStorageAdapter,
        NodeProductComplianceExternalReferenceValidator,
      ],
      useFactory: (
        supabase: SupabaseService,
        storage: SupabaseProductComplianceStorageAdapter,
        externalReferences: NodeProductComplianceExternalReferenceValidator,
      ) =>
        new SupabaseProductComplianceWorkerAdapter(
          supabase,
          storage,
          externalReferences,
        ),
    },
    SupabaseProductImportRepository,
    { provide: PRODUCT_REPOSITORY, useExisting: SupabaseProductRepository },
    {
      provide: PRODUCT_COMPLIANCE_REPOSITORY,
      useExisting: SupabaseProductComplianceRepository,
    },
    {
      provide: ProductUseCases,
      inject: [PRODUCT_REPOSITORY, LEGAL_ENTITY_DIRECTORY],
      useFactory: (
        repository: ProductRepository,
        legalEntities: LegalEntityDirectory,
      ) => new ProductUseCases(repository, legalEntities),
    },
    {
      provide: NodeProductComplianceExternalReferenceValidator,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new NodeProductComplianceExternalReferenceValidator({
          allowedHosts: (
            config.get<string>(
              "PRODUCT_SECURITY_UPDATE_EXTERNAL_REFERENCE_ALLOWED_HOSTS",
            ) ?? ""
          )
            .split(",")
            .map((host) => host.trim())
            .filter((host) => host.length > 0),
        }),
    },
    {
      provide: ProductComplianceUseCases,
      inject: [
        PRODUCT_COMPLIANCE_REPOSITORY,
        SupabaseProductComplianceStorageAdapter,
        NodeProductComplianceExternalReferenceValidator,
      ],
      useFactory: (
        repository: ProductComplianceRepository,
        storage: ProductComplianceStoragePort,
        externalReferences: NodeProductComplianceExternalReferenceValidator,
      ) =>
        new ProductComplianceUseCases(repository, storage, externalReferences),
    },
    ProductComplianceService,
    {
      provide: ProductComplianceWorker,
      inject: [SupabaseProductComplianceWorkerAdapter, ConfigService],
      useFactory: (
        adapter: SupabaseProductComplianceWorkerAdapter,
        config: ConfigService,
      ) =>
        new ProductComplianceWorker({
          workerId: randomUUID(),
          leaseSeconds: config.getOrThrow<number>(
            "PRODUCT_COMPLIANCE_LEASE_SECONDS",
          ),
          queue: adapter.queue,
          processor: adapter.processor,
        }),
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
    {
      provide: ProductImportUseCases,
      inject: [SupabaseProductImportRepository],
      useFactory: (repository: SupabaseProductImportRepository) =>
        new ProductImportUseCases(repository),
    },
    ProductImportsService,
    {
      provide: ProductImportWorker,
      inject: [
        SupabaseProductImportRepository,
        ProductImportUseCases,
        PermissionsService,
        ConfigService,
      ],
      useFactory: (
        repository: SupabaseProductImportRepository,
        useCases: ProductImportUseCases,
        permissions: PermissionsService,
        config: ConfigService,
      ) =>
        new ProductImportWorker({
          workerId: randomUUID(),
          leaseSeconds: config.getOrThrow<number>(
            "PRODUCT_IMPORT_LEASE_SECONDS",
          ),
          repository,
          useCases,
          authorizeCommit: async (organizationId, actorId) => {
            const role = await repository.actorBaseRole(
              organizationId,
              actorId,
            );
            return role
              ? permissions.can(organizationId, actorId, role, [
                  "can_create_products",
                  "can_edit_products",
                ])
              : false;
          },
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
    ProductImportWorker,
    ProductComplianceWorker,
  ],
})
export class ProductsModule {}
