import { Module } from "@nestjs/common";
import { SupabaseModule } from "../supabase/supabase.module";
import { TASK_REPOSITORY, type TaskRepository } from "./application/task.port";
import { TaskUseCases } from "./application/task-use-cases";
import { SupabaseTaskRepository } from "./infrastructure/supabase-task.repository";
import { TaskAbsencesController } from "./task-absences.controller";
import { TaskGroupsController } from "./task-groups.controller";
import { TasksController } from "./tasks.controller";

@Module({
  imports: [SupabaseModule],
  controllers: [TasksController, TaskGroupsController, TaskAbsencesController],
  providers: [
    SupabaseTaskRepository,
    { provide: TASK_REPOSITORY, useExisting: SupabaseTaskRepository },
    {
      provide: TaskUseCases,
      inject: [TASK_REPOSITORY],
      useFactory: (repository: TaskRepository) => new TaskUseCases(repository),
    },
  ],
})
export class TasksModule {}
