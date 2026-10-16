import type { Readable } from "node:stream";
import type { z } from "zod";
import type {
  createExportJobSchema,
  createReadinessExportSchema,
  exportJobSchema,
  exportJobListQuerySchema,
  exportJobListResponseSchema,
  exportDownloadGrantSchema,
  exportManifestSchema,
} from "@repo/contracts/exports";
import type { ExportPrincipal } from "./export-principal";

export type ExportJob = z.output<typeof exportJobSchema>;
export type ExportInput = z.output<typeof createExportJobSchema>;
export type ReadinessExportInput = z.output<typeof createReadinessExportSchema>;
export type ExportListQuery = z.output<typeof exportJobListQuerySchema>;
export type ExportList = z.output<typeof exportJobListResponseSchema>;
export type ExportManifest = z.output<typeof exportManifestSchema>;
export type ExportGrant = z.output<typeof exportDownloadGrantSchema>;
export type ExportDownload = Readonly<{
  body: Readable;
  byteLength: number;
  sha256: string;
  mediaType: string;
  name: string;
  cleanup: () => Promise<void>;
}>;
export interface ExportsPort {
  create(
    orgId: string,
    principal: ExportPrincipal,
    input: ExportInput,
    trustedContext?: Readonly<Record<string, unknown>>,
  ): Promise<ExportJob>;
  manifest(
    orgId: string,
    principal: ExportPrincipal,
    jobId: string,
  ): Promise<ExportManifest>;
  createReadiness(
    orgId: string,
    principal: ExportPrincipal,
    input: ReadinessExportInput,
  ): Promise<ExportJob>;
  list(
    orgId: string,
    principal: ExportPrincipal,
    query: ExportListQuery,
  ): Promise<ExportList>;
  get(
    orgId: string,
    principal: ExportPrincipal,
    jobId: string,
  ): Promise<ExportJob>;
  mutate(
    orgId: string,
    principal: ExportPrincipal,
    jobId: string,
    expectedVersion: number,
    idempotencyKey: string,
    operation: "cancel" | "retry",
  ): Promise<ExportJob>;
  grant(
    orgId: string,
    principal: ExportPrincipal,
    jobId: string,
    artifactId: string,
    digest: string,
  ): Promise<ExportGrant>;
  download(
    orgId: string,
    principal: ExportPrincipal,
    jobId: string,
    grantId: string,
    digest: string,
  ): Promise<ExportDownload>;
}
export interface ExportPermissionPort {
  can(
    orgId: string,
    actorId: string,
    role: ExportPrincipal["role"],
    keys: readonly import("@repo/contracts/permissions").PermissionKey[],
  ): Promise<boolean>;
}

export interface ExportSourceContextPort {
  prepare(
    user: import("../../auth/auth.types").RequestUser,
    input: ExportInput,
  ): Promise<Readonly<Record<string, unknown>>>;
}

export type ScheduledExportSourceInput = Readonly<{
  organizationId: string;
  ownerUserId: string;
  userId: string;
  ownerBaseRole: import("@repo/contracts/permissions").BaseRole;
  recipientBaseRole: import("@repo/contracts/permissions").BaseRole;
  requestId: string;
  source: string;
  filters: Readonly<Record<string, unknown>>;
  context: Readonly<Record<string, unknown>>;
}>;
export interface ScheduledExportSourceContextPort {
  prepareScheduled(
    input: ScheduledExportSourceInput,
  ): Promise<Readonly<Record<string, unknown>>>;
}
