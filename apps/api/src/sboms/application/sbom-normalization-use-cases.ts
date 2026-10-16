import type {
  SbomComponentSearchResponse,
  SbomDependencyTreeResponse,
  SbomDocumentDetailResponse,
  SbomDocumentListResponse,
} from "@repo/contracts/sboms";

import { failure, success, type Result } from "../../common/domain/result";
import type { SbomIntakeError } from "./sbom-intake-use-cases";

export const SBOM_NORMALIZATION_REPOSITORY = Symbol(
  "SBOM_NORMALIZATION_REPOSITORY",
);

/** Inward port for completed, tenant-scoped SBOM graph projections. */
export interface SbomNormalizationRepository {
  listDocuments(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      releaseId: string;
      limit: number;
      cursor?: string;
    }>,
  ): Promise<SbomDocumentListResponse | null>;
  getDocument(
    organizationId: string,
    input: Readonly<{ actorId: string; documentId: string }>,
  ): Promise<SbomDocumentDetailResponse | null>;
  searchComponents(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      documentId: string;
      q?: string;
      limit: number;
      cursor?: string;
    }>,
  ): Promise<SbomComponentSearchResponse | null>;
  listDependencyTree(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      documentId: string;
      parentComponentId?: string;
      q?: string;
      limit: number;
      cursor?: string;
    }>,
  ): Promise<SbomDependencyTreeResponse | null>;
}

/** Framework-free, tenant-first query layer. Controllers never see provider rows. */
export class SbomNormalizationUseCases {
  constructor(private readonly repository: SbomNormalizationRepository) {}

  async listDocuments(
    command: Parameters<SbomNormalizationRepository["listDocuments"]>[1] &
      Readonly<{ organizationId: string }>,
  ): Promise<Result<SbomDocumentListResponse, SbomIntakeError>> {
    return this.read(() =>
      this.repository.listDocuments(command.organizationId, {
        actorId: command.actorId,
        productId: command.productId,
        releaseId: command.releaseId,
        limit: command.limit,
        cursor: command.cursor,
      }),
    );
  }

  async document(
    command: Parameters<SbomNormalizationRepository["getDocument"]>[1] &
      Readonly<{ organizationId: string }>,
  ): Promise<Result<SbomDocumentDetailResponse, SbomIntakeError>> {
    return this.read(() =>
      this.repository.getDocument(command.organizationId, command),
    );
  }

  async searchComponents(
    command: Parameters<SbomNormalizationRepository["searchComponents"]>[1] &
      Readonly<{ organizationId: string }>,
  ): Promise<Result<SbomComponentSearchResponse, SbomIntakeError>> {
    return this.read(() =>
      this.repository.searchComponents(command.organizationId, command),
    );
  }

  async dependencyTree(
    command: Parameters<SbomNormalizationRepository["listDependencyTree"]>[1] &
      Readonly<{ organizationId: string }>,
  ): Promise<Result<SbomDependencyTreeResponse, SbomIntakeError>> {
    return this.read(() =>
      this.repository.listDependencyTree(command.organizationId, command),
    );
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
