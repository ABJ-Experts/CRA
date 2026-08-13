import { Module } from "@nestjs/common";

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
import { SupabaseProductRepository } from "./infrastructure/supabase-product.repository";
import { ProductsController } from "./products.controller";
import { ProductsService } from "./products.service";

@Module({
  imports: [SupabaseModule, OrganizationsModule, PermissionsModule],
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
    ProductsService,
  ],
  exports: [
    ProductUseCases,
    RELEASE_REGULATORY_STATE_READER,
    RELEASE_MARKET_AVAILABILITY_READER,
  ],
})
export class ProductsModule {}
