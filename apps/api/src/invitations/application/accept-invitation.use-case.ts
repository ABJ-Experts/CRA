import { normalizeEmail } from "@repo/contracts/auth";
import type { AcceptInvitationResponse } from "@repo/contracts/invitations";

import type { Result } from "../../common/application/result";
import { failure, success } from "../../common/application/result";
import type {
  AcceptInvitationAtomicOutcome,
  InvitationActor,
  InvitationRepository,
} from "./invitation-repository.port";
import type { InvitationTokenPort } from "./invitation-token.port";

export type AcceptInvitationCommand = Readonly<{
  token: string;
  user: InvitationActor;
}>;

export type AcceptInvitationError = Readonly<{
  code:
    | "invitation_not_found"
    | "invitation_expired"
    | "invitation_email_mismatch"
    | "invitation_not_pending"
    | "organization_not_found"
    | "membership_failed";
}>;

function acceptanceFailure(outcome: string): AcceptInvitationError {
  switch (outcome) {
    case "not_found":
      return Object.freeze({ code: "invitation_not_found" });
    case "expired":
      return Object.freeze({ code: "invitation_expired" });
    case "email_mismatch":
      return Object.freeze({ code: "invitation_email_mismatch" });
    case "not_pending":
      return Object.freeze({ code: "invitation_not_pending" });
    case "organization_not_found":
      return Object.freeze({ code: "organization_not_found" });
    default:
      return Object.freeze({ code: "membership_failed" });
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object";
}

function hasOutcome(
  value: unknown,
): value is Readonly<Record<string, unknown>> & { outcome: string } {
  return isRecord(value) && typeof value.outcome === "string";
}

function isCompleteSuccess(
  outcome: unknown,
): outcome is Extract<
  AcceptInvitationAtomicOutcome,
  { outcome: "accepted" | "already_accepted" }
> {
  if (!hasOutcome(outcome) || !isRecord(outcome.organization)) return false;

  return (
    (outcome.outcome === "accepted" ||
      outcome.outcome === "already_accepted") &&
    typeof outcome.invitationId === "string" &&
    outcome.invitationId.length > 0 &&
    typeof outcome.organization.id === "string" &&
    outcome.organization.id.length > 0 &&
    typeof outcome.organization.name === "string" &&
    outcome.organization.name.length > 0 &&
    typeof outcome.organization.slug === "string" &&
    outcome.organization.slug.length > 0
  );
}

export class AcceptInvitationUseCase {
  constructor(
    private readonly repository: InvitationRepository,
    private readonly tokens: InvitationTokenPort,
  ) {}

  async execute(
    command: AcceptInvitationCommand,
  ): Promise<Result<AcceptInvitationResponse, AcceptInvitationError>> {
    let outcome: AcceptInvitationAtomicOutcome;
    try {
      const tokenHash = this.tokens.hash(command.token);
      outcome = await this.repository.acceptAtomic(
        tokenHash,
        Object.freeze({
          id: command.user.id,
          email: normalizeEmail(command.user.email),
        }),
      );
    } catch {
      return failure(Object.freeze({ code: "membership_failed" as const }));
    }

    if (isCompleteSuccess(outcome)) {
      return success(
        Object.freeze({
          ok: true as const,
          alreadyAccepted: outcome.outcome === "already_accepted",
          organization: Object.freeze({ ...outcome.organization }),
        }),
      );
    }

    if (!hasOutcome(outcome)) {
      return failure(Object.freeze({ code: "membership_failed" as const }));
    }

    return failure(acceptanceFailure(outcome.outcome));
  }
}
