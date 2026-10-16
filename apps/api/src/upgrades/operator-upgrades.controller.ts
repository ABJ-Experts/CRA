import { UpgradeControlError } from "./application/upgrade-supervisor.port";
import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Query,
  Req,
  NotFoundException,
  HttpException,
} from "@nestjs/common";
import * as schemas from "@repo/contracts/upgrades/schemas";
import type { z } from "zod";
import {
  zodBody,
  zodParams,
  zodQuery,
} from "../common/pipes/zod-validation.pipe";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import { OperatorScoped } from "../operator/operator-scoped.decorator";
import type { OperatorRequest } from "../operator/operator-request";
import {
  UpgradeUseCases,
  UpgradeScopeError,
} from "./application/upgrade-use-cases";
@OperatorScoped(
  "Fresh private raw mTLS identity with explicit instance-bound upgrade actions",
)
@Controller("operator/instances/:instanceId/upgrades")
export class OperatorUpgradesController {
  constructor(private readonly upgrades: UpgradeUseCases) {}
  private async execute(...args: Parameters<UpgradeUseCases["execute"]>) {
    try {
      return await this.upgrades.execute(...args);
    } catch (error) {
      if (error instanceof UpgradeScopeError)
        throw new NotFoundException("Upgrade scope unavailable");
      if (error instanceof UpgradeControlError)
        throw new HttpException("Upgrade control unavailable", error.status);
      throw error;
    }
  }
  @Get("capabilities")
  @ZodResponse(schemas.upgradeCapabilitiesSchema)
  capabilities(
    @Req() request: OperatorRequest,
    @Param(zodParams(schemas.upgradeInstanceParamsSchema))
    params: z.output<typeof schemas.upgradeInstanceParamsSchema>,
    @Query(zodQuery(schemas.upgradeEmptyQuerySchema))
    query: z.output<typeof schemas.upgradeEmptyQuerySchema>,
  ) {
    void query;
    return this.execute(
      request.operatorIdentity,
      params.instanceId,
      "capabilities/read",
      {},
    );
  }
  @Get("media")
  @ZodResponse(schemas.upgradeMediaListSchema)
  media(
    @Req() request: OperatorRequest,
    @Param(zodParams(schemas.upgradeInstanceParamsSchema))
    params: z.output<typeof schemas.upgradeInstanceParamsSchema>,
    @Query(zodQuery(schemas.upgradeEmptyQuerySchema))
    query: z.output<typeof schemas.upgradeEmptyQuerySchema>,
  ) {
    void query;
    return this.execute(
      request.operatorIdentity,
      params.instanceId,
      "media/list",
      {},
    );
  }
  @Get("history")
  @ZodResponse(schemas.upgradeHistorySchema)
  history(
    @Req() request: OperatorRequest,
    @Param(zodParams(schemas.upgradeInstanceParamsSchema))
    params: z.output<typeof schemas.upgradeInstanceParamsSchema>,
    @Query(zodQuery(schemas.upgradeHistoryQuerySchema))
    query: z.output<typeof schemas.upgradeHistoryQuerySchema>,
  ) {
    return this.execute(
      request.operatorIdentity,
      params.instanceId,
      "run/list",
      query,
    );
  }
  @Get("runs/:runId")
  @ZodResponse(schemas.upgradeRunSchema)
  detail(
    @Req() request: OperatorRequest,
    @Param(zodParams(schemas.upgradeRunParamsSchema))
    params: z.output<typeof schemas.upgradeRunParamsSchema>,
    @Query(zodQuery(schemas.upgradeEmptyQuerySchema))
    query: z.output<typeof schemas.upgradeEmptyQuerySchema>,
  ) {
    void query;
    return this.execute(
      request.operatorIdentity,
      params.instanceId,
      "run/read",
      { ...{}, runId: params.runId },
    );
  }
  @Get("runs/:runId/result")
  @ZodResponse(schemas.upgradeResultSchema)
  result(
    @Req() request: OperatorRequest,
    @Param(zodParams(schemas.upgradeRunParamsSchema))
    params: z.output<typeof schemas.upgradeRunParamsSchema>,
    @Query(zodQuery(schemas.upgradeEmptyQuerySchema))
    query: z.output<typeof schemas.upgradeEmptyQuerySchema>,
  ) {
    void query;
    return this.execute(
      request.operatorIdentity,
      params.instanceId,
      "run/result",
      { ...{}, runId: params.runId },
    );
  }
  @Post("stage")
  @ZodResponse(schemas.upgradeRunSchema)
  stage(
    @Req() request: OperatorRequest,
    @Param(zodParams(schemas.upgradeInstanceParamsSchema))
    params: z.output<typeof schemas.upgradeInstanceParamsSchema>,
    @Body(zodBody(schemas.upgradeStageInputSchema))
    input: z.output<typeof schemas.upgradeStageInputSchema>,
  ) {
    return this.execute(
      request.operatorIdentity,
      params.instanceId,
      "media/stage",
      input,
    );
  }
  @Post("runs/:runId/preflight")
  @ZodResponse(schemas.upgradePreflightSchema)
  preflight(
    @Req() request: OperatorRequest,
    @Param(zodParams(schemas.upgradeRunParamsSchema))
    params: z.output<typeof schemas.upgradeRunParamsSchema>,
    @Body(zodBody(schemas.upgradePreflightInputSchema))
    input: z.output<typeof schemas.upgradePreflightInputSchema>,
  ) {
    return this.execute(
      request.operatorIdentity,
      params.instanceId,
      "run/preflight",
      { ...input, runId: params.runId },
    );
  }
  @Post("runs/:runId/apply")
  @ZodResponse(schemas.upgradeRunSchema)
  apply(
    @Req() request: OperatorRequest,
    @Param(zodParams(schemas.upgradeRunParamsSchema))
    params: z.output<typeof schemas.upgradeRunParamsSchema>,
    @Body(zodBody(schemas.upgradeApplyInputSchema))
    input: z.output<typeof schemas.upgradeApplyInputSchema>,
  ) {
    return this.execute(
      request.operatorIdentity,
      params.instanceId,
      "run/apply",
      { ...input, runId: params.runId },
    );
  }
  @Post("runs/:runId/rollback")
  @ZodResponse(schemas.upgradeRunSchema)
  rollback(
    @Req() request: OperatorRequest,
    @Param(zodParams(schemas.upgradeRunParamsSchema))
    params: z.output<typeof schemas.upgradeRunParamsSchema>,
    @Body(zodBody(schemas.upgradeRollbackInputSchema))
    input: z.output<typeof schemas.upgradeRollbackInputSchema>,
  ) {
    return this.execute(
      request.operatorIdentity,
      params.instanceId,
      "run/rollback",
      { ...input, runId: params.runId },
    );
  }
  @Post("runs/:runId/reconcile")
  @ZodResponse(schemas.upgradeRunSchema)
  reconcile(
    @Req() request: OperatorRequest,
    @Param(zodParams(schemas.upgradeRunParamsSchema))
    params: z.output<typeof schemas.upgradeRunParamsSchema>,
    @Body(zodBody(schemas.upgradeMutationSchema))
    input: z.output<typeof schemas.upgradeMutationSchema>,
  ) {
    return this.execute(
      request.operatorIdentity,
      params.instanceId,
      "run/reconcile",
      { ...input, runId: params.runId },
    );
  }
}
