import {
  Controller,
  Get,
  Query,
  ForbiddenException,
  Optional,
} from "@nestjs/common";
import {
  customerSystemHealthVersionedQuerySchema,
  customerSystemHealthVersionedResponseSchema,
} from "@repo/contracts/system/schemas";
import type {
  CustomerSystemHealthVersionedResponse,
  CustomerSystemHealthVersionedQuery,
} from "@repo/contracts/system/types";
import {
  CurrentUser,
  RequirePermissions,
  type RequestUser,
} from "../auth/auth.types";
import { zodQuery } from "../common/pipes/zod-validation.pipe";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import { BackupAuthorizationError } from "../backups/domain/backup-errors";
import { BackupAssuranceUseCases } from "../backups/application/backup-assurance.use-cases";
import { withBackupAssurance } from "../backups/domain/backup-health-projection";
import { SystemHealthUseCases } from "./application/system-health.use-cases";
import { SystemHealthAuthorizationError } from "./application/system-health.port";
@Controller("system")
export class SystemHealthController {
  constructor(
    private readonly health: SystemHealthUseCases,
    @Optional() private readonly backups?: BackupAssuranceUseCases,
  ) {}
  @Get("health")
  @RequirePermissions("can_view_system_health")
  @ZodResponse(customerSystemHealthVersionedResponseSchema)
  async read(
    @CurrentUser() user: RequestUser,
    @Query(zodQuery(customerSystemHealthVersionedQuerySchema))
    _query: CustomerSystemHealthVersionedQuery,
  ): Promise<CustomerSystemHealthVersionedResponse> {
    void _query;
    if (!user.organizationId)
      throw new ForbiddenException({
        code: "forbidden",
        message: "A current organization is required",
      });
    try {
      const snapshot = await this.health.read(user.organizationId, user.id);
      if ("schemaVersion" in _query && _query.schemaVersion === 2) {
        const backup = this.backups
          ? await this.backups.summary(user.organizationId, user.id)
          : {
              status: "unavailable" as const,
              lastAttempt: null,
              lastCapture: null,
              lastVerification: null,
              lastVerifiedRestoreAt: null,
              recoverablePointAt: null,
              verificationDueAt: null,
              residency: null,
              sourceAt: null,
              observedAt: new Date().toISOString(),
              reasons: ["authority_unavailable" as const],
            };
        return withBackupAssurance(snapshot, backup);
      }
      return snapshot;
    } catch (error) {
      if (
        error instanceof SystemHealthAuthorizationError ||
        error instanceof BackupAuthorizationError
      )
        throw new ForbiddenException({
          code: "forbidden",
          message: error.message,
        });
      throw error;
    }
  }
}
