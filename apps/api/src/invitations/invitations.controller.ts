import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from "@nestjs/common";
import {
  acceptInvitationInputSchema,
  acceptInvitationResponseSchema,
  createInvitationInputSchema,
  invitationIdParamSchema,
  invitationListResponseSchema,
} from "@repo/contracts/invitations/schemas";
import type {
  AcceptInvitationInput,
  AcceptInvitationResponse,
  CreateInvitationInput,
  InvitationIdParam,
  InvitationListResponse,
} from "@repo/contracts/invitations/types";
import {
  idResponseSchema,
  okResponseSchema,
} from "@repo/contracts/shared/schemas";
import type { IdResponse, OkResponse } from "@repo/contracts/shared/types";

import { ZodResponse } from "../common/http/zod-response.interceptor";
import { zodBody, zodParams } from "../common/pipes/zod-validation.pipe";
import {
  CurrentUser,
  RequirePermissions,
  SelfScoped,
  type RequestUser,
} from "../auth/auth.types";
import { InvitationsService } from "./invitations.service";

@Controller("invitations")
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  private orgOf(user: RequestUser): string {
    if (!user.organizationId) {
      throw new ForbiddenException({
        message: "You are not a member of any organization.",
        code: "no_organization",
      });
    }
    return user.organizationId;
  }

  @RequirePermissions("can_view_invitations")
  @Get()
  @ZodResponse(invitationListResponseSchema)
  async list(
    @CurrentUser() user: RequestUser,
  ): Promise<InvitationListResponse> {
    return { rows: await this.invitations.list(this.orgOf(user)) };
  }

  @RequirePermissions("can_create_invitations")
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ZodResponse(idResponseSchema)
  async create(
    @Body(zodBody(createInvitationInputSchema)) dto: CreateInvitationInput,
    @CurrentUser() user: RequestUser,
  ): Promise<IdResponse> {
    return this.invitations.create(
      this.orgOf(user),
      { id: user.id, email: user.email },
      {
        email: dto.email,
        role: dto.role,
        firstName: dto.firstName,
        lastName: dto.lastName,
      },
    );
  }

  /**
   * Accept. Requires a session, and the session's email must match the address
   * the invitation was sent to — otherwise a leaked link would be a way into an
   * organization for whoever found it.
   */
  @SelfScoped(
    "Binds the caller's own account to an invitation addressed to them.",
  )
  @Post("accept")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(acceptInvitationResponseSchema)
  async accept(
    @Body(zodBody(acceptInvitationInputSchema)) dto: AcceptInvitationInput,
    @CurrentUser() user: RequestUser,
  ): Promise<AcceptInvitationResponse> {
    return this.invitations.accept(dto.token, {
      id: user.id,
      email: user.email,
    });
  }

  @RequirePermissions("can_delete_invitations")
  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(okResponseSchema)
  async revoke(
    @Param(zodParams(invitationIdParamSchema)) { id }: InvitationIdParam,
    @CurrentUser() user: RequestUser,
  ): Promise<OkResponse> {
    await this.invitations.revoke(
      this.orgOf(user),
      { id: user.id, email: user.email },
      id,
    );
    return { ok: true };
  }
}
