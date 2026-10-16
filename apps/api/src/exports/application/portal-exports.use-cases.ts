import { createHash, randomBytes } from "node:crypto";
import { exportSources } from "@repo/contracts/exports";
import type { ExportInput, ExportListQuery } from "./exports.port";
import type { PortalExportPrincipal } from "./portal-export-principal";
import type { PortalExportsPort } from "./portal-exports.port";
import {
  ExportAccessDeniedError,
  ExportUnavailableError,
} from "../domain/export.errors";
export class PortalExportsUseCases {
  constructor(
    private readonly repository: PortalExportsPort,
    private readonly creationEnabled: () => boolean = () => true,
  ) {}
  async create(p: PortalExportPrincipal, input: ExportInput) {
    if (!this.creationEnabled()) throw new ExportUnavailableError();
    if (exportSources[input.source].subjectKind !== p.kind)
      throw new ExportAccessDeniedError();
    return this.repository.create(p, input);
  }
  async list(p: PortalExportPrincipal, query: ExportListQuery) {
    if (query.source && exportSources[query.source].subjectKind !== p.kind)
      throw new ExportAccessDeniedError();
    return this.repository.list(p, query);
  }
  get(p: PortalExportPrincipal, jobId: string) {
    return this.repository.get(p, jobId);
  }
  manifest(p: PortalExportPrincipal, jobId: string) {
    return this.repository.manifest(p, jobId);
  }
  mutate(
    p: PortalExportPrincipal,
    jobId: string,
    expectedVersion: number,
    idempotencyKey: string,
    operation: "cancel" | "retry",
  ) {
    return this.repository.mutate(
      p,
      jobId,
      expectedVersion,
      idempotencyKey,
      operation,
    );
  }
  async grant(p: PortalExportPrincipal, jobId: string, artifactId: string) {
    const cookieValue = randomBytes(32).toString("hex");
    return Object.freeze({
      grant: await this.repository.grant(
        p,
        jobId,
        artifactId,
        digest(cookieValue),
      ),
      cookieValue,
    });
  }
  async download(
    p: PortalExportPrincipal,
    jobId: string,
    grantId: string,
    cookieValue: string | undefined,
  ) {
    if (!cookieValue || !/^[a-f0-9]{64}$/.test(cookieValue))
      throw new ExportAccessDeniedError();
    return this.repository.download(p, jobId, grantId, digest(cookieValue));
  }
}
function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
