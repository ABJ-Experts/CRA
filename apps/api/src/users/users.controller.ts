import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { auditRequestIdSchema } from "@repo/contracts/audit/schemas";
import { pageParamsSchema } from "@repo/contracts/pagination/schemas";
import type { PageParams } from "@repo/contracts/pagination/types";
import { okResponseSchema } from "@repo/contracts/shared/schemas";
import type { OkResponse } from "@repo/contracts/shared/types";
import {
  changeMemberRoleInputSchema,
  memberIdParamSchema,
  memberListResponseSchema,
  setMemberActiveInputSchema,
  updateProfileInputSchema,
} from "@repo/contracts/users/schemas";
import type {
  ChangeMemberRoleInput,
  MemberIdParam,
  MemberListResponse,
  SetMemberActiveInput,
  UpdateProfileInput,
} from "@repo/contracts/users/types";

import { ZodResponse } from "../common/http/zod-response.interceptor";
import {
  zodBody,
  zodParams,
  zodQuery,
} from "../common/pipes/zod-validation.pipe";
import {
  CurrentUser,
  RequirePermissions,
  SelfScoped,
  type RequestUser,
} from "../auth/auth.types";
import { UsersService } from "./users.service";
import type { AuditMutationContext } from "./application/member-repository.port";

function auditContext(
  eventHeader: string | undefined,
  correlationHeader: string | undefined,
  request?: Request,
): AuditMutationContext {
  const event =
    eventHeader === undefined
      ? randomUUID()
      : auditRequestIdSchema.safeParse(eventHeader).data;
  const correlation =
    correlationHeader === undefined
      ? event
      : auditRequestIdSchema.safeParse(correlationHeader).data;
  if (!event || !correlation)
    throw new BadRequestException({
      code: "invalid_audit_identity",
      message: "Invalid request identity header.",
    });
  return Object.freeze({
    eventKey: event,
    correlationId: correlation,
    sourceIp: request?.ip ?? null,
  });
}

@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Everything here is scoped to the caller's active organization. */
  private orgOf(user: RequestUser): string {
    if (!user.organizationId) {
      throw new ForbiddenException({
        message: "You are not a member of any organization.",
        code: "no_organization",
      });
    }
    return user.organizationId;
  }

  @RequirePermissions("can_view_users")
  @Get()
  @ZodResponse(memberListResponseSchema)
  async list(
    @CurrentUser() user: RequestUser,
    @Query(zodQuery(pageParamsSchema)) params: PageParams,
  ): Promise<MemberListResponse> {
    return this.users.listMembers(this.orgOf(user), params);
  }

  @SelfScoped("Updates only the caller's own profile row.")
  @Patch("me")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(okResponseSchema)
  async updateMe(
    @Body(zodBody(updateProfileInputSchema)) dto: UpdateProfileInput,
    @CurrentUser() user: RequestUser,
    @Headers("idempotency-key") eventKey?: string,
    @Headers("x-correlation-id") correlationId?: string,
    @Req() request?: Request,
  ): Promise<OkResponse> {
    await this.users.updateProfile(
      user.id,
      dto,
      user.organizationId,
      auditContext(eventKey, correlationId, request),
    );
    return { ok: true };
  }

  @RequirePermissions("can_edit_users")
  @Patch(":id/role")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(okResponseSchema)
  async changeRole(
    @Param(zodParams(memberIdParamSchema)) { id }: MemberIdParam,
    @Body(zodBody(changeMemberRoleInputSchema)) dto: ChangeMemberRoleInput,
    @CurrentUser() user: RequestUser,
    @Headers("idempotency-key") eventKey?: string,
    @Headers("x-correlation-id") correlationId?: string,
    @Req() request?: Request,
  ): Promise<OkResponse> {
    await this.users.changeRole(
      this.orgOf(user),
      { id: user.id, email: user.email },
      id,
      dto.role,
      auditContext(eventKey, correlationId, request),
    );
    return { ok: true };
  }

  @RequirePermissions("can_edit_users")
  @Patch(":id/active")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(okResponseSchema)
  async setActive(
    @Param(zodParams(memberIdParamSchema)) { id }: MemberIdParam,
    @Body(zodBody(setMemberActiveInputSchema)) dto: SetMemberActiveInput,
    @CurrentUser() user: RequestUser,
    @Headers("idempotency-key") eventKey?: string,
    @Headers("x-correlation-id") correlationId?: string,
    @Req() request?: Request,
  ): Promise<OkResponse> {
    await this.users.setActive(
      this.orgOf(user),
      { id: user.id, email: user.email },
      id,
      dto.isActive,
      auditContext(eventKey, correlationId, request),
    );
    return { ok: true };
  }

  @RequirePermissions("can_delete_users")
  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(okResponseSchema)
  async remove(
    @Param(zodParams(memberIdParamSchema)) { id }: MemberIdParam,
    @CurrentUser() user: RequestUser,
    @Headers("idempotency-key") eventKey?: string,
    @Headers("x-correlation-id") correlationId?: string,
    @Req() request?: Request,
  ): Promise<OkResponse> {
    await this.users.removeMember(
      this.orgOf(user),
      { id: user.id, email: user.email },
      id,
      auditContext(eventKey, correlationId, request),
    );
    return { ok: true };
  }
}
