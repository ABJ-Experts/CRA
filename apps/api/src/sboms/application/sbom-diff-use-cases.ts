import type {
  CreateSbomDiffInput,
  RetrySbomDiffInput,
  SbomDiffComponentsQuery,
  SbomDiffComponentsResponse,
  SbomDiffFindingsQuery,
  SbomDiffFindingsResponse,
  SbomDiffReportResponse,
  SbomDiffStartResponse,
  SbomSourceDiffResponse,
} from "@repo/contracts/sboms";

import { failure, success, type Result } from "../../common/domain/result";
import type { SbomIntakeError } from "./sbom-intake-use-cases";

export const SBOM_DIFF_REPOSITORY = Symbol("SBOM_DIFF_REPOSITORY");

/** Inward port for source-lineage comparisons and their immutable projections. */
export interface SbomDiffRepository {
  createDiff(
    organizationId: string,
    input: Readonly<
      { actorId: string; sourceId: string } & CreateSbomDiffInput
    >,
  ): Promise<
    | Readonly<{
        outcome: "created" | "replayed";
        response: SbomDiffStartResponse;
      }>
    | Readonly<{
        outcome:
          | "not_found"
          | "conflict"
          | "invalid_request"
          | "no_comparable_version";
      }>
  >;
  getSourceDiff(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      sourceId: string;
      baseSourceId?: string;
    }>,
  ): Promise<SbomSourceDiffResponse | null>;
  getDiff(
    organizationId: string,
    input: Readonly<{ actorId: string; diffId: string }>,
  ): Promise<SbomDiffReportResponse | null>;
  listComponentChanges(
    organizationId: string,
    input: Readonly<
      { actorId: string; diffId: string } & SbomDiffComponentsQuery
    >,
  ): Promise<SbomDiffComponentsResponse | null>;
  getFindingDelta(
    organizationId: string,
    input: Readonly<
      { actorId: string; diffId: string } & SbomDiffFindingsQuery
    >,
  ): Promise<SbomDiffFindingsResponse | null>;
  retryDiff(
    organizationId: string,
    input: Readonly<{ actorId: string; diffId: string } & RetrySbomDiffInput>,
  ): Promise<
    | Readonly<{
        outcome: "queued" | "replayed";
        response: SbomDiffStartResponse;
      }>
    | Readonly<{ outcome: "not_found" | "conflict" }>
  >;
}

/** Framework-free source-scoped diff commands; all provider data remains in the adapter. */
export class SbomDiffUseCases {
  constructor(private readonly repository: SbomDiffRepository) {}

  async create(
    command: Readonly<
      {
        organizationId: string;
        actorId: string;
        sourceId: string;
      } & CreateSbomDiffInput
    >,
  ): Promise<Result<SbomDiffStartResponse, SbomIntakeError>> {
    try {
      const result = await this.repository.createDiff(command.organizationId, {
        actorId: command.actorId,
        sourceId: command.sourceId,
        baseSourceId: command.baseSourceId,
        idempotencyKey: command.idempotencyKey,
      });
      if (result.outcome === "no_comparable_version") {
        return success({
          status: "no_comparable_version",
          sourceId: command.sourceId,
          reason:
            "No completed, comparable predecessor exists in this release lineage.",
        });
      }
      if (result.outcome === "created" || result.outcome === "replayed") {
        if (result.response.status === "no_comparable_version") {
          return success(result.response);
        }
        return success(
          Object.freeze({
            ...result.response,
            replayed: result.outcome === "replayed" || result.response.replayed,
          }),
        );
      }
      return failure({
        code:
          result.outcome === "not_found"
            ? "not_found"
            : result.outcome === "invalid_request"
              ? "invalid_request"
              : "conflict",
      });
    } catch {
      return failure({ code: "unavailable" });
    }
  }

  async sourceDiff(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      sourceId: string;
      baseSourceId?: string;
    }>,
  ): Promise<Result<SbomSourceDiffResponse, SbomIntakeError>> {
    return this.read(() =>
      this.repository.getSourceDiff(command.organizationId, {
        actorId: command.actorId,
        sourceId: command.sourceId,
        baseSourceId: command.baseSourceId,
      }),
    );
  }

  async report(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      diffId: string;
    }>,
  ): Promise<Result<SbomDiffReportResponse, SbomIntakeError>> {
    return this.read(() =>
      this.repository.getDiff(command.organizationId, {
        actorId: command.actorId,
        diffId: command.diffId,
      }),
    );
  }

  async components(
    command: Readonly<
      {
        organizationId: string;
        actorId: string;
        diffId: string;
      } & SbomDiffComponentsQuery
    >,
  ): Promise<Result<SbomDiffComponentsResponse, SbomIntakeError>> {
    return this.read(() =>
      this.repository.listComponentChanges(command.organizationId, {
        actorId: command.actorId,
        diffId: command.diffId,
        limit: command.limit,
        cursor: command.cursor,
        change: command.change,
        ecosystem: command.ecosystem,
        q: command.q,
      }),
    );
  }

  async findings(
    command: Readonly<
      {
        organizationId: string;
        actorId: string;
        diffId: string;
      } & SbomDiffFindingsQuery
    >,
  ): Promise<Result<SbomDiffFindingsResponse, SbomIntakeError>> {
    return this.read(() =>
      this.repository.getFindingDelta(command.organizationId, {
        actorId: command.actorId,
        diffId: command.diffId,
        limit: command.limit,
        cursor: command.cursor,
      }),
    );
  }

  async retry(
    command: Readonly<
      {
        organizationId: string;
        actorId: string;
        diffId: string;
      } & RetrySbomDiffInput
    >,
  ): Promise<Result<SbomDiffStartResponse, SbomIntakeError>> {
    try {
      const result = await this.repository.retryDiff(command.organizationId, {
        actorId: command.actorId,
        diffId: command.diffId,
        idempotencyKey: command.idempotencyKey,
      });
      if (result.outcome === "queued" || result.outcome === "replayed") {
        if (result.response.status === "no_comparable_version") {
          return success(result.response);
        }
        return success(
          Object.freeze({
            ...result.response,
            replayed: result.outcome === "replayed" || result.response.replayed,
          }),
        );
      }
      return failure({
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
