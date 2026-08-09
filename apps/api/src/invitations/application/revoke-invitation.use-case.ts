import { normalizeEmail } from "@repo/contracts/auth";

import type { Result } from "../../common/application/result";
import { failure, success } from "../../common/application/result";
import type {
  InvitationActor,
  InvitationRepository,
  RevokeInvitationAtomicOutcome,
} from "./invitation-repository.port";

export type RevokeInvitationCommand = Readonly<{
  orgId: string;
  actor: InvitationActor;
  invitationId: string;
}>;

export type RevokeInvitationError = Readonly<{
  code:
    | "invitation_not_found"
    | "invitation_already_accepted"
    | "invitation_not_pending"
    | "invitation_failed";
}>;

function revocationFailure(outcome: string): RevokeInvitationError {
  switch (outcome) {
    case "not_found":
      return Object.freeze({ code: "invitation_not_found" });
    case "already_accepted":
      return Object.freeze({ code: "invitation_already_accepted" });
    case "not_pending":
      return Object.freeze({ code: "invitation_not_pending" });
    default:
      return Object.freeze({ code: "invitation_failed" });
  }
}

export class RevokeInvitationUseCase {
  constructor(private readonly repository: InvitationRepository) {}

  async execute(
    command: RevokeInvitationCommand,
  ): Promise<Result<void, RevokeInvitationError>> {
    let outcome: RevokeInvitationAtomicOutcome;
    try {
      outcome = await this.repository.revokeAtomic(
        command.orgId,
        command.invitationId,
        Object.freeze({
          id: command.actor.id,
          email: normalizeEmail(command.actor.email),
        }),
      );
    } catch {
      return failure(Object.freeze({ code: "invitation_failed" as const }));
    }

    return outcome === "revoked"
      ? success(undefined)
      : failure(revocationFailure(outcome));
  }
}
