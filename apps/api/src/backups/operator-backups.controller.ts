import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import {
  backupCleanupInputSchema,
  backupCleanupReviewInputSchema,
  backupCleanupReviewSchema,
  backupEmptyQuerySchema,
  backupHistoryQuerySchema,
  backupHistorySchema,
  backupInstanceParamsSchema,
  backupMutationSchema,
  backupPolicyInputSchema,
  backupPolicyResponseSchema,
  backupPolicySchema,
  backupPolicyValidationInputSchema,
  backupRunParamsSchema,
  backupRunRequestSchema,
  backupRunSchema,
  backupValidationSchema,
  backupVerificationRequestSchema,
} from "@repo/contracts/backups/schemas";
import type {
  BackupEmptyQuery,
  BackupCleanupInput,
  BackupCleanupReviewInput,
  BackupHistoryQuery,
  BackupInstanceParams,
  BackupMutation,
  BackupPolicyInput,
  BackupPolicyValidationInput,
  BackupRunParams,
  BackupRunRequest,
  BackupVerificationRequest,
} from "@repo/contracts/backups/types";
import {
  zodBody,
  zodParams,
  zodQuery,
} from "../common/pipes/zod-validation.pipe";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import { OperatorScoped } from "../operator/operator-scoped.decorator";
import type { OperatorRequest } from "../operator/operator-request";
import { BackupScopeError } from "./domain/backup-errors";
import { BackupUseCases } from "./application/backup-use-cases";
@OperatorScoped(
  "Fresh private raw mTLS identity with explicit instance-bound backup execution actions",
)
@Controller("operator/instances/:instanceId/backups")
export class OperatorBackupsController {
  constructor(private readonly backups: BackupUseCases) {}
  private async execute(
    ...args: Parameters<BackupUseCases["execute"]>
  ): Promise<unknown> {
    try {
      return await this.backups.execute(...args);
    } catch (error) {
      if (error instanceof BackupScopeError)
        throw new NotFoundException("Backup scope unavailable");
      throw error;
    }
  }
  @Get("policy")
  @ZodResponse(backupPolicyResponseSchema)
  async policy(
    @Req() request: OperatorRequest,
    @Param(zodParams(backupInstanceParamsSchema)) params: BackupInstanceParams,
    @Query(zodQuery(backupEmptyQuerySchema)) query: BackupEmptyQuery,
  ) {
    void query;
    return {
      policy: await this.execute(
        request.operatorIdentity,
        params.instanceId,
        "policy/read",
        "backups.view",
      ),
    };
  }
  @Post("policy/validate")
  @ZodResponse(backupValidationSchema)
  validate(
    @Req() request: OperatorRequest,
    @Param(zodParams(backupInstanceParamsSchema)) params: BackupInstanceParams,
    @Body(zodBody(backupPolicyValidationInputSchema))
    input: BackupPolicyValidationInput,
  ) {
    return this.execute(
      request.operatorIdentity,
      params.instanceId,
      "policy/validate",
      "backups.configure",
      input,
    );
  }
  @Put("policy")
  @ZodResponse(backupPolicySchema)
  configure(
    @Req() request: OperatorRequest,
    @Param(zodParams(backupInstanceParamsSchema)) params: BackupInstanceParams,
    @Body(zodBody(backupPolicyInputSchema)) input: BackupPolicyInput,
  ) {
    return this.execute(
      request.operatorIdentity,
      params.instanceId,
      "policy/update",
      "backups.configure",
      input,
    );
  }
  @Post("runs")
  @ZodResponse(backupRunSchema)
  create(
    @Req() request: OperatorRequest,
    @Param(zodParams(backupInstanceParamsSchema)) params: BackupInstanceParams,
    @Body(zodBody(backupRunRequestSchema)) input: BackupRunRequest,
  ) {
    return this.execute(
      request.operatorIdentity,
      params.instanceId,
      "run/create",
      "backups.run",
      { ...input, kind: "capture", parentRunId: null },
    );
  }
  @Get("runs")
  @ZodResponse(backupHistorySchema)
  history(
    @Req() request: OperatorRequest,
    @Param(zodParams(backupInstanceParamsSchema)) params: BackupInstanceParams,
    @Query(zodQuery(backupHistoryQuerySchema)) query: BackupHistoryQuery,
  ) {
    return this.execute(
      request.operatorIdentity,
      params.instanceId,
      "run/list",
      "backups.view",
      query,
    );
  }
  @Get("runs/:runId")
  @ZodResponse(backupRunSchema)
  detail(
    @Req() request: OperatorRequest,
    @Param(zodParams(backupRunParamsSchema)) params: BackupRunParams,
    @Query(zodQuery(backupEmptyQuerySchema)) query: BackupEmptyQuery,
  ) {
    void query;
    return this.execute(
      request.operatorIdentity,
      params.instanceId,
      "run/read",
      "backups.view",
      { runId: params.runId },
    );
  }
  @Post("runs/:runId/cancel")
  @ZodResponse(backupRunSchema)
  cancel(
    @Req() request: OperatorRequest,
    @Param(zodParams(backupRunParamsSchema)) params: BackupRunParams,
    @Body(zodBody(backupMutationSchema)) input: BackupMutation,
  ) {
    return this.execute(
      request.operatorIdentity,
      params.instanceId,
      "run/cancel",
      "backups.run",
      { ...input, runId: params.runId },
    );
  }
  @Post("runs/:runId/verifications")
  @ZodResponse(backupRunSchema)
  verify(
    @Req() request: OperatorRequest,
    @Param(zodParams(backupRunParamsSchema)) params: BackupRunParams,
    @Body(zodBody(backupVerificationRequestSchema))
    input: BackupVerificationRequest,
  ) {
    return this.execute(
      request.operatorIdentity,
      params.instanceId,
      "run/create",
      "backups.verify",
      { ...input, kind: "verification", parentRunId: params.runId },
    );
  }
  @Post("runs/:runId/cleanup-review")
  @ZodResponse(backupCleanupReviewSchema)
  cleanupReview(
    @Req() request: OperatorRequest,
    @Param(zodParams(backupRunParamsSchema)) params: BackupRunParams,
    @Body(zodBody(backupCleanupReviewInputSchema))
    input: BackupCleanupReviewInput,
  ) {
    return this.execute(
      request.operatorIdentity,
      params.instanceId,
      "cleanup/review",
      "backups.cleanup",
      { ...input, runId: params.runId },
    );
  }
  @Post("runs/:runId/cleanup")
  @ZodResponse(backupRunSchema)
  cleanup(
    @Req() request: OperatorRequest,
    @Param(zodParams(backupRunParamsSchema)) params: BackupRunParams,
    @Body(zodBody(backupCleanupInputSchema)) input: BackupCleanupInput,
  ) {
    return this.execute(
      request.operatorIdentity,
      params.instanceId,
      "cleanup/request",
      "backups.cleanup",
      { ...input, runId: params.runId },
    );
  }
}
