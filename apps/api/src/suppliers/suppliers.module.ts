import { Module } from "@nestjs/common";

import { SupabaseModule } from "../supabase/supabase.module";
import {
  SUPPLIER_REGISTRY_REPOSITORY,
  SupplierRegistryUseCases,
  type SupplierRegistryRepository,
} from "./application/supplier-registry-use-cases";
import { SupabaseSupplierRegistryRepository } from "./infrastructure/supabase-supplier-registry.repository";
import { SupplierRegistryController } from "./supplier-registry.controller";

@Module({
  imports: [SupabaseModule],
  controllers: [SupplierRegistryController],
  providers: [
    SupabaseSupplierRegistryRepository,
    {
      provide: SUPPLIER_REGISTRY_REPOSITORY,
      useExisting: SupabaseSupplierRegistryRepository,
    },
    {
      provide: SupplierRegistryUseCases,
      inject: [SUPPLIER_REGISTRY_REPOSITORY],
      useFactory: (repository: SupplierRegistryRepository) =>
        new SupplierRegistryUseCases(repository),
    },
  ],
  exports: [SupplierRegistryUseCases],
})
export class SuppliersModule {}
