import type {
  CancelTechnicalFileSnapshotExportRequest,
  CreateTechnicalFileSnapshotExportRequest,
  CreateTechnicalFileSnapshotRequest,
  TechnicalFileSnapshot,
  TechnicalFileSnapshotDownloadResponse,
  TechnicalFileSnapshotExport,
} from "@repo/contracts/technical-files";

export const TECHNICAL_FILE_SNAPSHOT_REPOSITORY = Symbol(
  "TECHNICAL_FILE_SNAPSHOT_REPOSITORY",
);

export type TechnicalFileSnapshotArtifactName = "pdf" | "archive";

/** Tenant-first durable snapshot/export boundary. Storage paths never leave it. */
export interface TechnicalFileSnapshotRepository {
  list(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string }>,
  ): Promise<readonly TechnicalFileSnapshot[] | null>;
  get(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string; snapshotId: string }>,
  ): Promise<TechnicalFileSnapshot | null>;
  create(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
      } & CreateTechnicalFileSnapshotRequest
    >,
  ): Promise<TechnicalFileSnapshot | null>;
  requestExport(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        snapshotId: string;
      } & CreateTechnicalFileSnapshotExportRequest
    >,
  ): Promise<TechnicalFileSnapshotExport | null>;
  getExport(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      snapshotId: string;
      exportId: string;
    }>,
  ): Promise<TechnicalFileSnapshotExport | null>;
  cancelExport(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        snapshotId: string;
        exportId: string;
      } & CancelTechnicalFileSnapshotExportRequest
    >,
  ): Promise<TechnicalFileSnapshotExport | null>;
  getDownload(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      snapshotId: string;
      exportId: string;
      artifact: TechnicalFileSnapshotArtifactName;
    }>,
  ): Promise<TechnicalFileSnapshotDownloadResponse | null>;
}

export class TechnicalFileSnapshotConflictError extends Error {
  constructor(readonly currentVersion: number | null = null) {
    super("The technical file changed.");
  }
}

export class TechnicalFileSnapshotInvalidRequestError extends Error {}
