import {
  Controller,
  ForbiddenException,
  ServiceUnavailableException,
  Get,
  Query,
} from "@nestjs/common";
import {
  backupAssuranceSchema,
  backupCustomerHistorySchema,
  backupEmptyQuerySchema,
  backupHistoryQuerySchema,
} from "@repo/contracts/backups/schemas";
import type {
  BackupEmptyQuery,
  BackupHistoryQuery,
} from "@repo/contracts/backups/types";
import {
  CurrentUser,
  RequirePermissions,
  type RequestUser,
} from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import { zodQuery } from "../common/pipes/zod-validation.pipe";
import {
  BackupAuthorizationError,
  BackupUnavailableError,
} from "./domain/backup-errors";
import { BackupAssuranceUseCases } from "./application/backup-assurance.use-cases";
@Controller("system/backups")
export class CustomerBackupsController {
  constructor(private readonly backups: BackupAssuranceUseCases) {}
  private async boundary<T>(read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (error instanceof BackupAuthorizationError)
        throw new ForbiddenException("Backup assurance unavailable");
      if (error instanceof BackupUnavailableError)
        throw new ServiceUnavailableException("Backup assurance unavailable");
      throw error;
    }
  }
  private organization(user: RequestUser): string {
    if (!user.organizationId)
      throw new ForbiddenException("A current organization is required");
    return user.organizationId;
  }
  @Get()
  @RequirePermissions("can_view_system_health")
  @ZodResponse(backupAssuranceSchema)
  summary(
    @CurrentUser() user: RequestUser,
    @Query(zodQuery(backupEmptyQuerySchema)) query: BackupEmptyQuery,
  ) {
    void query;
    return this.boundary(() =>
      this.backups.summary(this.organization(user), user.id),
    );
  }
  @Get("runs")
  @RequirePermissions("can_view_system_health")
  @ZodResponse(backupCustomerHistorySchema)
  history(
    @CurrentUser() user: RequestUser,
    @Query(zodQuery(backupHistoryQuerySchema)) query: BackupHistoryQuery,
  ) {
    return this.boundary(() =>
      this.backups.history(
        this.organization(user),
        user.id,
        query.limit,
        query.cursor,
        query.kind,
      ),
    );
  }
}
