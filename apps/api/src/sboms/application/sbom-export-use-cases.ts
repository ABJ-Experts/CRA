import type {
  SbomExportQuery,
  SbomExportResponse,
} from "@repo/contracts/sboms";
import type { VexAssessmentExportRecord } from "../../findings/exports/vex-export-generator";
import { failure, success, type Result } from "../../common/domain/result";
import {
  serializeSbomExport,
  SbomExportConflict,
  type SbomExportGraph,
} from "./sbom-export-serializer";
export const SBOM_EXPORT_REPOSITORY = Symbol("SBOM_EXPORT_REPOSITORY");
export type SbomExportCommand = Readonly<
  {
    organizationId: string;
    actorId: string;
    documentId: string;
  } & SbomExportQuery
>;
export interface SbomExportRepository {
  graph(
    orgId: string,
    input: Readonly<{ actorId: string; documentId: string; sourceId: string }>,
  ): Promise<SbomExportGraph | null>;
  reviewedVex(
    orgId: string,
    input: Readonly<{ actorId: string; productId: string; releaseId: string }>,
  ): Promise<readonly VexAssessmentExportRecord[] | null>;
}
export class SbomExportUseCases {
  constructor(private readonly repository: SbomExportRepository) {}
  async export(command: SbomExportCommand): Promise<
    Result<
      SbomExportResponse,
      Readonly<{
        code: "not_found" | "conflict" | "unavailable";
        message?: string;
      }>
    >
  > {
    try {
      const graph = await this.repository.graph(
        command.organizationId,
        command,
      );
      if (!graph) return failure({ code: "not_found" });
      const assessments = command.includeVex
        ? await this.repository.reviewedVex(command.organizationId, {
            actorId: command.actorId,
            productId: graph.productId,
            releaseId: graph.releaseId,
          })
        : [];
      if (assessments === null) return failure({ code: "not_found" });
      return success(await serializeSbomExport(graph, command, assessments));
    } catch (error) {
      return failure(
        error instanceof SbomExportConflict
          ? { code: "conflict", message: error.message }
          : { code: "unavailable" },
      );
    }
  }
}
