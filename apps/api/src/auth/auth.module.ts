import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuditModule } from "../audit/audit.module";
import { AuditService } from "../audit/audit.service";
import { MailModule } from "../mail/mail.module";
import { MailService } from "../mail/mail.service";
import { SupabaseModule } from "../supabase/supabase.module";
import type { AuthIdentityProvider } from "./application/auth-identity-provider.port";
import type { AuthProfileRepository } from "./application/auth-profile-repository.port";
import {
  AuthenticateUserUseCase,
  ConfirmMfaEnrollmentUseCase,
  EnrollMfaUseCase,
  HasVerifiedMfaQuery,
  IssueVerificationArtifactUseCase,
  ManageEmailVerificationUseCase,
  ManagePasswordRecoveryUseCase,
  ReadSessionQuery,
  ReauthenticateUserUseCase,
  RecoverMfaUseCase,
  RefreshSessionUseCase,
  RegisterUserUseCase,
  RequestPasswordResetUseCase,
  SignOutEverywhereUseCase,
  UnenrollMfaUseCase,
  VerifyMfaUseCase,
  type AuthAuditPort,
  type AuthNotifierPort,
  type AuthRandomPort,
  type ClockPort,
  type DelayPort,
  type SecretHashPort,
} from "./application/auth-use-cases";
import type { MfaRecoveryRepository } from "./application/mfa-recovery-repository.port";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import {
  NodeAuthRandomAdapter,
  NodeSecretHashAdapter,
  SystemClockAdapter,
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
    NodeAuthRandomAdapter,
    SystemClockAdapter,
    SystemDelayAdapter,
    {
      provide: IssueVerificationArtifactUseCase,
      inject: [
        SupabaseAuthProfileRepository,
        NodeSecretHashAdapter,
        NodeAuthRandomAdapter,
        SystemClockAdapter,
        MailService,
        ConfigService,
      ],
      useFactory: (
        profiles: AuthProfileRepository,
        hashes: SecretHashPort,
        random: AuthRandomPort,
        clock: ClockPort,
        notifier: AuthNotifierPort,
        config: ConfigService,
      ) =>
        new IssueVerificationArtifactUseCase(
          profiles,
          hashes,
          random,
          clock,
          notifier,
          config.getOrThrow<number>("OTP_TTL_MINUTES"),
        ),
    },
    {
      provide: RegisterUserUseCase,
      inject: [
        SupabaseAuthProfileRepository,
        SupabaseAuthIdentityAdapter,
        IssueVerificationArtifactUseCase,
      ],
      useFactory: (
        profiles: AuthProfileRepository,
        identity: AuthIdentityProvider,
        verification: IssueVerificationArtifactUseCase,
      ) => new RegisterUserUseCase(profiles, identity, verification),
    },
    {
      provide: AuthenticateUserUseCase,
      inject: [
        SupabaseAuthProfileRepository,
        SupabaseAuthIdentityAdapter,
        SystemDelayAdapter,
        ConfigService,
      ],
      useFactory: (
        profiles: AuthProfileRepository,
        identity: AuthIdentityProvider,
        delay: DelayPort,
        config: ConfigService,
      ) =>
        new AuthenticateUserUseCase(
          profiles,
          identity,
          delay,
          400,
          config.getOrThrow<number>("LOGIN_MAX_ATTEMPTS"),
          config.getOrThrow<number>("LOGIN_LOCK_MINUTES"),
        ),
    },
    {
      provide: RefreshSessionUseCase,
      inject: [SupabaseAuthIdentityAdapter],
      useFactory: (identity: AuthIdentityProvider) =>
        new RefreshSessionUseCase(identity),
    },
    {
      provide: SignOutEverywhereUseCase,
      inject: [SupabaseAuthIdentityAdapter, SupabaseAuthProfileRepository],
      useFactory: (
        identity: AuthIdentityProvider,
        profiles: AuthProfileRepository,
      ) => new SignOutEverywhereUseCase(identity, profiles),
    },
    {
      provide: ManageEmailVerificationUseCase,
      inject: [SupabaseAuthProfileRepository, NodeSecretHashAdapter],
      useFactory: (profiles: AuthProfileRepository, hashes: SecretHashPort) =>
        new ManageEmailVerificationUseCase(profiles, hashes, 5),
    },
    {
      provide: RequestPasswordResetUseCase,
      inject: [
        SupabaseAuthProfileRepository,
        NodeSecretHashAdapter,
        NodeAuthRandomAdapter,
        SystemClockAdapter,
        MailService,
        SystemDelayAdapter,
        ConfigService,
      ],
      useFactory: (
        profiles: AuthProfileRepository,
        hashes: SecretHashPort,
        random: AuthRandomPort,
        clock: ClockPort,
        notifier: AuthNotifierPort,
        delay: DelayPort,
        config: ConfigService,
      ) =>
        new RequestPasswordResetUseCase(
          profiles,
          hashes,
          random,
          clock,
          notifier,
          delay,
          config.getOrThrow<number>("RECOVERY_TTL_MINUTES"),
        ),
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
      provide: ReadSessionQuery,
      inject: [SupabaseAuthProfileRepository],
      useFactory: (profiles: AuthProfileRepository) =>
        new ReadSessionQuery(profiles),
    },
    {
      provide: ReauthenticateUserUseCase,
      inject: [
        SupabaseAuthProfileRepository,
        SupabaseAuthIdentityAdapter,
        SystemDelayAdapter,
        ConfigService,
      ],
      useFactory: (
        profiles: AuthProfileRepository,
        identity: AuthIdentityProvider,
        delay: DelayPort,
        config: ConfigService,
      ) =>
        new ReauthenticateUserUseCase(
          profiles,
          identity,
          delay,
          300,
          config.getOrThrow<number>("LOGIN_MAX_ATTEMPTS"),
          config.getOrThrow<number>("LOGIN_LOCK_MINUTES"),
        ),
    },
    {
      provide: EnrollMfaUseCase,
      inject: [SupabaseAuthIdentityAdapter],
      useFactory: (identity: AuthIdentityProvider) =>
        new EnrollMfaUseCase(identity),
    },
    {
      provide: ConfirmMfaEnrollmentUseCase,
      inject: [
        SupabaseAuthIdentityAdapter,
        SupabaseAuthProfileRepository,
        NodeSecretHashAdapter,
        NodeAuthRandomAdapter,
        AuditService,
      ],
      useFactory: (
        identity: AuthIdentityProvider,
        profiles: AuthProfileRepository,
        hashes: SecretHashPort,
        random: AuthRandomPort,
        audit: AuthAuditPort,
      ) =>
        new ConfirmMfaEnrollmentUseCase(
          identity,
          profiles,
          hashes,
          random,
          audit,
        ),
    },
    {
      provide: VerifyMfaUseCase,
      inject: [SupabaseAuthIdentityAdapter, AuditService],
      useFactory: (identity: AuthIdentityProvider, audit: AuthAuditPort) =>
        new VerifyMfaUseCase(identity, audit),
    },
    {
      provide: HasVerifiedMfaQuery,
      inject: [SupabaseAuthIdentityAdapter],
      useFactory: (identity: AuthIdentityProvider) =>
        new HasVerifiedMfaQuery(identity),
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
    {
      provide: UnenrollMfaUseCase,
      inject: [
        SupabaseAuthIdentityAdapter,
        SupabaseAuthProfileRepository,
        AuditService,
      ],
      useFactory: (
        identity: AuthIdentityProvider,
        profiles: AuthProfileRepository,
        audit: AuthAuditPort,
      ) => new UnenrollMfaUseCase(identity, profiles, audit),
    },
  ],
  exports: [AuthService, MfaService, TokenVerifierService],
})
export class AuthModule {}
