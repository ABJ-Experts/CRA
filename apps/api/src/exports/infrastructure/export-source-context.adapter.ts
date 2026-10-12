import { Injectable } from "@nestjs/common";
import type {
  ExportInput,
  ExportSourceContextPort,
} from "../application/exports.port";
import type { RequestUser } from "../../auth/auth.types";
import { DashboardTrendsUseCases } from "../../dashboard/application/dashboard-trends-use-cases";
import { AuditExplorerUseCases } from "../../audit/application/audit-explorer.use-cases";
import {
  ExportAccessDeniedError,
  ExportConflictError,
  ExportUnavailableError,
  ExportInvalidRequestError,
} from "../domain/export.errors";
import { DashboardDatasetConflictError } from "../../dashboard/application/dashboard-trends.port";
import {
  DashboardForbiddenError,
  DashboardUnavailableError,
} from "../../dashboard/application/dashboard-read.port";
import {
  AuditExplorerForbiddenError,
  AuditExplorerStaleError,
} from "../../audit/audit-explorer.errors";
@Injectable()
export class ExportSourceContextAdapter implements ExportSourceContextPort {
  constructor(
    private readonly dashboard: DashboardTrendsUseCases,
    private readonly audit: AuditExplorerUseCases,
  ) {}
  async prepare(
    user: RequestUser,
    input: ExportInput,
  ): Promise<Readonly<Record<string, unknown>>> {
    try {
      if (input.source === "dashboard.trends") {
        if (!input.filters.datasetToken) throw new ExportInvalidRequestError();
        return await this.dashboard.exportCaptureContext(user, input.filters);
      }
      if (input.source === "audit.events") {
        const context = input.context as Readonly<Record<string, unknown>>;
        if (typeof context.snapshotToken !== "string")
          throw new ExportAccessDeniedError();
        return await this.audit.exportCaptureContext(
          user,
          context.snapshotToken,
          input.filters,
        );
      }
      return Object.freeze({});
    } catch (error) {
      if (error instanceof ExportInvalidRequestError) throw error;
      if (
        error instanceof ExportAccessDeniedError ||
        error instanceof AuditExplorerForbiddenError ||
        error instanceof DashboardForbiddenError
      )
        throw new ExportAccessDeniedError();
      if (
        error instanceof DashboardDatasetConflictError ||
        error instanceof AuditExplorerStaleError
      )
        throw new ExportConflictError();
      if (error instanceof DashboardUnavailableError)
        throw new ExportUnavailableError();
      throw new ExportUnavailableError();
    }
  }
}
