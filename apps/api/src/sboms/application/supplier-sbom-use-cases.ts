import { randomUUID } from "node:crypto";

import type { Result } from "../../common/domain/result";
import { failure, success } from "../../common/domain/result";
import type {
  SbomIntakeError,
  SbomJob,
  SbomReservation,
  SbomStoragePort,
} from "./sbom-intake-use-cases";

export const SUPPLIER_SBOM_REPOSITORY = Symbol("SUPPLIER_SBOM_REPOSITORY");

export type SupplierSubmissionState =
  | "pending"
  | "processing"
  | "validation_failed"
  | "awaiting_review"
  | "accepted"
  | "rejected"
  | "superseded";

export type SupplierSbomRequest = Readonly<{
  id: string;
  organizationId: string;
  productId: string;
  releaseId: string;
  allowedComponentRef: string;
  supplierDisplayName: string;
  state: "open" | "closed" | "revoked";
  createdAt: string;
  expiresAt: string;
  createdBy: string;
  closedAt: string | null;
}>;

export type SupplierSbomInvitation = Readonly<{
  id: string;
  requestId: string;
  tokenPrefix: string;
  state: "active" | "used" | "expired" | "revoked";
  expiresAt: string;
  createdAt: string;
  usedAt: string | null;
  revokedAt: string | null;
}>;

/** Intentionally excludes tenant and product information.  It is safe to return to M9. */
export type SupplierSbomSession = Readonly<{
  sessionToken: string;
  expiresAt: string;
  requestReference: string;
  allowedComponentRef: string;
}>;

export type SupplierSbomSubmission = Readonly<{
  id: string;
  requestId: string;
  sourceId: string | null;
  state: SupplierSubmissionState;
  fileName: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
  validationMessage: string | null;
  reviewReason: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  supersededBySubmissionId: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type SupplierSbomRequestSummary = Readonly<{
  request: SupplierSbomRequest;
  invitations: readonly SupplierSbomInvitation[];
  submissions: readonly SupplierSbomSubmission[];
}>;

type SupplierUploadReservation = Readonly<{
  objectKey: string;
  sha256: string;
  byteSize: number;
  mediaType: string;
}>;

export interface SupplierSbomRepository {
  listRequests(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId?: string;
      releaseId?: string;
      state?: SupplierSbomRequest["state"];
      limit: number;
      cursor?: string;
    }>,
  ): Promise<
    | Readonly<{
        outcome: "found";
        requests: readonly SupplierSbomRequestSummary[];
        nextCursor: string | null;
      }>
    | Readonly<{ outcome: "not_found" }>
  >;
  createRequest(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      releaseId: string;
      allowedComponentRef: string;
      supplierDisplayName: string;
      expiresAt: string;
      idempotencyKey: string;
    }>,
  ): Promise<
    | Readonly<{
        outcome: "created" | "replayed";
        request: SupplierSbomRequest;
      }>
    | Readonly<{
        outcome:
          "not_found" | "conflict" | "idempotency_mismatch" | "invalid_request";
      }>
  >;
  createInvitation(
    organizationId: string,
    input: Readonly<{
      requestId: string;
      actorId: string;
      expiresAt: string;
      idempotencyKey: string;
    }>,
  ): Promise<
    | Readonly<{
        outcome: "created" | "replayed";
        invitation: SupplierSbomInvitation;
        invitationToken: string | null;
      }>
    | Readonly<{
        outcome:
          "not_found" | "conflict" | "idempotency_mismatch" | "invalid_request";
      }>
  >;
  exchangeInvitation(
    input: Readonly<{
      invitationToken: string;
      sessionToken: string;
      correlationId: string;
    }>,
  ): Promise<
    | Readonly<{
        outcome: "created" | "replayed";
        session: SupplierSbomSession;
      }>
    | Readonly<{ outcome: "not_found" | "conflict" | "idempotency_mismatch" }>
  >;
  reserveUpload(
    input: Readonly<{
      sessionToken: string;
      filename: string;
      byteSize: number;
      mediaType: string;
      sha256: string;
      idempotencyKey: string;
      correlationId: string;
      declaredFormat?: "cyclonedx" | "spdx";
      declaredSpecVersion?: string;
    }>,
  ): Promise<
    | Readonly<{
        outcome: "created" | "replayed";
        reservation: SbomReservation;
        submission: SupplierSbomSubmission;
      }>
    | Readonly<{
        outcome:
          "not_found" | "conflict" | "idempotency_mismatch" | "invalid_request";
      }>
  >;
  getUploadForCompletion(
    input: Readonly<{
      sessionToken: string;
      sourceId: string;
      idempotencyKey: string;
    }>,
  ): Promise<
    | Readonly<{
        outcome: "ready" | "replayed";
        reservation: SupplierUploadReservation;
      }>
    | Readonly<{ outcome: "not_found" | "conflict" }>
  >;
  completeUpload(
    input: Readonly<{
      sessionToken: string;
      sourceId: string;
      idempotencyKey: string;
      actualHash: string;
      actualByteSize: number;
      actualMediaType: string;
      correlationId: string;
    }>,
  ): Promise<
    | Readonly<{
        outcome: "queued" | "replayed" | "deduplicated";
        job: SbomJob;
        submission: SupplierSbomSubmission;
      }>
    | Readonly<{ outcome: "not_found" | "conflict" | "idempotency_mismatch" }>
  >;
  reviewSubmission(
    organizationId: string,
    input: Readonly<{
      submissionId: string;
      actorId: string;
      decision: "accepted" | "rejected";
      reason: string;
      idempotencyKey: string;
    }>,
  ): Promise<
    | Readonly<{
        outcome: "accepted" | "rejected" | "replayed";
        submission: SupplierSbomSubmission;
      }>
    | Readonly<{
        outcome:
          "not_found" | "conflict" | "idempotency_mismatch" | "invalid_request";
      }>
  >;
}

