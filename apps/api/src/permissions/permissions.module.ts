import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { AuditService } from "../audit/audit.service";
import { SupabaseModule } from "../supabase/supabase.module";
import { BasePermissionResolver } from "./application/base-permission-resolver";
import {
  ROLE_REPOSITORY,
  type RoleRepository,
} from "./application/role-repository.port";
import { RoleUseCases } from "./application/role-use-cases";
import { VersionedPermissionResolver } from "./application/versioned-permission-resolver.proxy";
import { CustomRolesController } from "./custom-roles.controller";
import { CustomRolesService } from "./custom-roles.service";
import { SupabasePermissionDataAdapter } from "./infrastructure/supabase-permission-data.adapter";
import { SupabaseRoleRepository } from "./infrastructure/supabase-role.repository";
import { PermissionsController } from "./permissions.controller";
import { PermissionsService } from "./permissions.service";

@Module({
  imports: [AuditModule, SupabaseModule],
  controllers: [PermissionsController, CustomRolesController],
  providers: [
    SupabasePermissionDataAdapter,
    SupabaseRoleRepository,
    {
      provide: ROLE_REPOSITORY,
      useExisting: SupabaseRoleRepository,
    },
    {
      provide: RoleUseCases,
      useFactory: (repository: RoleRepository, audit: AuditService) =>
        new RoleUseCases(repository, audit),
      inject: [ROLE_REPOSITORY, AuditService],
    },
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
  ],
  exports: [PermissionsService, CustomRolesService],
})
export class PermissionsModule {}
