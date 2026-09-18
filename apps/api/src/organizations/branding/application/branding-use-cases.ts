import type {
  OrganizationBrandingDraft,
  OrganizationBrandingDraftResponse,
  OrganizationBrandingResponse,
  PublishOrganizationBrandingInput,
  RemoveOrganizationBrandingInput,
  ResolvedOrganizationBranding,
  UpdateOrganizationBrandingDraftInput,
} from "@repo/contracts/organizations";
import { resolveOrganizationBranding } from "@repo/contracts/organizations";

import type { Result } from "../../../common/domain/result";
import { failure, success } from "../../../common/domain/result";

export type BrandingProviderErrorCode = "unavailable" | "malformed";

export class BrandingProviderError extends Error {
  readonly name = "BrandingProviderError";

  constructor(readonly code: BrandingProviderErrorCode) {
    super(code);
  }
}

export type BrandingError = Readonly<{
  code:
    | "invalid_request"
    | "scanner_rejected"
    | "conflict"
    | "not_found"
    | "unavailable"
    | "malformed_provider";
}>;

export type BrandingResult<T> = Result<T, BrandingError>;

export type FoundBranding =
  | Readonly<{ outcome: "found"; branding: ResolvedOrganizationBranding }>
  | Readonly<{ outcome: "not_found" }>;

export type BrandingWriteOutcome =
  | Readonly<{ outcome: "updated"; draft: OrganizationBrandingDraft }>
  | Readonly<{ outcome: "conflict"; draft: OrganizationBrandingDraft }>
  | Readonly<{ outcome: "invalid_request" }>
  | Readonly<{ outcome: "not_found" }>;

export type BrandingPublishOutcome =
  | Readonly<{
      outcome: "published" | "removed";
      branding: ResolvedOrganizationBranding;
      idempotent: boolean;
    }>
  | Readonly<{ outcome: "conflict"; branding?: ResolvedOrganizationBranding }>
  | Readonly<{ outcome: "invalid_request" }>
  | Readonly<{ outcome: "not_found" }>;

export type BrandingAssetReservation =
  | Readonly<{ outcome: "reserved"; assetId: string; objectKeyPrefix: string }>
  | Readonly<{ outcome: "not_found" }>;

export type BrandingAssetFinalization = Readonly<{
  contentHash: string;
  inputBytes: number;
  width: number;
  height: number;
  scannerStatus: "clean" | "scanner_not_available";
}>;

export type BrandingAssetFinalizationOutcome =
  | Readonly<{ outcome: "finalized"; draft: OrganizationBrandingDraft }>
  | Readonly<{ outcome: "not_found" }>
  | Readonly<{ outcome: "invalid_request" }>;

export interface BrandingRepository {
  getResolved(orgId: string, actorId: string): Promise<FoundBranding>;
  getDraft(orgId: string, actorId: string): Promise<FoundBranding>;
  getRenderableLogo(
    orgId: string,
    actorId: string,
  ): Promise<
    | Readonly<{ outcome: "found"; objectKey: string; sha256: string }>
    | Readonly<{ outcome: "not_found" }>
  >;
  getRenderablePublishedLogo(
    orgId: string,
    actorId: string,
  ): Promise<
    | Readonly<{ outcome: "found"; objectKey: string; sha256: string }>
    | Readonly<{ outcome: "not_found" }>
  >;
  reserveAsset(
    orgId: string,
    actorId: string,
    altText: string | null,
  ): Promise<BrandingAssetReservation>;
  finalizeAsset(
    orgId: string,
    assetId: string,
    actorId: string,
    metadata: BrandingAssetFinalization,
  ): Promise<BrandingAssetFinalizationOutcome>;
  failAsset(
    orgId: string,
    assetId: string,
    actorId: string,
    failureCode: string,
    quarantined: boolean,
  ): Promise<void>;
  saveDraft(
    orgId: string,
    actorId: string,
    input: UpdateOrganizationBrandingDraftInput,
  ): Promise<BrandingWriteOutcome>;
  publish(
    orgId: string,
    actorId: string,
    input: PublishOrganizationBrandingInput,
    requestDigest: string,
  ): Promise<BrandingPublishOutcome>;
  removeLogo(
    orgId: string,
    actorId: string,
    input: RemoveOrganizationBrandingInput,
    requestDigest: string,
  ): Promise<BrandingPublishOutcome>;
}

export interface ProcessedLogo {
  readonly bytes: Buffer;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly inputBytes: number;
}

export interface LogoProcessorPort {
  process(bytes: Buffer, declaredMimeType: string): Promise<ProcessedLogo>;
}

