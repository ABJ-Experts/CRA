import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import {
  createTaskAbsenceInputSchema,
  deleteTaskAbsenceInputSchema,
  taskAbsenceMutationResponseSchema,
  taskAbsenceParamsSchema,
  taskAbsencesResponseSchema,
  taskMemberCandidatesResponseSchema,
  type CreateTaskAbsenceInput,
  type DeleteTaskAbsenceInput,
  type TaskAbsenceParams,
} from "@repo/contracts/tasks";
import { CurrentUser, RequireRole, type RequestUser } from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import { zodBody, zodParams } from "../common/pipes/zod-validation.pipe";
import { TaskUseCases } from "./application/task-use-cases";
import { organizationId, unwrap } from "./tasks.controller";

@Controller("task-absences")
@RequireRole("viewer")
export class TaskAbsencesController {
  constructor(private readonly tasks: TaskUseCases) {}

  @Get()
  @ZodResponse(taskAbsencesResponseSchema)
  list(@CurrentUser() user: RequestUser) {
    return unwrap(this.tasks.absences(organizationId(user), user.id));
  }

  @Get("member-candidates")
  @ZodResponse(taskMemberCandidatesResponseSchema)
  memberCandidates(@CurrentUser() user: RequestUser) {
    return unwrap(this.tasks.memberCandidates(organizationId(user), user.id));
  }

  @Post()
  @ZodResponse(taskAbsenceMutationResponseSchema)
  create(
    @Body(zodBody(createTaskAbsenceInputSchema)) input: CreateTaskAbsenceInput,
    @CurrentUser() user: RequestUser,
  ) {
    return unwrap(
      this.tasks.manageAbsence(organizationId(user), user.id, {
        action: "create",
        ...input,
      }),
    );
  }

  @Delete(":absenceId")
  @ZodResponse(taskAbsenceMutationResponseSchema)
  delete(
    @Param(zodParams(taskAbsenceParamsSchema)) params: TaskAbsenceParams,
    @Body(zodBody(deleteTaskAbsenceInputSchema)) input: DeleteTaskAbsenceInput,
    @CurrentUser() user: RequestUser,
  ) {
    return unwrap(
      this.tasks.manageAbsence(organizationId(user), user.id, {
        action: "delete",
        ...params,
        ...input,
      }),
    );
  }
}
