import { LicensingModule } from "../../licensing/licensing.module";
import { LicensingGuard } from "../../licensing/infrastructure/licensing.guard";
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard } from "@nestjs/throttler";

import { PermissionsGuard } from "../../auth/permissions.guard";
import { AuthModule } from "../../auth/auth.module";
import { SupabaseAuthGuard } from "../../auth/supabase-auth.guard";
import { PermissionsModule } from "../../permissions/permissions.module";
import { SupabaseModule } from "../../supabase/supabase.module";

/**
 * The global request-security chain is deliberately centralized here.
 *
 * Provider order is observable: cheap throttling runs before token/database
 * work, authentication establishes `request.user`, and authorization consumes
 * that identity last. Feature modules must not register their own APP_GUARD.
 */
export const SECURITY_GUARD_ORDER = Object.freeze([
  ThrottlerGuard.name,
  SupabaseAuthGuard.name,
  PermissionsGuard.name,
  LicensingGuard.name,
]);

@Module({
  imports: [AuthModule, PermissionsModule, SupabaseModule, LicensingModule],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SupabaseAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: LicensingGuard },
  ],
})
export class SecurityModule {}
