import type {
  ExportDownload,
  ExportInput,
  ExportJob,
  ExportList,
  ExportListQuery,
  ExportGrant,
  ExportManifest,
} from "./exports.port";
import type { PortalExportPrincipal } from "./portal-export-principal";
export interface PortalExportsPort {
  create(
    principal: PortalExportPrincipal,
    input: ExportInput,
  ): Promise<ExportJob>;
  list(
    principal: PortalExportPrincipal,
    query: ExportListQuery,
  ): Promise<ExportList>;
  get(principal: PortalExportPrincipal, jobId: string): Promise<ExportJob>;
  manifest(
    principal: PortalExportPrincipal,
    jobId: string,
  ): Promise<ExportManifest>;
  mutate(
    principal: PortalExportPrincipal,
    jobId: string,
    expectedVersion: number,
    idempotencyKey: string,
    operation: "cancel" | "retry",
  ): Promise<ExportJob>;
  grant(
    principal: PortalExportPrincipal,
    jobId: string,
    artifactId: string,
    digest: string,
  ): Promise<ExportGrant>;
  download(
    principal: PortalExportPrincipal,
    jobId: string,
    grantId: string,
    digest: string,
  ): Promise<ExportDownload>;
}