/**
 * The M9-facing path deliberately uses only an opaque session.  The database
 * owns token hashing, request/component binding and atomic one-time exchange;
 * this application service never invents a member actor for a supplier.
 */
export class SupplierSbomUseCases {
  constructor(
    private readonly repository: SupplierSbomRepository,
    private readonly storage: SbomStoragePort,
  ) {}

  async createRequest(
    command: Parameters<SupplierSbomRepository["createRequest"]>[1] &
      Readonly<{ organizationId: string }>,
  ): Promise<Result<SupplierSbomRequest, SbomIntakeError>> {
    return this.internal(
      () => this.repository.createRequest(command.organizationId, command),
      (value) => ("request" in value ? value.request : null),
    );
  }

  async listRequests(
    command: Parameters<SupplierSbomRepository["listRequests"]>[1] &
      Readonly<{ organizationId: string }>,
  ): Promise<
    Result<
      Readonly<{
        requests: readonly SupplierSbomRequestSummary[];
        nextCursor: string | null;
      }>,
      SbomIntakeError
    >
  > {
    try {
      const listed = await this.repository.listRequests(
        command.organizationId,
        command,
      );
      return listed.outcome === "found"
        ? success(
            Object.freeze({
              requests: listed.requests,
              nextCursor: listed.nextCursor,
            }),
          )
        : failure({ code: "not_found" });
    } catch {
      return failure({ code: "unavailable" });
    }
  }

  async createInvitation(
    command: Parameters<SupplierSbomRepository["createInvitation"]>[1] &
      Readonly<{ organizationId: string }>,
  ): Promise<
    Result<
      Readonly<{ invitation: SupplierSbomInvitation; invitationToken: string }>,
      SbomIntakeError
    >
  > {
    return this.internal(
      () => this.repository.createInvitation(command.organizationId, command),
      (value) =>
        "invitation" in value && value.invitationToken
          ? Object.freeze({
              invitation: value.invitation,
              invitationToken: value.invitationToken,
            })
          : null,
    );
  }

