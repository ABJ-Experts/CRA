import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { PermissionsGuard } from "../auth/permissions.guard";
import { AuditModule } from "../audit/audit.module";
import { BasePermissionResolver } from "./application/base-permission-resolver";
import { VersionedPermissionResolver } from "./application/versioned-permission-resolver.proxy";
import { CustomRolesController } from "./custom-roles.controller";
import { CustomRolesService } from "./custom-roles.service";
import { SupabasePermissionDataAdapter } from "./infrastructure/supabase-permission-data.adapter";
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
  imports: [AuditModule],
  controllers: [PermissionsController, CustomRolesController],
  providers: [
    SupabasePermissionDataAdapter,
    {
      provide: BasePermissionResolver,
      useFactory: (data: SupabasePermissionDataAdapter) =>
        new BasePermissionResolver(data),
      inject: [SupabasePermissionDataAdapter],
    },
    {
      provide: VersionedPermissionResolver,
      useFactory: (
        data: SupabasePermissionDataAdapter,
        target: BasePermissionResolver,
      ) => new VersionedPermissionResolver(data, target),
      inject: [SupabasePermissionDataAdapter, BasePermissionResolver],
    },
    PermissionsService,
    CustomRolesService,
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [PermissionsService, CustomRolesService],
})
export class PermissionsModule {}