export interface BrandingStoragePort {
  upload(
    objectKey: string,
    bytes: Buffer,
    mimeType: "image/webp",
  ): Promise<void>;
  remove(objectKey: string): Promise<void>;
  download(
    objectKey: string,
    expectedSha256: string,
  ): Promise<
    | Readonly<{ outcome: "found"; bytes: Buffer; mimeType: "image/webp" }>
    | Readonly<{ outcome: "not_found" }>
  >;
}

export type BrandingScannerResult =
  | Readonly<{ status: "clean" }>
  | Readonly<{ status: "rejected" }>
  | Readonly<{ status: "unavailable" }>;

export interface BrandingScannerPort {
  scan(
    input: Readonly<{ bytes: Buffer; sha256: string }>,
  ): Promise<BrandingScannerResult>;
}

export interface BrandingScannerPolicyPort {
  isStrict(): boolean;
}

export interface BrandingRequestIdentityPort {
  create(
    input: Readonly<{
      organizationId: string;
      actorId: string;
      idempotencyKey: string;
      operation: "publish_branding" | "remove_branding_logo";
    }>,
  ): Readonly<{ requestDigest: string }>;
}

export class BrandingUseCases {
  constructor(
    private readonly repository: BrandingRepository,
    private readonly processor: LogoProcessorPort,
    private readonly storage: BrandingStoragePort,
    private readonly scanner: BrandingScannerPort,
    private readonly scannerPolicy: BrandingScannerPolicyPort,
    private readonly identity: BrandingRequestIdentityPort,
  ) {}

