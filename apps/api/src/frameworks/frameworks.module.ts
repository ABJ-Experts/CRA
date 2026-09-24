import { Module } from "@nestjs/common";

import { SupabaseModule } from "../supabase/supabase.module";
import {
  FRAMEWORK_REPOSITORY,
  FrameworkUseCases,
  type FrameworkRepository,
} from "./application/framework-use-cases";
import { FrameworksController } from "./frameworks.controller";
import { SupabaseFrameworkRepository } from "./infrastructure/supabase-framework.repository";

@Module({
  imports: [SupabaseModule],
  controllers: [FrameworksController],
  providers: [
    SupabaseFrameworkRepository,
    { provide: FRAMEWORK_REPOSITORY, useExisting: SupabaseFrameworkRepository },
    {
      provide: FrameworkUseCases,
      inject: [FRAMEWORK_REPOSITORY],
      useFactory: (repository: FrameworkRepository) =>
        new FrameworkUseCases(repository),
    },
  ],
})
export class FrameworksModule {}
