import type { Result } from "../../common/domain/result";
import { randomUUID } from "node:crypto";
import { failure, success } from "../../common/domain/result";

export const SBOM_INTAKE_REPOSITORY = Symbol("SBOM_INTAKE_REPOSITORY");

export type SbomSourceKind =
  "manual_upload" | "ci_upload" | "integration" | "supplier" | "generated";

export type SbomJobStatus =
  "queued" | "processing" | "failed" | "completed" | "dead_letter";

export type SbomReservation = Readonly<{
  id: string;
  organizationId: string;
  productId: string;
  releaseId: string;
  source: SbomSourceKind;
  objectKey: string;
  filename: string;
  byteSize: number;
  mediaType: string;
  sha256: string;
  expiresAt: string;
  status: "upload_pending" | "verified" | "rejected" | "expired";
  createdAt: string;
  completedAt: string | null;
}>;

export type SbomJob = Readonly<{
  id: string;
  organizationId: string;
  releaseId: string;
  sourceId: string;
  inputSha256: string;
  correlationId: string;
  status: SbomJobStatus;
  progress: Readonly<{ stage: string; percent: number; message: string }>;
  attempts: number;
  maxAttempts: 5;
  error: Readonly<{ code: string; message: string; retryable: boolean }> | null;
  result: Readonly<{
    outcome: "original_evidence_captured";
    sourceId: string;
    sha256: string;
  }> | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}>;

export type SbomSource = SbomReservation &
  Readonly<{
    releaseId: string;
    status: "upload_pending" | "verified" | "rejected" | "expired";
  }>;

export type SbomIntakeError = Readonly<{
  code:
    | "invalid_request"
    | "not_found"
    | "conflict"
    | "idempotency_mismatch"
    | "content_hash_mismatch"
    | "source_missing"
    | "unavailable";
}>;

export interface SbomIntakeRepository {
  reserve(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      releaseId: string;
      filename: string;
      byteSize: number;
      mediaType: string;
      sha256: string;
      source: SbomSourceKind;
      idempotencyKey: string;
      correlationId: string;
      ciCredentialId?: string;
    }>,
  ): Promise<
    | Readonly<{
        outcome: "created" | "replayed";
        reservation: SbomReservation;
      }>
    | Readonly<{
        outcome:
          "not_found" | "conflict" | "idempotency_mismatch" | "invalid_request";
      }>
  >;
  getSource(
    organizationId: string,
    sourceId: string,
  ): Promise<SbomSource | null>;
  getSourceForCompletion(
    organizationId: string,
    input: Readonly<{
      sourceId: string;
      actorId: string;
      idempotencyKey: string;
      ciCredentialId?: string;
    }>,
  ): Promise<
    | Readonly<{ outcome: "ready" | "replayed"; source: SbomSource }>
    | Readonly<{ outcome: "not_found" | "invalid_request" }>
  >;
  getDownloadSource(
    organizationId: string,
    actorId: string,
    sourceId: string,
    correlationId: string,
  ): Promise<SbomSource | null>;
  complete(
    organizationId: string,
    input: Readonly<{
      sourceId: string;
      actorId: string;
      idempotencyKey: string;
      actualHash: string;
      actualByteSize: number;
      actualMediaType: string;
      correlationId: string;
      ciCredentialId?: string;
    }>,
  ): Promise<
    | Readonly<{ outcome: "queued" | "replayed"; job: SbomJob }>
    | Readonly<{ outcome: "not_found" | "conflict" | "idempotency_mismatch" }>
  >;
  rejectIntegrity(
    organizationId: string,
    input: Readonly<{
      sourceId: string;
      actorId: string;
      idempotencyKey: string;
      code: "content_hash_mismatch" | "source_missing";
      actualHash: string | null;
      actualByteSize: number | null;
      actualMediaType: string | null;
      ciCredentialId?: string;
      correlationId: string;
    }>,
  ): Promise<
    | Readonly<{ outcome: "rejected" | "replayed" }>
    | Readonly<{
        outcome:
          | "not_found"
          | "invalid_request"
          | "idempotency_mismatch"
          | "invalid_state";
      }>
  >;
  getJob(
    organizationId: string,
    actorId: string,
    jobId: string,
  ): Promise<SbomJob | null>;
  replay(
    organizationId: string,
    input: Readonly<{ jobId: string; actorId: string; idempotencyKey: string }>,
  ): Promise<
    Readonly<{
      outcome: "queued" | "replayed" | "not_found" | "conflict";
      job?: SbomJob;
    }>
  >;
}

export interface SbomStoragePort {
  createSignedUpload(
    input: Readonly<{
      objectKey: string;
      contentType: string;
      byteSize: number;
    }>,
  ): Promise<Readonly<{ uploadUrl: string; expiresAt: string }>>;
  inspect(
    input: Readonly<{
      objectKey: string;
      sha256: string;
      byteSize: number;
      contentType: string;
    }>,
  ): Promise<
    | Readonly<{
        outcome: "verified";
        sha256: string;
        byteSize: number;
        contentType: string;
      }>
    | Readonly<{ outcome: "missing" | "unavailable" }>
    | Readonly<{
        outcome: "hash_mismatch" | "type_mismatch" | "corrupt";
        sha256: string;
        byteSize: number;
        contentType: string | null;
      }>
  >;
  createSignedDownload(
    input: Readonly<{
      objectKey: string;
      fileName: string;
      contentType: string;
    }>,
  ): Promise<
    Readonly<{
      downloadUrl: string;
      expiresAt: string;
      fileName: string;
      contentType: string;
    }>
  >;
}