  async getResolved(
    input: Readonly<{ organizationId: string; actorId: string }>,
  ): Promise<BrandingResult<OrganizationBrandingResponse>> {
    try {
      const result = await this.repository.getResolved(
        input.organizationId,
        input.actorId,
      );
      if (result.outcome === "not_found") return this.notFound();
      return success({
        branding: resolveOrganizationBranding(result.branding),
      });
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async getDraft(
    input: Readonly<{ organizationId: string; actorId: string }>,
  ): Promise<BrandingResult<OrganizationBrandingResponse>> {
    try {
      const result = await this.repository.getDraft(
        input.organizationId,
        input.actorId,
      );
      if (result.outcome === "not_found") return this.notFound();
      return success({
        branding: resolveOrganizationBranding(result.branding),
      });
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async uploadLogo(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      altText: string | null;
      sourceBytes: Buffer;
      declaredMimeType: string;
    }>,
  ): Promise<BrandingResult<OrganizationBrandingDraftResponse>> {
    let reservation: BrandingAssetReservation | null = null;
    let uploadedObjectKey: string | null = null;
    try {
      reservation = await this.repository.reserveAsset(
        command.organizationId,
        command.actorId,
        command.altText,
      );
      if (reservation.outcome === "not_found") return this.notFound();

      const processed = await this.processor.process(
        command.sourceBytes,
        command.declaredMimeType,
      );
      const scan = await this.scanner.scan({
        bytes: processed.bytes,
        sha256: processed.sha256,
      });
      if (scan.status === "rejected") {
        await this.repository.failAsset(
          command.organizationId,
          reservation.assetId,
          command.actorId,
          "scanner_rejected",
          true,
        );
        return failure(Object.freeze({ code: "scanner_rejected" as const }));
      }
      if (scan.status === "unavailable") {
        if (this.scannerPolicy.isStrict()) {
          await this.repository.failAsset(
            command.organizationId,
            reservation.assetId,
            command.actorId,
            "scanner_not_available",
            true,
          );
          return failure(Object.freeze({ code: "unavailable" as const }));
        }
      }

      uploadedObjectKey = this.objectKeyForFinalLogo(
        reservation.objectKeyPrefix,
        processed.sha256,
      );
      await this.storage.upload(
        uploadedObjectKey,
        processed.bytes,
        "image/webp",
      );
      const finalized = await this.repository.finalizeAsset(
        command.organizationId,
        reservation.assetId,
        command.actorId,
        {
          contentHash: processed.sha256,
          inputBytes: processed.inputBytes,
          width: processed.width,
          height: processed.height,
          scannerStatus:
            scan.status === "clean" ? "clean" : "scanner_not_available",
        },
      );
      if (finalized.outcome !== "finalized") {
        await this.storage.remove(uploadedObjectKey);
        await this.repository.failAsset(
          command.organizationId,
          reservation.assetId,
          command.actorId,
          "finalize_failed",
          false,
        );
        return finalized.outcome === "not_found"
          ? this.notFound()
          : failure(Object.freeze({ code: "invalid_request" as const }));
      }
      return success({
        draft: finalized.draft,
      });
    } catch (error) {
      if (reservation?.outcome === "reserved") {
        if (uploadedObjectKey) {
          await this.storage.remove(uploadedObjectKey).catch(() => undefined);
        }
        await this.repository
          .failAsset(
            command.organizationId,
            reservation.assetId,
            command.actorId,
            "upload_failed",
            false,
          )
          .catch(() => undefined);
      }
      return this.providerFailure(error);
    }
  }

  async saveDraft(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      input: UpdateOrganizationBrandingDraftInput;
    }>,
  ): Promise<BrandingResult<OrganizationBrandingDraftResponse>> {
    try {
      return this.mapWrite(
        await this.repository.saveDraft(
          command.organizationId,
          command.actorId,
          command.input,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async renderLogo(
    input: Readonly<{ organizationId: string; actorId: string }>,
  ): Promise<
    BrandingResult<
      Readonly<{ bytes: Buffer; mimeType: "image/webp"; sha256: string }>
    >
  > {
    try {
      const logo = await this.repository.getRenderableLogo(
        input.organizationId,
        input.actorId,
      );
      if (logo.outcome === "not_found") return this.notFound();
      const download = await this.storage.download(logo.objectKey, logo.sha256);
      if (download.outcome === "not_found") return this.notFound();
      return success(
        Object.freeze({
          bytes: Buffer.from(download.bytes),
          mimeType: download.mimeType,
          sha256: logo.sha256,
        }),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async renderPublishedLogo(
    input: Readonly<{ organizationId: string; actorId: string }>,
  ): Promise<
    BrandingResult<
      Readonly<{ bytes: Buffer; mimeType: "image/webp"; sha256: string }>
    >
  > {
    try {
      const logo = await this.repository.getRenderablePublishedLogo(
        input.organizationId,
        input.actorId,
      );
      if (logo.outcome === "not_found") return this.notFound();
      const download = await this.storage.download(logo.objectKey, logo.sha256);
      if (download.outcome === "not_found") return this.notFound();
      return success(
        Object.freeze({
          bytes: Buffer.from(download.bytes),
          mimeType: download.mimeType,
          sha256: logo.sha256,
        }),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async publish(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      input: PublishOrganizationBrandingInput;
    }>,
  ): Promise<BrandingResult<OrganizationBrandingResponse>> {
    const identity = this.identity.create({
      organizationId: command.organizationId,
      actorId: command.actorId,
      idempotencyKey: command.input.idempotencyKey,
      operation: "publish_branding",
    });
    try {
      return this.mapPublish(
        await this.repository.publish(
          command.organizationId,
          command.actorId,
          command.input,
          identity.requestDigest,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async removeLogo(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      input: RemoveOrganizationBrandingInput;
    }>,
  ): Promise<BrandingResult<OrganizationBrandingResponse>> {
    const identity = this.identity.create({
      organizationId: command.organizationId,
      actorId: command.actorId,
      idempotencyKey: command.input.idempotencyKey,
      operation: "remove_branding_logo",
    });
    try {
      return this.mapPublish(
        await this.repository.removeLogo(
          command.organizationId,
          command.actorId,
          command.input,
          identity.requestDigest,
        ),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  private mapWrite(
    result: BrandingWriteOutcome,
  ): BrandingResult<OrganizationBrandingDraftResponse> {
    if (result.outcome === "updated") {
      return success({ draft: result.draft });
    }
    if (result.outcome === "not_found") return this.notFound();
    return failure(
      Object.freeze({
        code: result.outcome === "conflict" ? "conflict" : "invalid_request",
      }),
    );
  }

  private mapPublish(
    result: BrandingPublishOutcome,
  ): BrandingResult<OrganizationBrandingResponse> {
    if (result.outcome === "published" || result.outcome === "removed") {
      return success({
        branding: resolveOrganizationBranding(result.branding),
      });
    }
    if (result.outcome === "not_found") return this.notFound();
    return failure(
      Object.freeze({
        code: result.outcome === "conflict" ? "conflict" : "invalid_request",
      }),
    );
  }

  private objectKeyForFinalLogo(prefix: string, contentHash: string): string {
    return `${prefix}${contentHash}.webp`;
  }

  private notFound<T>(): BrandingResult<T> {
    return failure(Object.freeze({ code: "not_found" as const }));
  }

  private providerFailure(error: unknown): BrandingResult<never> {
    if (
      error instanceof Error &&
      "code" in error &&
      typeof (error as { code: unknown }).code === "string" &&
      [
        "invalid_mime",
        "invalid_image",
        "invalid_dimensions",
        "too_large",
      ].includes((error as { code: string }).code)
    ) {
      return failure(Object.freeze({ code: "invalid_request" as const }));
    }
    return failure(
      Object.freeze({
        code:
          error instanceof BrandingProviderError && error.code === "malformed"
            ? ("malformed_provider" as const)
            : ("unavailable" as const),
      }),
    );
  }
}
