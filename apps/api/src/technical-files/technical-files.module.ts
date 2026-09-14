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
import {
  RISK_REGISTER_REPOSITORY,
  type RiskRegisterRepository,
} from "./application/risk-register.port";
import { RiskRegisterUseCases } from "./application/risk-register-use-cases";
import { SupabaseRiskRegisterRepository } from "./infrastructure/supabase-risk-register.repository";
import { SupabaseTechnicalFileRepository } from "./infrastructure/supabase-technical-file.repository";
import { TechnicalFilesController } from "./technical-files.controller";

@Module({
  imports: [SupabaseModule, ProductsModule],
  controllers: [TechnicalFilesController],
  providers: [
    SupabaseTechnicalFileRepository,
    SupabaseRiskRegisterRepository,
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
    {
      provide: RISK_REGISTER_REPOSITORY,
      useExisting: SupabaseRiskRegisterRepository,
    },
    {
      provide: RiskRegisterUseCases,
      inject: [RISK_REGISTER_REPOSITORY, PRODUCT_RETENTION_READER],
      useFactory: (
        repository: RiskRegisterRepository,
        retention: ProductRetentionReaderPort,
      ) => new RiskRegisterUseCases(repository, retention),
    },
  ],
})
export class TechnicalFilesModule {}