  async exchangeInvitation(
    command: Readonly<{ invitationToken: string; sessionToken: string }>,
  ): Promise<Result<SupplierSbomSession, SbomIntakeError>> {
    return this.internal(
      () =>
        this.repository.exchangeInvitation({
          ...command,
          correlationId: randomUUID(),
        }),
      (value) => ("session" in value ? value.session : null),
    );
  }

  async initializeUpload(
    command: Parameters<SupplierSbomRepository["reserveUpload"]>[0],
  ): Promise<
    Result<
      Readonly<{
        reservation: SbomReservation;
        submission: SupplierSbomSubmission;
        upload: Readonly<{ uploadUrl: string; expiresAt: string }>;
        replayed: boolean;
      }>,
      SbomIntakeError
    >
  > {
    try {
      const reserved = await this.repository.reserveUpload(command);
      if (!("reservation" in reserved))
        return failure({ code: reserved.outcome });
      const upload = await this.storage.createSignedUpload({
        objectKey: reserved.reservation.objectKey,
        contentType: reserved.reservation.mediaType,
        byteSize: reserved.reservation.byteSize,
      });
      return success(
        Object.freeze({
          reservation: reserved.reservation,
          submission: reserved.submission,
          upload,
          replayed: reserved.outcome === "replayed",
        }),
      );
    } catch {
      return failure({ code: "unavailable" });
    }
  }

  async completeUpload(
    command: Omit<
      Parameters<SupplierSbomRepository["completeUpload"]>[0],
      "actualHash" | "actualByteSize" | "actualMediaType" | "correlationId"
    >,
  ): Promise<
    Result<
      Readonly<{
        job: SbomJob;
        submission: SupplierSbomSubmission;
        outcome: "queued" | "replayed" | "deduplicated";
      }>,
      SbomIntakeError
    >
  > {
    try {
      const authorized = await this.repository.getUploadForCompletion(command);
      if (!("reservation" in authorized))
        return failure({ code: authorized.outcome });
      const inspection = await this.storage.inspect({
        objectKey: authorized.reservation.objectKey,
        sha256: authorized.reservation.sha256,
        byteSize: authorized.reservation.byteSize,
        contentType: authorized.reservation.mediaType,
      });
      if (inspection.outcome !== "verified") {
        return failure({
          code:
            inspection.outcome === "unavailable"
              ? "unavailable"
              : inspection.outcome === "missing"
                ? "source_missing"
                : "content_hash_mismatch",
        });
      }
      const completed = await this.repository.completeUpload({
        ...command,
        actualHash: inspection.sha256,
        actualByteSize: inspection.byteSize,
        actualMediaType: inspection.contentType,
        correlationId: randomUUID(),
      });
      if (!("job" in completed)) return failure({ code: completed.outcome });
      return success(
        Object.freeze({
          job: completed.job,
          submission: completed.submission,
          outcome: completed.outcome,
        }),
      );
    } catch {
      return failure({ code: "unavailable" });
    }
  }

  async reviewSubmission(
    command: Parameters<SupplierSbomRepository["reviewSubmission"]>[1] &
      Readonly<{ organizationId: string }>,
  ): Promise<Result<SupplierSbomSubmission, SbomIntakeError>> {
    return this.internal(
      () => this.repository.reviewSubmission(command.organizationId, command),
      (value) => ("submission" in value ? value.submission : null),
    );
  }

  private async internal<T extends Readonly<{ outcome: string }>, V>(
    pending: () => Promise<T>,
    pick: (value: T) => V | null,
  ): Promise<Result<V, SbomIntakeError>> {
    try {
      const value = await pending();
      const result = pick(value);
      if (result !== null) return success(result);
      return failure({ code: supplierOutcomeError(value.outcome) });
    } catch {
      return failure({ code: "unavailable" });
    }
  }
}

function supplierOutcomeError(outcome: string): SbomIntakeError["code"] {
  if (outcome === "not_found") return "not_found";
  if (outcome === "invalid_request") return "invalid_request";
  if (outcome === "idempotency_mismatch") return "idempotency_mismatch";
  return "conflict";
}
