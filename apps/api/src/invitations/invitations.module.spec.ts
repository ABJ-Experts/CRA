import { MODULE_METADATA } from "@nestjs/common/constants";

import { AuditService } from "../audit/audit.service";
import { AcceptInvitationUseCase } from "./application/accept-invitation.use-case";
import { CreateInvitationUseCase } from "./application/create-invitation.use-case";
import { ListInvitationsQuery } from "./application/list-invitations.query";
import { RevokeInvitationUseCase } from "./application/revoke-invitation.use-case";
import { MailInvitationNotifierAdapter } from "./infrastructure/mail-invitation-notifier.adapter";
import { NodeInvitationTokenAdapter } from "./infrastructure/node-invitation-token.adapter";
import { SupabaseInvitationRepository } from "./infrastructure/supabase-invitation.repository";
import { InvitationsModule } from "./invitations.module";
import { InvitationsService } from "./invitations.service";

type FactoryProvider = Readonly<{
  provide: unknown;
  inject: readonly unknown[];
  useFactory: (...dependencies: readonly unknown[]) => unknown;
}>;

function factoryFor(token: unknown): FactoryProvider {
  const providers = Reflect.getMetadata(
    MODULE_METADATA.PROVIDERS,
    InvitationsModule,
  ) as readonly unknown[];
  const provider = providers.find(
    (candidate): candidate is FactoryProvider =>
      typeof candidate === "object" &&
      candidate !== null &&
      "provide" in candidate &&
      candidate.provide === token &&
      "useFactory" in candidate &&
      typeof candidate.useFactory === "function",
  );
  if (!provider) throw new Error("Factory provider not found");
  return provider;
}

describe("InvitationsModule composition", () => {
  it("constructs each use case from the inward-owned adapters", () => {
    const repository = {} as SupabaseInvitationRepository;
    const tokens = {} as NodeInvitationTokenAdapter;
    const notifier = {} as MailInvitationNotifierAdapter;
    const getOrThrow = jest.fn().mockReturnValue(7);

    expect(
      factoryFor(CreateInvitationUseCase).useFactory(
        repository,
        tokens,
        notifier,
        { getOrThrow },
      ),
    ).toBeInstanceOf(CreateInvitationUseCase);
    expect(getOrThrow).toHaveBeenCalledWith("INVITATION_TTL_DAYS");
    expect(
      factoryFor(AcceptInvitationUseCase).useFactory(repository, tokens),
    ).toBeInstanceOf(AcceptInvitationUseCase);
    expect(
      factoryFor(RevokeInvitationUseCase).useFactory(repository),
    ).toBeInstanceOf(RevokeInvitationUseCase);
    expect(
      factoryFor(ListInvitationsQuery).useFactory(repository),
    ).toBeInstanceOf(ListInvitationsQuery);
  });

  it("wires the compatibility facade with audit as an observer", () => {
    const create = {} as CreateInvitationUseCase;
    const accept = {} as AcceptInvitationUseCase;
    const revoke = {} as RevokeInvitationUseCase;
    const list = {} as ListInvitationsQuery;
    const audit = {} as AuditService;
    const provider = factoryFor(InvitationsService);

    expect(
      provider.useFactory(create, accept, revoke, list, audit),
    ).toBeInstanceOf(InvitationsService);
    expect(provider.inject).toEqual([
      CreateInvitationUseCase,
      AcceptInvitationUseCase,
      RevokeInvitationUseCase,
      ListInvitationsQuery,
      AuditService,
    ]);
  });
});
