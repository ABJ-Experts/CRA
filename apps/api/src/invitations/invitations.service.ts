import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { normalizeEmail } from "@repo/contracts/auth";
import type {
  AcceptInvitationResponse,
  Invitation,
} from "@repo/contracts/invitations";
import type { BaseRole } from "@repo/contracts/permissions";

import { AuditService } from "../audit/audit.service";
import {
  AcceptInvitationUseCase,
  type AcceptInvitationError,
} from "./application/accept-invitation.use-case";
import {
  CreateInvitationUseCase,
  type CreateInvitationError,
} from "./application/create-invitation.use-case";
import { ListInvitationsQuery } from "./application/list-invitations.query";
import {
  RevokeInvitationUseCase,
  type RevokeInvitationError,
} from "./application/revoke-invitation.use-case";

/** @deprecated Import `AcceptInvitationResponse` from the contracts package. */
export type AcceptResult = AcceptInvitationResponse;

/**
 * Stable Nest compatibility facade.
 *
 * HTTP callers keep the original methods and exception bodies while the
 * workflow itself stays framework-free. Acceptance and revocation audit inside
 * their atomic database RPCs; only creation is audited here, after notification
 * succeeds, matching the existing timing.
 */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly createInvitation: CreateInvitationUseCase,
    private readonly acceptInvitation: AcceptInvitationUseCase,
    private readonly revokeInvitation: RevokeInvitationUseCase,
    private readonly listInvitations: ListInvitationsQuery,
    private readonly audit: AuditService,
  ) {}

  async create(
    orgId: string,
    actor: { id: string; email: string },
    input: {
      email: string;
      role: BaseRole;
      firstName?: string;
      lastName?: string;
    },
  ): Promise<{ id: string }> {
    const result = await this.createInvitation.execute({ orgId, actor, input });
    if (!result.ok) this.throwCreateError(result.error);

    this.audit.log({
      organizationId: orgId,
      userId: actor.id,
      actorEmail: actor.email,
      action: "invitation.created",
      entityType: "invitation",
      entityId: result.value.id,
      changes: { email: normalizeEmail(input.email), role: input.role },
    });

    return { id: result.value.id };
  }

  async accept(
    token: string,
    user: { id: string; email: string },
  ): Promise<AcceptResult> {
    const result = await this.acceptInvitation.execute({ token, user });
    if (!result.ok) this.throwAcceptanceError(result.error);
    return result.value;
  }

  async revoke(
    orgId: string,
    actor: { id: string; email: string },
    invitationId: string,
  ): Promise<void> {
    const result = await this.revokeInvitation.execute({
      orgId,
      actor,
      invitationId,
    });
    if (!result.ok) this.throwRevocationError(result.error);
  }

  async list(orgId: string): Promise<Invitation[]> {
    const result = await this.listInvitations.execute({ orgId });
    if (!result.ok) {
      this.logger.error("Invitation list failed");
      return [];
    }
    return result.value.map((invitation) => ({ ...invitation }));
  }

  private throwCreateError(error: CreateInvitationError): never {
    switch (error.code) {
      case "cannot_invite_self":
        throw new BadRequestException({
          message: "You are already a member of this organization.",
          code: "cannot_invite_self",
        });
      case "already_member":
        throw new BadRequestException({
          message: "That person is already a member of this organization.",
          code: "already_member",
          fieldErrors: { email: "Already a member." },
        });
      case "invitation_pending":
        throw new BadRequestException({
          message: "An invitation has already been sent to that address.",
          code: "invitation_pending",
          fieldErrors: { email: "An invitation is already outstanding." },
        });
      case "organization_not_found":
        throw new NotFoundException({
          message: "That organization no longer exists.",
          code: "organization_not_found",
        });
      case "notification_failed":
        this.logger.error(
          `Invitation notification failed after creating ${error.invitationId}`,
        );
        throw new InternalServerErrorException({
          statusCode: 500,
          message: "Internal server error",
        });
      case "invitation_failed":
        throw new BadRequestException({
          message: "We could not create that invitation.",
          code: "invitation_failed",
        });
    }
  }

  private throwAcceptanceError(error: AcceptInvitationError): never {
    switch (error.code) {
      case "invitation_not_found":
        throw new NotFoundException({
          message: "That invitation link is not valid.",
          code: "invitation_not_found",
        });
      case "invitation_expired":
        throw new BadRequestException({
          message: "That invitation has expired.",
          code: "invitation_expired",
        });
      case "invitation_email_mismatch":
        throw new ForbiddenException({
          message: "That invitation was sent to a different email address.",
          code: "invitation_email_mismatch",
        });
      case "invitation_not_pending":
        throw new BadRequestException({
          message: "That invitation is no longer valid.",
          code: "invitation_not_pending",
        });
      case "organization_not_found":
        throw new NotFoundException({
          message: "That organization no longer exists.",
          code: "organization_not_found",
        });
      case "membership_failed":
        throw new BadRequestException({
          message: "We could not add you to that organization.",
          code: "membership_failed",
        });
    }
  }

  private throwRevocationError(error: RevokeInvitationError): never {
    switch (error.code) {
      case "invitation_not_found":
        throw new NotFoundException({
          message: "That invitation no longer exists.",
          code: "invitation_not_found",
        });
      case "invitation_already_accepted":
        throw new ConflictException({
          message: "That invitation has already been accepted.",
          code: "invitation_already_accepted",
        });
      case "invitation_not_pending":
        throw new BadRequestException({
          message: "That invitation is no longer valid.",
          code: "invitation_not_pending",
        });
      case "invitation_failed":
        throw new BadRequestException({
          message: "We could not revoke that invitation.",
          code: "invitation_failed",
        });
    }
  }
}
