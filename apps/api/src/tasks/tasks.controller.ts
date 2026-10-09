import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  assignTaskInputSchema,
  claimTaskInputSchema,
  delegateTaskInputSchema,
  releaseTaskInputSchema,
  revokeTaskDelegationInputSchema,
  taskDetailResponseSchema,
  taskEligibleAssigneesResponseSchema,
  taskListQuerySchema,
  taskListResponseSchema,
  taskMutationResponseSchema,
  taskParamsSchema,
  type AssignTaskInput,
  type ClaimTaskInput,
  type DelegateTaskInput,
  type ReleaseTaskInput,
  type RevokeTaskDelegationInput,
  type TaskListQuery,
  type TaskParams,
} from "@repo/contracts/tasks";
import { CurrentUser, RequireRole, type RequestUser } from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import {
  zodBody,
  zodParams,
  zodQuery,
} from "../common/pipes/zod-validation.pipe";
import type { TaskResult } from "./application/task.port";
import { TaskUseCases } from "./application/task-use-cases";

/** Source policy and product scope are rechecked by the task read/command RPCs. */
@Controller("tasks")
@RequireRole("viewer")
export class TasksController {
  constructor(private readonly tasks: TaskUseCases) {}

  @Get()
  @ZodResponse(taskListResponseSchema)
  list(
    @Query(zodQuery(taskListQuerySchema)) query: TaskListQuery,
    @CurrentUser() user: RequestUser,
  ) {
    return unwrap(this.tasks.list(organizationId(user), user.id, query));
  }

  @Get(":taskType/:sourceId/eligible-assignees")
  @ZodResponse(taskEligibleAssigneesResponseSchema)
  eligibleAssignees(
    @Param(zodParams(taskParamsSchema)) params: TaskParams,
    @CurrentUser() user: RequestUser,
  ) {
    return unwrap(
      this.tasks.eligibleAssignees(
        organizationId(user),
        user.id,
        params.taskType,
        params.sourceId,
      ),
    );
  }

  @Get(":taskType/:sourceId")
  @ZodResponse(taskDetailResponseSchema)
  detail(
    @Param(zodParams(taskParamsSchema)) params: TaskParams,
    @CurrentUser() user: RequestUser,
  ) {
    return unwrap(
      this.tasks.get(
        organizationId(user),
        user.id,
        params.taskType,
        params.sourceId,
      ),
    );
  }

  @Post(":taskType/:sourceId/assign")
  @ZodResponse(taskMutationResponseSchema)
  assign(
    @Param(zodParams(taskParamsSchema)) params: TaskParams,
    @Body(zodBody(assignTaskInputSchema)) input: AssignTaskInput,
    @CurrentUser() user: RequestUser,
  ) {
    return unwrap(
      this.tasks.route(organizationId(user), user.id, {
        action: "assign",
        ...params,
        ...input,
        targetUserId: input.assigneeUserId,
      }),
    );
  }

  @Post(":taskType/:sourceId/claim")
  @ZodResponse(taskMutationResponseSchema)
  claim(
    @Param(zodParams(taskParamsSchema)) params: TaskParams,
    @Body(zodBody(claimTaskInputSchema)) input: ClaimTaskInput,
    @CurrentUser() user: RequestUser,
  ) {
    return unwrap(
      this.tasks.route(organizationId(user), user.id, {
        action: "claim",
        ...params,
        ...input,
      }),
    );
  }

  @Post(":taskType/:sourceId/release")
  @ZodResponse(taskMutationResponseSchema)
  release(
    @Param(zodParams(taskParamsSchema)) params: TaskParams,
    @Body(zodBody(releaseTaskInputSchema)) input: ReleaseTaskInput,
    @CurrentUser() user: RequestUser,
  ) {
    return unwrap(
      this.tasks.route(organizationId(user), user.id, {
        action: "release",
        ...params,
        ...input,
      }),
    );
  }

  @Post(":taskType/:sourceId/delegate")
  @ZodResponse(taskMutationResponseSchema)
  delegate(
    @Param(zodParams(taskParamsSchema)) params: TaskParams,
    @Body(zodBody(delegateTaskInputSchema)) input: DelegateTaskInput,
    @CurrentUser() user: RequestUser,
  ) {
    return unwrap(
      this.tasks.route(organizationId(user), user.id, {
        action: "delegate",
        ...params,
        ...input,
        targetUserId: input.substituteUserId,
        delegationExpiresAt: input.expiresAt,
      }),
    );
  }

  @Post(":taskType/:sourceId/revoke-delegation")
  @ZodResponse(taskMutationResponseSchema)
  revokeDelegation(
    @Param(zodParams(taskParamsSchema)) params: TaskParams,
    @Body(zodBody(revokeTaskDelegationInputSchema))
    input: RevokeTaskDelegationInput,
    @CurrentUser() user: RequestUser,
  ) {
    return unwrap(
      this.tasks.route(organizationId(user), user.id, {
        action: "revoke_delegation",
        ...params,
        ...input,
      }),
    );
  }
}

export function organizationId(user: RequestUser): string {
  if (user.organizationId) return user.organizationId;
  throw new ForbiddenException({
    message: "An active organization is required.",
    code: "no_organization",
  });
}

export async function unwrap<T>(promise: Promise<TaskResult<T>>): Promise<T> {
  let result: TaskResult<T>;
  try {
    result = await promise;
  } catch {
    throw new ServiceUnavailableException({
      message: "The task inbox is temporarily unavailable.",
      code: "unavailable",
    });
  }
  switch (result.outcome) {
    case "found":
    case "updated":
    case "replayed":
      return result.data;
    case "forbidden":
      throw new ForbiddenException({
        message: "You are no longer allowed to access this task.",
        code: "forbidden",
      });
    case "not_found":
      throw new NotFoundException({
        message: "Task was not found.",
        code: "not_found",
      });
    case "conflict":
      throw new ConflictException({
        message: "The task changed. Refresh and retry.",
        code: "conflict",
      });
    case "invalid_request":
      throw new BadRequestException({
        message: "This task action is not valid.",
        code: "invalid_request",
      });
  }
}
