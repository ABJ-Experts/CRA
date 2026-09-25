import { randomUUID } from "node:crypto";
import {
  EvidenceWatermarkRenderError,
  EvidenceWatermarkRenderer,
} from "../infrastructure/evidence-watermark-renderer";
import { SupabaseEvidenceStorageAdapter } from "../infrastructure/supabase-evidence-storage.adapter";
import {
  evidenceWatermarkDerivativeSha256,
  SupabaseEvidenceWatermarkExportStorageAdapter,
} from "../infrastructure/supabase-evidence-watermark-export-storage.adapter";
import type {
  EvidenceWatermarkExportClaim,
  EvidenceWatermarkExportRepository,
} from "../application/evidence-watermark-export-use-cases";

export type EvidenceWatermarkExportFailureCode =
  | "unsupported_media_type"
  | "source_unavailable"
  | "source_integrity_failed"
  | "source_malformed"
  | "renderer_unavailable"
  | "page_limit"
  | "output_limit"
  | "storage_failed";

/**
 * Claims exactly one export. A claim is the only authority to render or write
 * a derivative; all source/version/tenant decisions remain in the DB RPC.
 */
export class EvidenceWatermarkExportWorker {
  constructor(
    private readonly dependencies: Readonly<{
      repository: EvidenceWatermarkExportRepository;
      originals: SupabaseEvidenceStorageAdapter;
      derivatives: SupabaseEvidenceWatermarkExportStorageAdapter;
      renderer: EvidenceWatermarkRenderer;
      leaseSeconds: number;
    }>,
  ) {}

  async processOne(
    workerId = randomUUID(),
  ): Promise<"empty" | "ready" | "failed"> {
    const claim = await this.dependencies.repository.claimWatermarkExport({
      workerId,
      leaseSeconds: this.dependencies.leaseSeconds,
    });
    if (!claim) return "empty";
    let storedKey: string | null = null;
    try {
      const source = await this.dependencies.originals.readVerified({
        objectKey: claim.objectKey,
        sha256: claim.export.sourceSha256,
        byteSize: claim.sourceByteSize,
        mediaType: claim.sourceMediaType,
      });
      if (!source)
        throw new EvidenceWatermarkRenderError("source_integrity_failed");
      const derivative = await this.dependencies.renderer.render({
        bytes: source,
        mediaType: claim.sourceMediaType,
        recipient: claim.export.recipient,
        purpose: claim.export.purpose,
        exportedAt: claim.export.requestedAt,
      });
      const objectKey = derivativeObjectKey(
        claim.organizationId,
        claim.export.id,
      );
      if (
        (await this.dependencies.derivatives.upload({
          objectKey,
          bytes: derivative.bytes,
          mediaType: derivative.mediaType,
        })) !== "stored"
      )
        throw new DerivativeStorageError();
      storedKey = objectKey;
      const finalized =
        await this.dependencies.repository.finalizeWatermarkExport(
          claim.organizationId,
          {
            exportId: claim.export.id,
            workerId,
            objectKey,
            sha256: evidenceWatermarkDerivativeSha256(derivative.bytes),
            byteSize: derivative.bytes.byteLength,
            mediaType: derivative.mediaType,
          },
        );
      if (!finalized)
        throw new Error("watermark export finalization unavailable");
      return "ready";
    } catch (error) {
      const failed = await this.safelyFail(claim, workerId, failureCode(error));
      if (storedKey && failed)
        await this.dependencies.derivatives.remove({ objectKey: storedKey });
      return "failed";
    }
  }

  private async safelyFail(
    claim: EvidenceWatermarkExportClaim,
    workerId: string,
    code: EvidenceWatermarkExportFailureCode,
  ) {
    try {
      const failed = await this.dependencies.repository.failWatermarkExport(
        claim.organizationId,
        {
          exportId: claim.export.id,
          workerId,
          failureCode: code,
        },
      );
      return (
        failed &&
        (await this.dependencies.repository.isWatermarkExportDurablyFailed(
          claim.organizationId,
          {
            exportId: claim.export.id,
          },
        ))
      );
    } catch {
      // The finalization response may have been lost. Leave any private
      // object in place unless the database confirms a terminal failed row.
      return false;
    }
  }
}

class DerivativeStorageError extends Error {}

export function derivativeObjectKey(organizationId: string, exportId: string) {
  return `${organizationId}/${exportId}/${randomUUID()}/${randomUUID()}`;
}

export function failureCode(
  error: unknown,
): EvidenceWatermarkExportFailureCode {
  if (error instanceof EvidenceWatermarkRenderError) return error.code;
  if (error instanceof DerivativeStorageError) return "storage_failed";
  return "renderer_unavailable";
}
