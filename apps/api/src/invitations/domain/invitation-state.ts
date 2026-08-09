import type { Result } from "../../common/domain/result";
import { failure, success } from "../../common/domain/result";

export type InvitationState =
  "pending" | "accepted" | "revoked" | "declined" | "expired";

export type InvitationEvent = "accept" | "revoke" | "decline" | "expire";

export type InvalidInvitationTransition = Readonly<{
  code: "invalid_invitation_transition";
  from: InvitationState;
  event: InvitationEvent;
}>;

const TRANSITIONS: Readonly<
  Partial<
    Record<InvitationState, Partial<Record<InvitationEvent, InvitationState>>>
  >
> = Object.freeze({
  pending: Object.freeze({
    accept: "accepted",
    revoke: "revoked",
    decline: "declined",
    expire: "expired",
  }),
});

export function transitionInvitation(
  from: InvitationState,
  event: InvitationEvent,
): Result<InvitationState, InvalidInvitationTransition> {
  const next = TRANSITIONS[from]?.[event];

  return next
    ? success(next)
    : failure(
        Object.freeze({
          code: "invalid_invitation_transition" as const,
          from,
          event,
        }),
      );
}
