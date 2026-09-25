import { Module } from "@nestjs/common";

import { SupabaseModule } from "../supabase/supabase.module";
import { PermissionsModule } from "../permissions/permissions.module";
import {
  FRAMEWORK_REPOSITORY,
  FrameworkUseCases,
  type FrameworkRepository,
} from "./application/framework-use-cases";
import { FrameworksController } from "./frameworks.controller";
import { SupabaseFrameworkRepository } from "./infrastructure/supabase-framework.repository";
import { ControlsController } from "./controls.controller";
import {
  CONTROL_REPOSITORY,
  ControlUseCases,
  type ControlRepository,
} from "./application/control-use-cases";
import { SupabaseControlRepository } from "./infrastructure/supabase-control.repository";
import { SupabaseCoverageWorkQueue } from "./infrastructure/supabase-coverage-work.queue";
import { UpgradesController } from "./upgrades.controller";
import {
  UPGRADE_REPOSITORY,
  UpgradeUseCases,
  type UpgradeRepository,
} from "./application/upgrade-use-cases";
import { SupabaseUpgradeRepository } from "./infrastructure/supabase-upgrade.repository";

@Module({
  imports: [SupabaseModule, PermissionsModule],
  controllers: [FrameworksController, ControlsController, UpgradesController],
  providers: [
    SupabaseUpgradeRepository,
    { provide: UPGRADE_REPOSITORY, useExisting: SupabaseUpgradeRepository },
    {
      provide: UpgradeUseCases,
      inject: [UPGRADE_REPOSITORY],
      useFactory: (repository: UpgradeRepository) =>
        new UpgradeUseCases(repository),
    },
    SupabaseCoverageWorkQueue,
    SupabaseControlRepository,
    { provide: CONTROL_REPOSITORY, useExisting: SupabaseControlRepository },
    {
      provide: ControlUseCases,
      inject: [CONTROL_REPOSITORY],
      useFactory: (repository: ControlRepository) =>
        new ControlUseCases(repository),
    },
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
