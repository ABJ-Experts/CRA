import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import * as schemas from "@repo/contracts/connectors/schemas";
import type { z } from "zod";
import {
  CurrentUser,
  RequirePermissions,
  type RequestUser,
} from "../../auth/auth.types";
import { ZodResponse } from "../../common/http/zod-response.interceptor";
import {
  zodBody,
  zodParams,
  zodQuery,
} from "../../common/pipes/zod-validation.pipe";
import { agentHttpError } from "./agent-errors";
import { AgentManagementUseCases } from "./agent-management.use-cases";

@Controller("connectors/:connectorId/agents")
export class AgentManagementController {
  constructor(private readonly useCases: AgentManagementUseCases) {}
  private org(user: RequestUser): string {
    if (!user.organizationId)
      throw new NotFoundException({ code: "not_found" });
    return user.organizationId;
  }
  @RequirePermissions("can_edit_connectors")
  @Post("enrollments")
  @ZodResponse(schemas.issueAgentEnrollmentResponseSchema)
  async issue(
    @Param(zodParams(schemas.agentParamsSchema))
    params: z.output<typeof schemas.agentParamsSchema>,
    @Body(zodBody(schemas.issueAgentEnrollmentInputSchema))
    body: z.output<typeof schemas.issueAgentEnrollmentInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return await this.useCases.issue(
        this.org(user),
        params.connectorId,
        user.id,
        body.idempotencyKey,
      );
    } catch (error) {
      throw agentHttpError(error);
    }
  }
  @RequirePermissions("can_view_connectors")
  @Get()
  @ZodResponse(schemas.agentStatusResponseSchema)
  async status(
    @Param(zodParams(schemas.agentParamsSchema))
    params: z.output<typeof schemas.agentParamsSchema>,
    @Query(zodQuery(schemas.agentStatusQuerySchema))
    query: z.output<typeof schemas.agentStatusQuerySchema>,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return await this.useCases.status(
        this.org(user),
        params.connectorId,
        user.id,
        query.cursor,
      );
    } catch (error) {
      throw agentHttpError(error);
    }
  }
  @RequirePermissions("can_edit_connectors")
  @Post(":agentId/revoke")
  @ZodResponse(schemas.revokeAgentResponseSchema)
  async revoke(
    @Param(zodParams(schemas.agentIdentityParamsSchema))
    params: z.output<typeof schemas.agentIdentityParamsSchema>,
    @Body(zodBody(schemas.revokeAgentInputSchema))
    body: z.output<typeof schemas.revokeAgentInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return await this.useCases.revoke(
        this.org(user),
        params.connectorId,
        params.agentId,
        user.id,
        body.idempotencyKey,
      );
    } catch (error) {
      throw agentHttpError(error);
    }
  }
}
