import { normalizeEmail } from "@repo/contracts/auth";
import type { BaseRole } from "@repo/contracts/permissions";

import type { Result } from "../../common/application/result";
import { failure, success } from "../../common/application/result";
import type { InvitationNotifierPort } from "./invitation-notifier.port";
import type {
  InvitationActor,
  InvitationRepository,
} from "./invitation-repository.port";
import type { InvitationTokenPort } from "./invitation-token.port";

const DAY_IN_MILLISECONDS = 86_400_000;

export interface ClockPort {
  now(): Date;
}

export type CreateInvitationCommand = Readonly<{
  orgId: string;
  actor: InvitationActor;
  input: Readonly<{
    email: string;
    role: BaseRole;
    firstName?: string;
    lastName?: string;
  }>;
}>;

export type CreateInvitationError =
  | Readonly<{ code: "cannot_invite_self" }>
  | Readonly<{ code: "already_member" }>
  | Readonly<{ code: "invitation_pending" }>
  | Readonly<{ code: "organization_not_found" }>
  | Readonly<{ code: "invitation_failed" }>
  | Readonly<{
      code: "notification_failed";
      invitationId: string;
    }>;

export class CreateInvitationUseCase {
  constructor(
    private readonly repository: InvitationRepository,
    private readonly tokens: InvitationTokenPort,
    private readonly notifier: InvitationNotifierPort,
    private readonly clock: ClockPort,
    private readonly ttlDays: number,
  ) {}

  async execute(
    command: CreateInvitationCommand,
  ): Promise<Result<Readonly<{ id: string }>, CreateInvitationError>> {
    const email = normalizeEmail(command.input.email);
    if (email === normalizeEmail(command.actor.email)) {
      return failure(Object.freeze({ code: "cannot_invite_self" as const }));
    }

    let invitation: Readonly<{ id: string }>;
    let organization: Readonly<{
      id: string;
      name: string;
      slug: string;
    }> | null;
    let rawToken: string;

    try {
      const existingUser = await this.repository.findExistingUser(email);
      if (
        existingUser &&
        (await this.repository.isMember(command.orgId, existingUser.id))
      ) {
        return failure(Object.freeze({ code: "already_member" as const }));
      }

      if (await this.repository.hasPending(command.orgId, email)) {
        return failure(Object.freeze({ code: "invitation_pending" as const }));
      }

      const token = this.tokens.create();
      if (!token.raw || !token.hash || token.raw === token.hash) {
        throw new Error("Invitation token port returned an unsafe token pair");
      }
      rawToken = token.raw;
      const expiresAt = new Date(
        this.clock.now().getTime() + this.ttlDays * DAY_IN_MILLISECONDS,
      ).toISOString();

      invitation = await this.repository.insert(
        command.orgId,
        Object.freeze({
          invitedBy: command.actor.id,
          email,
          role: command.input.role,
          firstName: command.input.firstName ?? null,
          lastName: command.input.lastName ?? null,
          tokenHash: token.hash,
          expiresAt,
        }),
      );
      organization = await this.repository.organization(command.orgId);
    } catch {
      return failure(Object.freeze({ code: "invitation_failed" as const }));
    }

    if (!organization) {
      return failure(
        Object.freeze({ code: "organization_not_found" as const }),
      );
    }

    try {
      await this.notifier.send(
        email,
        rawToken,
        organization.name,
        command.actor.email,
      );
    } catch {
      return failure(
        Object.freeze({
          code: "notification_failed" as const,
          invitationId: invitation.id,
        }),
      );
    }

    return success(Object.freeze({ id: invitation.id }));
  }
}