export class SbomIntakeUseCases {
  constructor(
    private readonly repository: SbomIntakeRepository,
    private readonly storage: SbomStoragePort,
  ) {}

  async initialize(
    command: Parameters<SbomIntakeRepository["reserve"]>[1] &
      Readonly<{ organizationId: string }>,
  ): Promise<
    Result<
      Readonly<{
        reservation: SbomReservation;
        upload: Readonly<{ uploadUrl: string; expiresAt: string }>;
        replayed: boolean;
      }>,
      SbomIntakeError
    >
  > {
    try {
      const reserved = await this.repository.reserve(
        command.organizationId,
        command,
      );
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
          upload,
          replayed: reserved.outcome === "replayed",
        }),
      );
    } catch {
      return failure({ code: "unavailable" });
    }
  }

  async complete(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      sourceId: string;
      idempotencyKey: string;
      correlationId: string;
      ciCredentialId?: string;
    }>,
  ): Promise<
    Result<Readonly<{ job: SbomJob; replayed: boolean }>, SbomIntakeError>
  > {
    try {
      const authorized = await this.repository.getSourceForCompletion(
        command.organizationId,
        command,
      );
      if (authorized.outcome === "not_found") {
        return failure({ code: "not_found" });
      }
      if (authorized.outcome === "invalid_request") {
        return failure({ code: "conflict" });
      }
      if (authorized.outcome === "replayed") {
        const completed = await this.repository.complete(
          command.organizationId,
          {
            ...command,
            actualHash: authorized.source.sha256,
            actualByteSize: authorized.source.byteSize,
            actualMediaType: authorized.source.mediaType,
          },
        );
        if (!("job" in completed)) return failure({ code: completed.outcome });
        return success(Object.freeze({ job: completed.job, replayed: true }));
      }
      if (authorized.outcome !== "ready") {
        return failure({ code: "unavailable" });
      }
      const source = authorized.source;
      const inspection = await this.storage.inspect({
        objectKey: source.objectKey,
        sha256: source.sha256,
        byteSize: source.byteSize,
        contentType: source.mediaType,
      });
      if (inspection.outcome !== "verified") {
        if (inspection.outcome !== "unavailable") {
          const rejected = await this.repository.rejectIntegrity(
            command.organizationId,
            {
              sourceId: command.sourceId,
              actorId: command.actorId,
              idempotencyKey: command.idempotencyKey,
              code:
                inspection.outcome === "missing"
                  ? "source_missing"
                  : "content_hash_mismatch",
              actualHash: "sha256" in inspection ? inspection.sha256 : null,
              actualByteSize:
                "byteSize" in inspection ? inspection.byteSize : null,
              actualMediaType:
                "contentType" in inspection ? inspection.contentType : null,
              ciCredentialId: command.ciCredentialId,
              correlationId: command.correlationId,
            },
          );
          if (
            rejected.outcome !== "rejected" &&
            rejected.outcome !== "replayed"
          ) {
            return failure({
              code: rejected.outcome === "not_found" ? "not_found" : "conflict",
            });
          }
          return failure({
            code:
              inspection.outcome === "missing"
                ? "source_missing"
                : "content_hash_mismatch",
          });
        }
        return failure({ code: "unavailable" });
      }
      const completed = await this.repository.complete(command.organizationId, {
        ...command,
        actualHash: inspection.sha256,
        actualByteSize: inspection.byteSize,
        actualMediaType: inspection.contentType,
      });
      if (!("job" in completed)) return failure({ code: completed.outcome });
      return success(
        Object.freeze({
          job: completed.job,
          replayed: completed.outcome === "replayed",
        }),
      );
    } catch {
      return failure({ code: "unavailable" });
    }
  }

  async job(
    organizationId: string,
    actorId: string,
    jobId: string,
  ): Promise<Result<SbomJob, SbomIntakeError>> {
    try {
      const job = await this.repository.getJob(organizationId, actorId, jobId);
      return job ? success(job) : failure({ code: "not_found" });
    } catch {
      return failure({ code: "unavailable" });
    }
  }

  async download(
    organizationId: string,
    _actorId: string,
    sourceId: string,
  ): Promise<
    Result<
      Readonly<{
        downloadUrl: string;
        expiresAt: string;
        fileName: string;
        contentType: string;
      }>,
      SbomIntakeError
    >
  > {
    try {
      const source = await this.repository.getDownloadSource(
        organizationId,
        _actorId,
        sourceId,
        randomUUID(),
      );
      if (!source || source.status !== "verified")
        return failure({ code: "not_found" });
      return success(
        await this.storage.createSignedDownload({
          objectKey: source.objectKey,
          fileName: source.filename,
          contentType: source.mediaType,
        }),
      );
    } catch {
      return failure({ code: "unavailable" });
    }
  }

  async replay(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      jobId: string;
      idempotencyKey: string;
    }>,
  ): Promise<Result<SbomJob, SbomIntakeError>> {
    try {
      const replayed = await this.repository.replay(
        command.organizationId,
        command,
      );
      if (!replayed.job) {
        return failure({
          code: replayed.outcome === "not_found" ? "not_found" : "conflict",
        });
      }
      return success(replayed.job);
    } catch {
      return failure({ code: "unavailable" });
    }
  }
}
