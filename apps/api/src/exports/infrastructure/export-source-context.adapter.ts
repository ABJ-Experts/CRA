import { dashboardTrendFiltersSchema } from "@repo/contracts/dashboard/schemas";
import { auditSearchFiltersSchema } from "@repo/contracts/audit/schemas";
import { Injectable } from "@nestjs/common";
import type {
  ExportInput,
  ScheduledExportSourceInput,
  ScheduledExportSourceContextPort,
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
import { DashboardForbiddenError } from "../../dashboard/application/dashboard-read.port";
import {
  AuditExplorerForbiddenError,
  AuditExplorerStaleError,
} from "../../audit/audit-explorer.errors";
@Injectable()
export class ExportSourceContextAdapter
  implements ExportSourceContextPort, ScheduledExportSourceContextPort
{
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
      throw mapSourceError(error);
    }
  }
  async prepareScheduled(
    input: ScheduledExportSourceInput,
  ): Promise<Readonly<Record<string, unknown>>> {
    if (
      Object.keys(input.filters).some(
        (key) =>
          key.startsWith("_") ||
          ["datasetToken", "cursor", "page", "pageSize", "limit"].includes(key),
      ) ||
      Object.keys(input.context).some(
        (key) => key.startsWith("_") || key === "snapshotToken",
      )
    )
      throw new ExportInvalidRequestError();
    try {
      if (input.source === "dashboard.trends") {
        const filters = dashboardTrendFiltersSchema.safeParse(input.filters);
        if (!filters.success) throw new ExportInvalidRequestError();
        return await this.dashboard.exportBackgroundCaptureContext(
          input,
          filters.data,
        );
      }
      if (input.source === "audit.events") {
        const filters = auditSearchFiltersSchema.safeParse(input.filters);
        if (!filters.success) throw new ExportInvalidRequestError();
        return await this.audit.exportBackgroundCaptureContext(
          input,
          filters.data,
        );
      }
      return Object.freeze({});
    } catch (error) {
      throw mapSourceError(error);
    }
  }
}
function mapSourceError(error: unknown): Error {
  if (error instanceof ExportInvalidRequestError) return error;
  if (
    error instanceof ExportAccessDeniedError ||
    error instanceof AuditExplorerForbiddenError ||
    error instanceof DashboardForbiddenError
  )
    return new ExportAccessDeniedError();
  if (
    error instanceof DashboardDatasetConflictError ||
    error instanceof AuditExplorerStaleError
  )
    return new ExportConflictError();
  return new ExportUnavailableError();
}
