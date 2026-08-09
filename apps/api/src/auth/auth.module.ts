import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { MailModule } from "../mail/mail.module";
import { SupabaseModule } from "../supabase/supabase.module";
import {
  ManageEmailVerificationUseCase,
  ManagePasswordRecoveryUseCase,
  RecoverMfaUseCase,
  type DelayPort,
  type SecretHashPort,
} from "./application/auth-use-cases";
import type { AuthIdentityProvider } from "./application/auth-identity-provider.port";
import type { AuthProfileRepository } from "./application/auth-profile-repository.port";
import type { MfaRecoveryRepository } from "./application/mfa-recovery-repository.port";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import {
  NodeSecretHashAdapter,
  SystemDelayAdapter,
} from "./infrastructure/node-auth-runtime.adapter";
import { SupabaseAuthIdentityAdapter } from "./infrastructure/supabase-auth-identity.adapter";
import { SupabaseAuthProfileRepository } from "./infrastructure/supabase-auth-profile.repository";
import { SupabaseMfaRecoveryRepository } from "./infrastructure/supabase-mfa-recovery.repository";
import { MfaController } from "./mfa/mfa.controller";
import { MfaService } from "./mfa/mfa.service";
import { TokenVerifierService } from "./token-verifier.service";

@Module({
  imports: [AuditModule, SupabaseModule, MailModule],
  controllers: [AuthController, MfaController],
  providers: [
    AuthService,
    MfaService,
    TokenVerifierService,
    SupabaseAuthIdentityAdapter,
    SupabaseAuthProfileRepository,
    SupabaseMfaRecoveryRepository,
    NodeSecretHashAdapter,
    SystemDelayAdapter,
    {
      provide: ManageEmailVerificationUseCase,
      inject: [SupabaseAuthProfileRepository, NodeSecretHashAdapter],
      useFactory: (profiles: AuthProfileRepository, hashes: SecretHashPort) =>
        new ManageEmailVerificationUseCase(profiles, hashes, 5),
    },
    {
      provide: ManagePasswordRecoveryUseCase,
      inject: [
        SupabaseAuthProfileRepository,
        SupabaseAuthIdentityAdapter,
        NodeSecretHashAdapter,
      ],
      useFactory: (
        profiles: AuthProfileRepository,
        identity: AuthIdentityProvider,
        hashes: SecretHashPort,
      ) => new ManagePasswordRecoveryUseCase(profiles, identity, hashes),
    },
    {
      provide: RecoverMfaUseCase,
      inject: [
        SupabaseMfaRecoveryRepository,
        SupabaseAuthIdentityAdapter,
        NodeSecretHashAdapter,
        SystemDelayAdapter,
      ],
      useFactory: (
        recovery: MfaRecoveryRepository,
        identity: AuthIdentityProvider,
        hashes: SecretHashPort,
        delay: DelayPort,
      ) => new RecoverMfaUseCase(recovery, identity, hashes, delay),
    },
  ],
  exports: [AuthService, MfaService, TokenVerifierService],
})
export class AuthModule {}
