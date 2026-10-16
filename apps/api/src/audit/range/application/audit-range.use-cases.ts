import type {
  AuditRangeCreateInput,
  AuditRangeOperationInput,
} from "@repo/contracts/audit/types";
import type { RequestUser } from "../../../auth/auth.types";
import type { AuditExplorerRepository } from "../../application/audit-explorer.port";
import {
  AuditRangeForbiddenError,
  AuditRangeUnavailableError,
} from "../audit-range.errors";
import type { AuditRangeRepository } from "./audit-range.port";

export class AuditRangeUseCases {
  constructor(
    private readonly repository: AuditRangeRepository,
    private readonly permissions: Pick<
      AuditExplorerRepository,
      "effectivePermissions"
    >,
  ) {}
  async create(user: RequestUser, input: AuditRangeCreateInput) {
    const orgId = await this.authorize(user);
    return this.repository.create(orgId, user.id, input);
  }
  async status(user: RequestUser, jobId: string, requestId: string) {
    const orgId = await this.authorize(user);
    return this.repository.status(orgId, user.id, jobId, requestId);
  }
  async cancel(
    user: RequestUser,
    jobId: string,
    input: AuditRangeOperationInput,
  ) {
    const orgId = await this.authorize(user);
    return this.repository.cancel(orgId, user.id, jobId, input);
  }
  async resume(
    user: RequestUser,
    jobId: string,
    input: AuditRangeOperationInput,
  ) {
    const orgId = await this.authorize(user);
    return this.repository.resume(orgId, user.id, jobId, input);
  }
  private async authorize(user: RequestUser): Promise<string> {
    if (!user.isActive || !user.organizationId || !user.role)
      throw new AuditRangeForbiddenError();
    const current = await this.permissions
      .effectivePermissions(user.organizationId, user.id, user.role)
      .catch(() => {
        throw new AuditRangeUnavailableError();
      });
    if (!current.permissions.can_view_audit)
      throw new AuditRangeForbiddenError();
    return user.organizationId;
  }
}
