import type { z } from "zod";
import type {
  controlCommandResponseSchema,
  controlDetailResponseSchema,
  controlListQuerySchema,
  controlListResponseSchema,
  controlOwnerCandidatesQuerySchema,
  controlOwnerCandidatesResponseSchema,
  requirementCoverageQuerySchema,
  requirementCoverageResponseSchema,
  requirementApplicabilityResponseSchema,
} from "@repo/contracts/frameworks";

export const CONTROL_REPOSITORY = Symbol("CONTROL_REPOSITORY");

export class ControlConflictError extends Error {}
export class ControlForbiddenError extends Error {}
export class ControlInvalidRequestError extends Error {}
export class ControlBlockedError extends Error {}
export class ControlNotFoundError extends Error {}

type List = z.output<typeof controlListResponseSchema>;
type Detail = z.output<typeof controlDetailResponseSchema>;
type Coverage = z.output<typeof requirementCoverageResponseSchema>;
type Command = z.output<typeof controlCommandResponseSchema>;
type ListQuery = z.output<typeof controlListQuerySchema>;
type OwnerQuery = z.output<typeof controlOwnerCandidatesQuerySchema>;
type Owners = z.output<typeof controlOwnerCandidatesResponseSchema>;
type CoverageQuery = z.output<typeof requirementCoverageQuerySchema>;
type CoverageQueryInput = Omit<CoverageQuery, "filter"> & {
  filter?: CoverageQuery["filter"];
};
type Applicability = z.output<typeof requirementApplicabilityResponseSchema>;
export type ControlOperation =
  | "create_control"
  | "update_control"
  | "archive_control"
  | "link_evidence"
  | "unlink_evidence"
  | "upsert_mapping"
  | "end_mapping";

export interface ControlRepository {
  list(
    orgId: string,
    input: Readonly<{ actorId: string } & ListQuery>,
  ): Promise<List>;
  ownerCandidates(
    orgId: string,
    input: Readonly<{ actorId: string } & OwnerQuery>,
  ): Promise<Owners>;
  detail(
    orgId: string,
    input: Readonly<{
      actorId: string;
      controlId: string;
      canViewEvidence: boolean;
      canViewProducts: boolean;
    }>,
  ): Promise<Detail | null>;
  coverage(
    orgId: string,
    input: Readonly<
      {
        actorId: string;
        packKey: string;
        versionKey: string;
      } & CoverageQueryInput
    >,
  ): Promise<Coverage | null>;
  setApplicability(
    orgId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      packKey: string;
      versionKey: string;
      requirementKey: string;
      state: "applicable" | "not_applicable";
      reason?: string;
      expectedRevision: number;
      idempotencyKey: string;
    }>,
  ): Promise<Applicability>;
  command(
    orgId: string,
    input: Readonly<{
      actorId: string;
      operation: ControlOperation;
      payload: Record<string, unknown>;
      expectedRevision: number | null;
      idempotencyKey: string;
    }>,
  ): Promise<Command>;
}

export class ControlUseCases {
  constructor(private readonly repository: ControlRepository) {}

  list(
    orgId: string,
    input: Parameters<ControlRepository["list"]>[1],
  ): Promise<List> {
    return this.repository.list(orgId, input);
  }

  ownerCandidates(
    orgId: string,
    input: Parameters<ControlRepository["ownerCandidates"]>[1],
  ): Promise<Owners> {
    return this.repository.ownerCandidates(orgId, input);
  }

  detail(
    orgId: string,
    input: Parameters<ControlRepository["detail"]>[1],
  ): Promise<Detail | null> {
    return this.repository.detail(orgId, input);
  }

  coverage(
    orgId: string,
    input: Parameters<ControlRepository["coverage"]>[1],
  ): Promise<Coverage | null> {
    return this.repository.coverage(orgId, input);
  }

  setApplicability(
    orgId: string,
    input: Parameters<ControlRepository["setApplicability"]>[1],
  ): Promise<Applicability> {
    return this.repository.setApplicability(orgId, input);
  }

  command(
    orgId: string,
    input: Parameters<ControlRepository["command"]>[1],
  ): Promise<Command> {
    return this.repository.command(orgId, input);
  }
}
