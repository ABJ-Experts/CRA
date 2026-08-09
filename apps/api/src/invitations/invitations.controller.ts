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
import { BASE_ROLES } from "@repo/contracts/permissions";
import { z } from "zod";

import { zodBody } from "../common/pipes/zod-validation.pipe";
import {
  CurrentUser,
  RequirePermissions,
  SelfScoped,
  type RequestUser,
} from "../auth/auth.types";
import { InvitationsService, type AcceptResult } from "./invitations.service";

const createSchema = z.object({
  email: z
    .string()
    .trim()
    .max(254)
    .pipe(z.email({ message: "Enter a valid email address" })),
  role: z.enum(BASE_ROLES).default("member"),
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
});

const acceptSchema = z.object({ token: z.string().min(32).max(128) });

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
  async list(@CurrentUser() user: RequestUser) {
    return { rows: await this.invitations.list(this.orgOf(user)) };
  }

  @RequirePermissions("can_create_invitations")
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(zodBody(createSchema)) dto: z.infer<typeof createSchema>,
    @CurrentUser() user: RequestUser,
  ): Promise<{ id: string }> {
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
  async accept(
    @Body(zodBody(acceptSchema)) dto: { token: string },
    @CurrentUser() user: RequestUser,
  ): Promise<AcceptResult> {
    return this.invitations.accept(dto.token, {
      id: user.id,
      email: user.email,
    });
  }

  @RequirePermissions("can_delete_invitations")
  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  async revoke(
    @Param("id") id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<{ ok: true }> {
    await this.invitations.revoke(
      this.orgOf(user),
      { id: user.id, email: user.email },
      id,
    );
    return { ok: true };
  }
}
