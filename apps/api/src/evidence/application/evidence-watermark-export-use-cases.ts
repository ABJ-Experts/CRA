import { createHash, randomUUID } from "node:crypto";
import type { EvidenceWatermarkExport as ContractEvidenceWatermarkExport } from "@repo/contracts/evidence";

export const EVIDENCE_WATERMARK_EXPORT_REPOSITORY = Symbol(
  "EVIDENCE_WATERMARK_EXPORT_REPOSITORY",
);

export type EvidenceWatermarkExport = ContractEvidenceWatermarkExport;

export type EvidenceWatermarkExportClaim = Readonly<{
  export: EvidenceWatermarkExport;
  organizationId: string;
  objectKey: string;
  sourceByteSize: number;
  sourceMediaType: string;
}>;

export type EvidenceWatermarkExportAccess = Readonly<{
  token: string;
  expiresAt: string;
  fileName: string;
  mediaType: string;
}>;

export type EvidenceWatermarkExportDelivery = Readonly<{
  objectKey: string;
  sha256: string;
  byteSize: number;
  mediaType: string;
  fileName: string;
}>;

/**
 * This port represents only recipient-watermarked derivatives. Original
 * evidence access remains owned by EvidenceAccessUseCases.
 */
export interface EvidenceWatermarkExportRepository {
  createWatermarkExport(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      documentId: string;
      versionId: string;
      recipient: string;
      purpose: string;
      idempotencyKey: string;
    }>,
  ): Promise<
    | Readonly<{
        outcome: "queued" | "replayed";
        export: EvidenceWatermarkExport;
      }>
    | Readonly<{
        outcome:
          | "not_found"
          | "forbidden"
          | "not_clean"
          | "unsupported"
          | "lifecycle_blocked"
          | "idempotency_mismatch"
          | "conflict";
      }>
  >;
  getWatermarkExport(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      documentId: string;
      versionId: string;
      exportId: string;
    }>,
  ): Promise<EvidenceWatermarkExport | null>;
  createWatermarkPreviewAccess(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      exportId: string;
      idempotencyKey: string;
      requestDigest: string;
    }>,
  ): Promise<
    | Readonly<{ outcome: "ready"; access: EvidenceWatermarkExportAccess }>
    | Readonly<{
        outcome:
          | "not_found"
          | "forbidden"
          | "not_ready"
          | "idempotency_mismatch"
          | "conflict";
      }>
  >;
  createWatermarkDeliveryAccess(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      exportId: string;
      idempotencyKey: string;
      requestDigest: string;
    }>,
  ): Promise<
    | Readonly<{ outcome: "ready"; access: EvidenceWatermarkExportAccess }>
    | Readonly<{
        outcome:
          | "not_found"
          | "forbidden"
          | "not_ready"
          | "preview_required"
          | "idempotency_mismatch"
          | "conflict";
      }>
  >;
  redeemWatermarkDelivery(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      exportId: string;
      tokenDigest: string;
      delivery: boolean;
      correlationId: string;
    }>,
  ): Promise<
    | Readonly<{ outcome: "ready"; source: EvidenceWatermarkExportDelivery }>
    | Readonly<{
        outcome:
          "not_found" | "forbidden" | "not_ready" | "expired" | "conflict";
      }>
  >;
  claimWatermarkExport(
    input: Readonly<{ workerId: string; leaseSeconds: number }>,
  ): Promise<EvidenceWatermarkExportClaim | null>;
  finalizeWatermarkExport(
    organizationId: string,
    input: Readonly<{
      exportId: string;
      workerId: string;
      objectKey: string;
      sha256: string;
      byteSize: number;
      mediaType: string;
    }>,
  ): Promise<boolean>;
  failWatermarkExport(
    organizationId: string,
    input: Readonly<{
      exportId: string;
      workerId: string;
      failureCode: string;
    }>,
  ): Promise<boolean>;
  isWatermarkExportDurablyFailed(
    organizationId: string,
    input: Readonly<{ exportId: string }>,
  ): Promise<boolean>;
}

/** Keeps token handling and audit-safe request fingerprints outside controllers. */
export class EvidenceWatermarkExportUseCases {
  constructor(private readonly repository: EvidenceWatermarkExportRepository) {}

  createExport(
    input: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      documentId: string;
      versionId: string;
      recipient: string;
      purpose: string;
      idempotencyKey: string;
    }>,
  ) {
    return this.repository.createWatermarkExport(input.organizationId, input);
  }

  getExport(
    input: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      documentId: string;
      versionId: string;
      exportId: string;
    }>,
  ) {
    return this.repository.getWatermarkExport(input.organizationId, input);
  }

  async preview(
    input: Readonly<{
      organizationId: string;
      actorId: string;
      exportId: string;
      idempotencyKey: string;
    }>,
  ) {
    return this.createAccess(input, false);
  }

  async deliver(
    input: Readonly<{
      organizationId: string;
      actorId: string;
      exportId: string;
      idempotencyKey: string;
    }>,
  ) {
    return this.createAccess(input, true);
  }

  redeemDelivery(
    input: Readonly<{
      organizationId: string;
      actorId: string;
      exportId: string;
      token: string;
      delivery: boolean;
    }>,
  ) {
    return this.repository.redeemWatermarkDelivery(input.organizationId, {
      actorId: input.actorId,
      exportId: input.exportId,
      tokenDigest: digest(input.token),
      delivery: input.delivery,
      correlationId: randomUUID(),
    });
  }

  private async createAccess(
    input: Readonly<{
      organizationId: string;
      actorId: string;
      exportId: string;
      idempotencyKey: string;
    }>,
    delivery: boolean,
  ) {
    const args = {
      actorId: input.actorId,
      exportId: input.exportId,
      idempotencyKey: input.idempotencyKey,
      requestDigest: evidenceWatermarkAccessRequestDigest({
        exportId: input.exportId,
        mode: delivery ? "delivery" : "preview",
      }),
    };
    const result = delivery
      ? await this.repository.createWatermarkDeliveryAccess(
          input.organizationId,
          args,
        )
      : await this.repository.createWatermarkPreviewAccess(
          input.organizationId,
          args,
        );
    return result;
  }
}

function digest(value: string | Record<string, unknown>) {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
}

export function evidenceWatermarkExportRequestDigest(
  input: Readonly<{
    productId: string;
    documentId: string;
    versionId: string;
    recipient: string;
    purpose: string;
  }>,
) {
  return digestParts(
    "m8-06-watermark-export",
    input.productId,
    input.documentId,
    input.versionId,
    input.recipient,
    input.purpose,
  );
}

export function evidenceWatermarkAccessRequestDigest(
  input: Readonly<{
    exportId: string;
    mode: "preview" | "delivery";
  }>,
) {
  return digestParts("m8-06-watermark-access", input.exportId, input.mode);
}

function digestParts(...parts: readonly string[]) {
  const canonical = parts
    .map((part) => `${Buffer.byteLength(part, "utf8")}:${part}`)
    .join("|");
  return createHash("sha256").update(canonical).digest("hex");
}
