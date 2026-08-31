import { normalizeEmail } from "@repo/contracts/auth";

import type { Result } from "../../common/domain/result";
import { failure, success } from "../../common/domain/result";
import type { OnboardingEvidenceRecorder } from "../../organizations/application/onboarding-evidence-recorder.port";
import type { InvitationNotifierPort } from "./invitation-notifier.port";
import type {
  InvitationActor,
  InvitationRepository,
  ResendInvitationAtomicOutcome,
} from "./invitation-repository.port";
import type { InvitationTokenPort } from "./invitation-token.port";
import type { ClockPort } from "./create-invitation.use-case";

const DAY_IN_MILLISECONDS = 86_400_000;

export type ResendInvitationCommand = Readonly<{
  orgId: string;
  actor: InvitationActor;
  invitationId: string;
}>;

export type ResendInvitationSuccess = Readonly<{
  id: string;
  delivery: "confirmed";
}>;

export type ResendInvitationError =
  | Readonly<{ code: "invitation_not_found" }>
  | Readonly<{ code: "invitation_expired" }>
  | Readonly<{ code: "invitation_already_accepted" }>
  | Readonly<{ code: "invitation_not_pending" }>
  | Readonly<{ code: "invitation_already_member" }>
  | Readonly<{ code: "invitation_failed" }>
  | Readonly<{
      code: "notification_failed";
      invitationId: string;
      delivery: "persisted";
    }>
  | Readonly<{ code: "evidence_failed"; invitationId: string }>;

export class ResendInvitationUseCase {
  constructor(
    private readonly repository: InvitationRepository,
    private readonly tokens: InvitationTokenPort,
    private readonly notifier: InvitationNotifierPort,
    private readonly evidence: OnboardingEvidenceRecorder,
    private readonly clock: ClockPort,
    private readonly ttlDays: number,
  ) {}

  async execute(
    command: ResendInvitationCommand,
  ): Promise<Result<ResendInvitationSuccess, ResendInvitationError>> {
    const token = this.tokens.create();
    if (!token.raw || !token.hash || token.raw === token.hash) {
      return failure(Object.freeze({ code: "invitation_failed" as const }));
    }

    const expiresAt = new Date(
      this.clock.now().getTime() + this.ttlDays * DAY_IN_MILLISECONDS,
    ).toISOString();
    const actor = Object.freeze({
      id: command.actor.id,
      email: normalizeEmail(command.actor.email),
    });

    let outcome: ResendInvitationAtomicOutcome;
    try {
      outcome = await this.repository.resendAtomic(
        command.orgId,
        command.invitationId,
        actor,
        token.hash,
        expiresAt,
      );
    } catch {
      return failure(Object.freeze({ code: "invitation_failed" as const }));
    }

    if (outcome.outcome !== "resent") {
      return failure(this.toAtomicFailure(outcome));
    }
    if (outcome.invitationId !== command.invitationId) {
      return failure(Object.freeze({ code: "invitation_failed" as const }));
    }

    try {
      await this.notifier.send(
        outcome.email,
        token.raw,
        outcome.organizationName,
        actor.email,
      );
    } catch {
      return failure(
        Object.freeze({
          code: "notification_failed" as const,
          invitationId: outcome.invitationId,
          delivery: "persisted" as const,
        }),
      );
    }

    try {
      await this.evidence.recordInvitationDelivery(
        command.orgId,
        outcome.invitationId,
        actor.id,
      );
    } catch {
      return failure(
        Object.freeze({
          code: "evidence_failed" as const,
          invitationId: outcome.invitationId,
        }),
      );
    }

    return success(
      Object.freeze({
        id: outcome.invitationId,
        delivery: "confirmed" as const,
      }),
    );
  }

  private toAtomicFailure(
    outcome: Exclude<ResendInvitationAtomicOutcome, { outcome: "resent" }>,
  ): Exclude<
    ResendInvitationError,
    { code: "notification_failed" | "evidence_failed" }
  > {
    switch (outcome.outcome) {
      case "not_found":
        return Object.freeze({ code: "invitation_not_found" as const });
      case "expired":
        return Object.freeze({ code: "invitation_expired" as const });
      case "accepted":
        return Object.freeze({ code: "invitation_already_accepted" as const });
      case "not_pending":
        return Object.freeze({ code: "invitation_not_pending" as const });
      case "already_member":
        return Object.freeze({ code: "invitation_already_member" as const });
      case "actor_not_found":
      case "actor_email_mismatch":
        return Object.freeze({ code: "invitation_failed" as const });
    }
  }
}
