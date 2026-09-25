import { randomUUID } from "node:crypto";

export const EVIDENCE_REPOSITORY = Symbol("EVIDENCE_REPOSITORY");

export type EvidenceState =
  "uploading" | "scan_pending" | "clean" | "quarantined" | "failed";

export type EvidenceReservation = Readonly<{
  documentId: string;
  versionId: string;
  objectKey: string;
  expiresAt: string;
  state: EvidenceState;
}>;

export interface EvidenceRepository {
  reserve(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      title: string;
      evidenceClass: string;
      ownerUserId: string;
      applicableProductIds: readonly string[];
      validFrom: string | null;
      validUntil: string | null;
      fileName: string;
      declaredByteSize: number;
      idempotencyKey: string;
      correlationId: string;
    }>,
  ): Promise<
    | Readonly<{
        outcome: "created" | "replayed";
        reservation: EvidenceReservation;
      }>
    | Readonly<{
        outcome:
          "not_found" | "conflict" | "idempotency_mismatch" | "invalid_request";
      }>
  >;
  reserveReplacement(
    organizationId: string,
    input: Parameters<EvidenceRepository["reserve"]>[1] &
      Readonly<{ documentId: string; expectedCurrentVersionId: string }>,
  ): ReturnType<EvidenceRepository["reserve"]>;
  finalize(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      versionId: string;
      idempotencyKey: string;
      sha256: string | null;
      byteSize: number | null;
      mediaType: string | null;
      failureCode: string | null;
      correlationId: string;
    }>,
  ): Promise<
    | Readonly<{
        outcome: "queued" | "failed" | "replayed";
        state: EvidenceState;
      }>
    | Readonly<{ outcome: "not_found" | "conflict" | "idempotency_mismatch" }>
  >;
  getUploadVersion(
    organizationId: string,
    input: Readonly<{ actorId: string; versionId: string }>,
  ): Promise<Readonly<{ objectKey: string; productId: string }> | null>;
  list(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      limit: number;
      cursor?: string;
      status?: EvidenceState;
      documentClass?: string;
      validity?:
        | "current"
        | "expiring_soon"
        | "expired"
        | "not_yet_valid"
        | "open_ended"
        | "missing";
    }>,
  ): Promise<unknown>;
  versions(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string; documentId: string }>,
  ): Promise<unknown>;
}

export interface EvidenceStoragePort {
  createSignedUpload(
    input: Readonly<{
      objectKey: string;
      contentType: string;
      byteSize: number;
    }>,
  ): Promise<Readonly<{ uploadUrl: string; expiresAt: string }>>;
  inspect(
    input: Readonly<{ objectKey: string; maximumByteSize: number }>,
  ): Promise<
    | Readonly<{
        outcome: "verified";
        sha256: string;
        byteSize: number;
        mediaType: string;
      }>
    | Readonly<{
        outcome: "missing" | "unavailable" | "rejected";
        code: string;
      }>
  >;
}

/** Coordinates a reservation with storage inspection. Business authorization is
 * transactionally enforced in the repository; browser claims are never trusted. */
export class EvidenceIntakeUseCases {
  constructor(
    private readonly repository: EvidenceRepository,
    private readonly storage: EvidenceStoragePort,
  ) {}

  async initialize(
    input: Parameters<EvidenceRepository["reserve"]>[1] &
      Readonly<{ organizationId: string }>,
  ) {
    const reserved = await this.repository.reserve(input.organizationId, input);
    if (reserved.outcome !== "created" && reserved.outcome !== "replayed")
      return reserved;
    const reservation = reserved.reservation;
    const upload = await this.storage.createSignedUpload({
      objectKey: reservation.objectKey,
      contentType: "application/octet-stream",
      byteSize: input.declaredByteSize,
    });
    return Object.freeze({ ...reserved, upload });
  }

  async initializeReplacement(
    input: Parameters<EvidenceRepository["reserveReplacement"]>[1] &
      Readonly<{ organizationId: string }>,
  ) {
    const reserved = await this.repository.reserveReplacement(
      input.organizationId,
      input,
    );
    if (reserved.outcome !== "created" && reserved.outcome !== "replayed")
      return reserved;
    const upload = await this.storage.createSignedUpload({
      objectKey: reserved.reservation.objectKey,
      contentType: "application/octet-stream",
      byteSize: input.declaredByteSize,
    });
    return Object.freeze({ ...reserved, upload });
  }

  async complete(
    input: Readonly<{
      organizationId: string;
      actorId: string;
      versionId: string;
      objectKey: string;
      idempotencyKey: string;
      correlationId?: string;
    }>,
  ) {
    const inspected = await this.storage.inspect({
      objectKey: input.objectKey,
      maximumByteSize: 50 * 1024 * 1024,
    });
    const finalized = await this.repository.finalize(input.organizationId, {
      actorId: input.actorId,
      versionId: input.versionId,
      idempotencyKey: input.idempotencyKey,
      sha256: inspected.outcome === "verified" ? inspected.sha256 : null,
      byteSize: inspected.outcome === "verified" ? inspected.byteSize : null,
      mediaType: inspected.outcome === "verified" ? inspected.mediaType : null,
      failureCode: inspected.outcome === "verified" ? null : inspected.code,
      correlationId: input.correlationId ?? randomUUID(),
    });
    return finalized;
  }
}
