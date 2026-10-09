import type {
  CreateTechnicalFileAuditorGrantRequest,
  RevokeTechnicalFileAuditorGrantRequest,
  TechnicalFileAuditorGrantPreviewResponse,
  TechnicalFileAuditorGrantResponse,
  TechnicalFileAuditorManifestResponse,
  TechnicalFileAuditorSnapshotViewResponse,
} from "@repo/contracts/technical-files";

type TechnicalFileAuditorGrant = TechnicalFileAuditorGrantResponse["grant"];
type TechnicalFileAuditorGrantPreview =
  TechnicalFileAuditorGrantPreviewResponse["preview"];
type TechnicalFileAuditorManifest =
  TechnicalFileAuditorManifestResponse["manifest"];
type TechnicalFileAuditorSnapshotView =
  TechnicalFileAuditorSnapshotViewResponse["snapshot"];

export const TECHNICAL_FILE_AUDITOR_ACCESS_REPOSITORY = Symbol(
  "TECHNICAL_FILE_AUDITOR_ACCESS_REPOSITORY",
);

export type TechnicalFileAuditorArtifact = "pdf" | "archive" | "manifest";

export interface TechnicalFileAuditorArtifactContents {
  readonly bytes: Uint8Array;
  readonly mimeType: "application/pdf" | "application/zip" | "application/json";
  readonly fileName: string;
}

/**
 * Owner operations remain tenant-first. Auditor operations accept only the
 * opaque session secret; they never receive an organization or product ID.
 */
export interface TechnicalFileAuditorAccessRepository {
  preview(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      snapshotId: string;
      exportId: string;
    }>,
  ): Promise<TechnicalFileAuditorGrantPreview | null>;
  list(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string; snapshotId: string }>,
  ): Promise<readonly TechnicalFileAuditorGrant[] | null>;
  create(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        snapshotId: string;
        grantId: string;
        tokenHash: string;
        requestDigest: string;
      } & CreateTechnicalFileAuditorGrantRequest
    >,
  ): Promise<TechnicalFileAuditorGrant | null>;
  revoke(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        snapshotId: string;
        grantId: string;
      } & RevokeTechnicalFileAuditorGrantRequest
    >,
  ): Promise<TechnicalFileAuditorGrant | null>;
  redeem(
    input: Readonly<{
      tokenHash: string;
      sessionId: string;
      sessionTokenHash: string;
      sessionExpiresAt: string;
      clientSourceHash: string | null;
    }>,
  ): Promise<Readonly<{ expiresAt: string }> | null>;
  view(
    sessionTokenHash: string,
  ): Promise<TechnicalFileAuditorSnapshotView | null>;
  manifest(
    sessionTokenHash: string,
  ): Promise<TechnicalFileAuditorManifest | null>;
  artifact(
    sessionTokenHash: string,
    artifact: TechnicalFileAuditorArtifact,
  ): Promise<TechnicalFileAuditorArtifactContents | null>;
}

export class TechnicalFileAuditorAccessConflictError extends Error {
  constructor(readonly currentVersion: number | null = null) {
    super("The auditor grant changed.");
  }
}

/** Intentionally maps all auditor-secret failures to one public outcome. */
export class TechnicalFileAuditorAccessUnavailableError extends Error {}
