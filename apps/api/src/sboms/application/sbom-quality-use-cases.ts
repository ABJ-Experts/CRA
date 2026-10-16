import type {
  SbomQualityFindingsQuery,
  SbomQualityFindingsResponse,
  SbomQualityReportResponse,
  SbomQualitySettingsResponse,
  UpdateSbomQualitySettingsInput,
} from "@repo/contracts/sboms";

import { failure, success, type Result } from "../../common/domain/result";
import type { SbomIntakeError } from "./sbom-intake-use-cases";

export const SBOM_QUALITY_REPOSITORY = Symbol("SBOM_QUALITY_REPOSITORY");

/** Inward port for source-scoped, reproducible SBOM quality projections. */
export interface SbomQualityRepository {
  getQualityReport(
    organizationId: string,
    input: Readonly<{ actorId: string; sourceId: string }>,
  ): Promise<SbomQualityReportResponse | null>;
  listQualityFindings(
    organizationId: string,
    input: Readonly<
      { actorId: string; sourceId: string } & SbomQualityFindingsQuery
    >,
  ): Promise<SbomQualityFindingsResponse | null>;
  getQualitySettings(
    organizationId: string,
    input: Readonly<{ actorId: string }>,
  ): Promise<SbomQualitySettingsResponse | null>;
  updateQualitySettings(
    organizationId: string,
    input: Readonly<{ actorId: string } & UpdateSbomQualitySettingsInput>,
  ): Promise<
    | Readonly<{ outcome: "updated"; response: SbomQualitySettingsResponse }>
    | Readonly<{ outcome: "not_found" | "conflict" }>
  >;
}

/** Framework-free tenant-first quality query layer. */
export class SbomQualityUseCases {
  constructor(private readonly repository: SbomQualityRepository) {}

  async report(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      sourceId: string;
    }>,
  ): Promise<Result<SbomQualityReportResponse, SbomIntakeError>> {
    return this.read(() =>
      this.repository.getQualityReport(command.organizationId, {
        actorId: command.actorId,
        sourceId: command.sourceId,
      }),
    );
  }

  async findings(
    command: Readonly<
      {
        organizationId: string;
        actorId: string;
        sourceId: string;
      } & SbomQualityFindingsQuery
    >,
  ): Promise<Result<SbomQualityFindingsResponse, SbomIntakeError>> {
    return this.read(() =>
      this.repository.listQualityFindings(command.organizationId, {
        actorId: command.actorId,
        sourceId: command.sourceId,
        limit: command.limit,
        cursor: command.cursor,
        severity: command.severity,
        kind: command.kind,
      }),
    );
  }

  async settings(
    command: Readonly<{
      organizationId: string;
      actorId: string;
    }>,
  ): Promise<Result<SbomQualitySettingsResponse, SbomIntakeError>> {
    return this.read(() =>
      this.repository.getQualitySettings(command.organizationId, {
        actorId: command.actorId,
      }),
    );
  }

  async updateSettings(
    command: Readonly<
      {
        organizationId: string;
        actorId: string;
      } & UpdateSbomQualitySettingsInput
    >,
  ): Promise<Result<SbomQualitySettingsResponse, SbomIntakeError>> {
    try {
      const result = await this.repository.updateQualitySettings(
        command.organizationId,
        {
          actorId: command.actorId,
          expectedVersion: command.expectedVersion,
          bsiProfileEnabled: command.bsiProfileEnabled,
          idempotencyKey: command.idempotencyKey,
        },
      );
      return result.outcome === "updated"
        ? success(result.response)
        : failure({
            code: result.outcome === "not_found" ? "not_found" : "conflict",
          });
    } catch {
      return failure({ code: "unavailable" });
    }
  }

  private async read<T>(
    operation: () => Promise<T | null>,
  ): Promise<Result<T, SbomIntakeError>> {
    try {
      const value = await operation();
      return value ? success(value) : failure({ code: "not_found" });
    } catch {
      return failure({ code: "unavailable" });
    }
  }
}
