import { createHash, randomBytes } from "node:crypto";
import { exportSources } from "@repo/contracts/exports";
import type { RequestUser } from "../../auth/auth.types";
import {
  ExportAccessDeniedError,
  ExportUnavailableError,
} from "../domain/export.errors";
import { exportPrincipal } from "./export-principal";
import type {
  ExportInput,
  ExportListQuery,
  ExportPermissionPort,
  ExportSourceContextPort,
  ExportsPort,
  ReadinessExportInput,
} from "./exports.port";

export class ExportsUseCases {
  constructor(
    private readonly repository: ExportsPort,
    private readonly permissions: ExportPermissionPort,
    private readonly creationEnabled: () => boolean = () => true,
    private readonly sourceContexts?: ExportSourceContextPort,
  ) {}
  async create(user: RequestUser, input: ExportInput) {
    if (!this.creationEnabled()) throw new ExportUnavailableError();
    const principal = exportPrincipal(user);
    const source = exportSources[input.source];
    if (
      source.subjectKind !== "member" ||
      (source.requiredRole !== undefined &&
        { viewer: 0, member: 1, admin: 2, owner: 3 }[principal.role] <
          { admin: 2, owner: 3 }[source.requiredRole]) ||
      !(await this.permissions.can(
        principal.organizationId,
        principal.actorId,
        principal.role,
        source.requiredPermissions,
      ))
    )
      throw new ExportAccessDeniedError();
    if (["audit.events", "dashboard.trends"].includes(input.source)) {
      if (!this.sourceContexts) throw new ExportAccessDeniedError();
      const trustedContext = await this.sourceContexts.prepare(user, input);
      return this.repository.create(
        principal.organizationId,
        principal,
        input,
        trustedContext,
      );
    }
    return this.repository.create(principal.organizationId, principal, input);
  }
  async createReadiness(user: RequestUser, input: ReadinessExportInput) {
    if (!this.creationEnabled()) throw new ExportUnavailableError();
    const principal = exportPrincipal(user);
    if (
      !(await this.permissions.can(
        principal.organizationId,
        principal.actorId,
        principal.role,
        [
          "can_view_products",
          "can_view_technical_files",
          "can_export_technical_files",
        ],
      ))
    )
      throw new ExportAccessDeniedError();
    return this.repository.createReadiness(
      principal.organizationId,
      principal,
      input,
    );
  }
  async list(user: RequestUser, query: ExportListQuery) {
    const principal = exportPrincipal(user);
    return this.repository.list(principal.organizationId, principal, query);
  }
  async get(user: RequestUser, jobId: string) {
    const principal = exportPrincipal(user);
    return this.repository.get(principal.organizationId, principal, jobId);
  }
  async manifest(user: RequestUser, jobId: string) {
    const principal = exportPrincipal(user);
    return this.repository.manifest(principal.organizationId, principal, jobId);
  }
  async mutate(
    user: RequestUser,
    jobId: string,
    expectedVersion: number,
    idempotencyKey: string,
    operation: "cancel" | "retry",
  ) {
    const principal = exportPrincipal(user);
    return this.repository.mutate(
      principal.organizationId,
      principal,
      jobId,
      expectedVersion,
      idempotencyKey,
      operation,
    );
  }
  async grant(user: RequestUser, jobId: string, artifactId: string) {
    const principal = exportPrincipal(user);
    const cookieValue = randomBytes(32).toString("hex");
    const grant = await this.repository.grant(
      principal.organizationId,
      principal,
      jobId,
      artifactId,
      digest(cookieValue),
    );
    return Object.freeze({ grant, cookieValue });
  }
  async download(
    user: RequestUser,
    jobId: string,
    grantId: string,
    cookieValue: string | undefined,
  ) {
    const principal = exportPrincipal(user);
    if (!cookieValue || !/^[a-f0-9]{64}$/.test(cookieValue))
      return Promise.reject(new ExportAccessDeniedError());
    return this.repository.download(
      principal.organizationId,
      principal,
      jobId,
      grantId,
      digest(cookieValue),
    );
  }
}
function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
