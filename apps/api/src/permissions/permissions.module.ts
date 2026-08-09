import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { PermissionsGuard } from "../auth/permissions.guard";
import { CustomRolesController } from "./custom-roles.controller";
import { CustomRolesService } from "./custom-roles.service";
import { PermissionsController } from "./permissions.controller";
import { PermissionsService } from "./permissions.service";

/**
 * Global so any feature module can inject the service without importing this.
 *
 * The guard is registered here rather than in AuthModule so its position in the
 * APP_GUARD chain is after authentication — it needs `request.user`.
 */
@Global()
@Module({
  controllers: [PermissionsController, CustomRolesController],
  providers: [
    PermissionsService,
    CustomRolesService,
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [PermissionsService, CustomRolesService],
})
export class PermissionsModule {}
