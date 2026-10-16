import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import {
  createTaskGroupInputSchema,
  taskGroupDetailResponseSchema,
  taskGroupMemberInputSchema,
  removeTaskGroupMemberInputSchema,
  taskGroupMemberParamsSchema,
  taskGroupMutationResponseSchema,
  taskGroupParamsSchema,
  taskGroupsResponseSchema,
  updateTaskGroupInputSchema,
  type CreateTaskGroupInput,
  type TaskGroupMemberInput,
  type RemoveTaskGroupMemberInput,
  type TaskGroupMemberParams,
  type TaskGroupParams,
  type UpdateTaskGroupInput,
} from "@repo/contracts/tasks";
import { CurrentUser, RequireRole, type RequestUser } from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import { zodBody, zodParams } from "../common/pipes/zod-validation.pipe";
import { TaskUseCases } from "./application/task-use-cases";
import { organizationId, unwrap } from "./tasks.controller";

@Controller("task-groups")
@RequireRole("viewer")
export class TaskGroupsController {
  constructor(private readonly tasks: TaskUseCases) {}

  @Get()
  @ZodResponse(taskGroupsResponseSchema)
  list(@CurrentUser() user: RequestUser) {
    return unwrap(this.tasks.groups(organizationId(user), user.id));
  }

  @Get(":groupId")
  @RequireRole("admin")
  @ZodResponse(taskGroupDetailResponseSchema)
  detail(
    @Param(zodParams(taskGroupParamsSchema)) params: TaskGroupParams,
    @CurrentUser() user: RequestUser,
  ) {
    return unwrap(
      this.tasks.group(organizationId(user), user.id, params.groupId),
    );
  }

  @Post()
  @RequireRole("admin")
  @ZodResponse(taskGroupMutationResponseSchema)
  create(
    @Body(zodBody(createTaskGroupInputSchema)) input: CreateTaskGroupInput,
    @CurrentUser() user: RequestUser,
  ) {
    return unwrap(
      this.tasks.manageGroup(organizationId(user), user.id, {
        action: "create",
        ...input,
      }),
    );
  }

  @Patch(":groupId")
  @RequireRole("admin")
  @ZodResponse(taskGroupMutationResponseSchema)
  update(
    @Param(zodParams(taskGroupParamsSchema)) params: TaskGroupParams,
    @Body(zodBody(updateTaskGroupInputSchema)) input: UpdateTaskGroupInput,
    @CurrentUser() user: RequestUser,
  ) {
    return unwrap(
      this.tasks.manageGroup(organizationId(user), user.id, {
        action: "update",
        ...params,
        ...input,
      }),
    );
  }

  @Post(":groupId/members")
  @RequireRole("admin")
  @ZodResponse(taskGroupMutationResponseSchema)
  addMember(
    @Param(zodParams(taskGroupParamsSchema)) params: TaskGroupParams,
    @Body(zodBody(taskGroupMemberInputSchema)) input: TaskGroupMemberInput,
    @CurrentUser() user: RequestUser,
  ) {
    return unwrap(
      this.tasks.manageGroup(organizationId(user), user.id, {
        action: "add_member",
        groupId: params.groupId,
        memberUserId: input.userId,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
      }),
    );
  }

  @Delete(":groupId/members/:userId")
  @RequireRole("admin")
  @ZodResponse(taskGroupMutationResponseSchema)
  removeMember(
    @Param(zodParams(taskGroupMemberParamsSchema))
    params: TaskGroupMemberParams,
    @Body(zodBody(removeTaskGroupMemberInputSchema))
    input: RemoveTaskGroupMemberInput,
    @CurrentUser() user: RequestUser,
  ) {
    return unwrap(
      this.tasks.manageGroup(organizationId(user), user.id, {
        action: "remove_member",
        groupId: params.groupId,
        memberUserId: params.userId,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
      }),
    );
  }
}
