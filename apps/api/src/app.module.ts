import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";

import { AuthModule } from "./auth/auth.module";
import { HttpBoundaryModule } from "./common/http/http-boundary.module";
import { SecurityModule } from "./common/security/security.module";
import { validateEnv } from "./config/env.validation";
import { HealthController } from "./health/health.controller";
import { MailModule } from "./mail/mail.module";
import { InvitationsModule } from "./invitations/invitations.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { PermissionsModule } from "./permissions/permissions.module";
import { SupabaseModule } from "./supabase/supabase.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Validated once at boot, so a missing SUPABASE_SERVICE_ROLE_KEY is a
      // startup failure with a readable message rather than a 500 on whichever
      // request happens to need it first.
      validate: validateEnv,
      // .env.local overrides .env, and neither is committed. `.env.example` is.
      envFilePath: [".env.local", ".env"],
      cache: true,
    }),

    /*
     * A global default of 60 requests/minute. The auth routes tighten this
     * considerably with per-route @Throttle, because the interesting attack is
     * a burst against one endpoint, not overall volume.
     *
     * Per-IP throttling alone is evaded by rotating IPs, which is precisely why
     * the durable per-ACCOUNT lockout lives in the database instead.
     */
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 60 }]),

    HttpBoundaryModule,
    SupabaseModule,
    MailModule,
    AuthModule,
    PermissionsModule,
    SecurityModule,
    UsersModule,
    OrganizationsModule,
    InvitationsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
