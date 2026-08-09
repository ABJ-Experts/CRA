import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard } from "@nestjs/throttler";

import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { MfaController } from "./mfa/mfa.controller";
import { MfaService } from "./mfa/mfa.service";
import { SupabaseAuthGuard } from "./supabase-auth.guard";
import { TokenVerifierService } from "./token-verifier.service";

/**
 * Guard ORDER matters and is the reason both are registered here rather than in
 * AppModule: Nest applies APP_GUARD providers in declaration order, so the
 * throttler runs first.
 *
 * If authentication ran first, every brute-force attempt would pay for a full
 * token verification and a database round trip before being rejected — which
 * turns the login endpoint into an amplification vector. Rate-limit first, then
 * authenticate.
 */
@Module({
  controllers: [AuthController, MfaController],
  providers: [
    AuthService,
    MfaService,
    TokenVerifierService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SupabaseAuthGuard },
  ],
  exports: [AuthService, MfaService, TokenVerifierService],
})
export class AuthModule {}
