import type {
  TaskAbsenceCommand,
  TaskGroupCommand,
  TaskQuery,
  TaskRepository,
  TaskRouteCommand,
  TaskType,
} from "./task.port";

/** The application boundary keeps controllers independent of Supabase. */
export class TaskUseCases {
  constructor(private readonly repository: TaskRepository) {}

  list(organizationId: string, actorId: string, query: TaskQuery) {
    return this.repository.list(organizationId, actorId, query);
  }
  get(
    organizationId: string,
    actorId: string,
    taskType: TaskType,
    sourceId: string,
  ) {
    return this.repository.get(organizationId, actorId, taskType, sourceId);
  }
  eligibleAssignees(
    organizationId: string,
    actorId: string,
    taskType: TaskType,
    sourceId: string,
  ) {
    return this.repository.eligibleAssignees(
      organizationId,
      actorId,
      taskType,
      sourceId,
    );
  }
  memberCandidates(organizationId: string, actorId: string) {
    return this.repository.memberCandidates(organizationId, actorId);
  }
  route(organizationId: string, actorId: string, command: TaskRouteCommand) {
    return this.repository.route(organizationId, actorId, command);
  }
  groups(organizationId: string, actorId: string) {
    return this.repository.groups(organizationId, actorId);
  }
  group(organizationId: string, actorId: string, groupId: string) {
    return this.repository.group(organizationId, actorId, groupId);
  }
  manageGroup(
    organizationId: string,
    actorId: string,
    command: TaskGroupCommand,
  ) {
    return this.repository.manageGroup(organizationId, actorId, command);
  }
  absences(organizationId: string, actorId: string) {
    return this.repository.absences(organizationId, actorId);
  }
  manageAbsence(
    organizationId: string,
    actorId: string,
    command: TaskAbsenceCommand,
  ) {
    return this.repository.manageAbsence(organizationId, actorId, command);
  }
}
