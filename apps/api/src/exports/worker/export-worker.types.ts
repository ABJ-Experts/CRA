import type { ExportArtifact, ExportScope } from "@repo/contracts/exports";
import type { ExportColumn, FrozenRow } from "./export-renderer";
export type ExportPartCheckpoint = Readonly<
  ExportArtifact & {
    objectPath: string;
    startOrdinal: number;
    endOrdinal: number;
  }
>;
export type FrozenExportJob = Readonly<{
  id: string;
  organizationId: string;
  workerId: string;
  version: number;
  source: string;
  requestedAt: string;
  requestDigest: string;
  scope: ExportScope;
  format: "csv" | "xlsx" | "report";
  sourceVersionsDigest?: string;
  snapshotAsOf: string | null;
  totalRows: number;
  columns: readonly ExportColumn[];
  parts: readonly ExportPartCheckpoint[];
  captureState: "pending" | "captured" | "published";
}>;
export type ExportWorkerRepository = Readonly<{
  claim(workerId: string): Promise<FrozenExportJob | null>;
  capture(job: FrozenExportJob): Promise<FrozenExportJob>;
  publishCapture(job: FrozenExportJob): Promise<FrozenExportJob>;
  authorize(job: FrozenExportJob): Promise<boolean>;
  heartbeat(job: FrozenExportJob): Promise<FrozenExportJob>;
  rows(
    job: FrozenExportJob,
    afterOrdinal: number,
    limit: number,
  ): Promise<readonly FrozenRow[]>;
  checkpoint(
    job: FrozenExportJob,
    parts: readonly ExportPartCheckpoint[],
  ): Promise<FrozenExportJob>;
  complete(
    job: FrozenExportJob,
    manifest: Readonly<Record<string, unknown>>,
  ): Promise<void>;
  fail(job: FrozenExportJob, code: string, retryable: boolean): Promise<void>;
}>;
export type ExportWorkerStorage = Readonly<{
  upload(
    input: Readonly<{
      objectPath: string;
      contentType: string;
      stream: NodeJS.ReadableStream;
    }>,
  ): Promise<void>;
  verify(
    part: Readonly<{ objectPath: string; sha256: string; bytes: number }>,
  ): Promise<boolean>;
}>;
