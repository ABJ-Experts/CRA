import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuditModule } from "../audit/audit.module";
import { AuditService } from "../audit/audit.service";
import { MailModule } from "../mail/mail.module";
import { SupabaseModule } from "../supabase/supabase.module";
import { InvitationsController } from "./invitations.controller";
import { AcceptInvitationUseCase } from "./application/accept-invitation.use-case";
import { CreateInvitationUseCase } from "./application/create-invitation.use-case";
import { ListInvitationsQuery } from "./application/list-invitations.query";
import { RevokeInvitationUseCase } from "./application/revoke-invitation.use-case";
import { MailInvitationNotifierAdapter } from "./infrastructure/mail-invitation-notifier.adapter";
import { NodeInvitationTokenAdapter } from "./infrastructure/node-invitation-token.adapter";
import { SupabaseInvitationRepository } from "./infrastructure/supabase-invitation.repository";
import { InvitationsService } from "./invitations.service";

@Module({
  imports: [AuditModule, SupabaseModule, MailModule],
  controllers: [InvitationsController],
  providers: [
    SupabaseInvitationRepository,
    MailInvitationNotifierAdapter,
    NodeInvitationTokenAdapter,
    {
      provide: CreateInvitationUseCase,
      useFactory: (
        repository: SupabaseInvitationRepository,
        tokens: NodeInvitationTokenAdapter,
        notifier: MailInvitationNotifierAdapter,
        config: ConfigService,
      ) =>
        new CreateInvitationUseCase(
          repository,
          tokens,
          notifier,
          { now: () => new Date() },
          config.getOrThrow<number>("INVITATION_TTL_DAYS"),
        ),
      inject: [
        SupabaseInvitationRepository,
        NodeInvitationTokenAdapter,
        MailInvitationNotifierAdapter,
        ConfigService,
      ],
    },
    {
      provide: AcceptInvitationUseCase,
      useFactory: (
        repository: SupabaseInvitationRepository,
        tokens: NodeInvitationTokenAdapter,
      ) => new AcceptInvitationUseCase(repository, tokens),
      inject: [SupabaseInvitationRepository, NodeInvitationTokenAdapter],
    },
    {
      provide: RevokeInvitationUseCase,
      useFactory: (repository: SupabaseInvitationRepository) =>
        new RevokeInvitationUseCase(repository),
      inject: [SupabaseInvitationRepository],
    },
    {
      provide: ListInvitationsQuery,
      useFactory: (repository: SupabaseInvitationRepository) =>
        new ListInvitationsQuery(repository),
      inject: [SupabaseInvitationRepository],
    },
    {
      provide: InvitationsService,
      useFactory: (
        create: CreateInvitationUseCase,
        accept: AcceptInvitationUseCase,
        revoke: RevokeInvitationUseCase,
        list: ListInvitationsQuery,
        audit: AuditService,
      ) => new InvitationsService(create, accept, revoke, list, audit),
      inject: [
        CreateInvitationUseCase,
        AcceptInvitationUseCase,
        RevokeInvitationUseCase,
        ListInvitationsQuery,
        AuditService,
      ],
    },
  ],
  exports: [InvitationsService],
})
export class InvitationsModule {}
