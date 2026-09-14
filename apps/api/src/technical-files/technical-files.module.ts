import { Module } from "@nestjs/common";

import { ProductsModule } from "../products/products.module";
import {
  PRODUCT_RETENTION_READER,
  type ProductRetentionReaderPort,
} from "../products/application/product-retention-reader.port";
import { SupabaseModule } from "../supabase/supabase.module";
import {
  TECHNICAL_FILE_REPOSITORY,
  type TechnicalFileRepository,
} from "./application/technical-file.port";
import { TechnicalFileUseCases } from "./application/technical-file-use-cases";
import { SupabaseTechnicalFileRepository } from "./infrastructure/supabase-technical-file.repository";
import { TechnicalFilesController } from "./technical-files.controller";

@Module({
  imports: [SupabaseModule, ProductsModule],
  controllers: [TechnicalFilesController],
  providers: [
    SupabaseTechnicalFileRepository,
    {
      provide: TECHNICAL_FILE_REPOSITORY,
      useExisting: SupabaseTechnicalFileRepository,
    },
    {
      provide: TechnicalFileUseCases,
      inject: [TECHNICAL_FILE_REPOSITORY, PRODUCT_RETENTION_READER],
      useFactory: (
        repository: TechnicalFileRepository,
        retention: ProductRetentionReaderPort,
      ) => new TechnicalFileUseCases(repository, retention),
    },
  ],
})
export class TechnicalFilesModule {}
