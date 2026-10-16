import { createHash, randomBytes } from "node:crypto";
import { exportSources } from "@repo/contracts/exports";
import type { RequestUser } from "../../auth/auth.types";
import {
  ReportAccessDeniedError,
  ReportInvalidRequestError,
  ReportUnavailableError,
} from "../domain/report.errors";
import type {
  CreateReportInput,
  ReportEmailPreferenceInput,
  ReportListQuery,
  ReportMutationInput,
  ReportPrincipal,
  ReportRunsQuery,
  ReportsPort,
  UpdateReportInput,
} from "./reports.port";

type PermissionPort = Pick<
  import("../../permissions/permissions.service").PermissionsService,
  "can"
>;
type ReportSelection = CreateReportInput["config"]["report"];

export function reportPrincipal(user: RequestUser): ReportPrincipal {
  if (!user?.isActive || !user.organizationId || !user.sessionId || !user.role)
    throw new ReportAccessDeniedError();
  return Object.freeze({
    organizationId: user.organizationId,
    actorId: user.id,
    sessionId: user.sessionId,
    role: user.role,
  });
}

export class ReportsUseCases {
  constructor(
    private readonly repository: ReportsPort,
    private readonly permissions: PermissionPort,
    private readonly creationEnabled: () => boolean = () => true,
  ) {}

  private async authorizeSelection(
    p: ReportPrincipal,
    report: ReportSelection,
  ) {
    const rank = { viewer: 0, member: 1, admin: 2, owner: 3 };
    if (report.kind === "readiness") {
      if (
        !(await this.permissions.can(p.organizationId, p.actorId, p.role, [
          "can_view_products",
          "can_view_technical_files",
          "can_export_technical_files",
        ]))
      )
        throw new ReportAccessDeniedError();
      return;
    }
    const source = exportSources[report.source];
    if (!source || source.subjectKind !== "member")
      throw new ReportInvalidRequestError();
    if (
      (source.requiredRole && rank[p.role] < rank[source.requiredRole]) ||
      !(await this.permissions.can(
        p.organizationId,
        p.actorId,
        p.role,
        source.requiredPermissions,
      ))
    )
      throw new ReportAccessDeniedError();
  }

  async create(user: RequestUser, input: CreateReportInput) {
    const p = reportPrincipal(user);
    if (!this.creationEnabled()) throw new ReportUnavailableError();
    await this.authorizeSelection(p, input.config.report);
    return this.repository.create(p.organizationId, p, input);
  }
  async update(user: RequestUser, id: string, input: UpdateReportInput) {
    const p = reportPrincipal(user);
    await this.authorizeSelection(p, input.config.report);
    return this.repository.update(p.organizationId, p, id, input);
  }
  get(user: RequestUser, id: string) {
    const p = reportPrincipal(user);
    return this.repository.get(p.organizationId, p, id);
  }
  list(user: RequestUser, query: ReportListQuery) {
    const p = reportPrincipal(user);
    return this.repository.list(p.organizationId, p, query);
  }
  async mutate(
    user: RequestUser,
    id: string,
    operation: "activate" | "pause" | "resume" | "archive",
    input: ReportMutationInput,
  ) {
    const p = reportPrincipal(user);
    if (operation === "activate" || operation === "resume") {
      const current = await this.repository.get(p.organizationId, p, id);
      await this.authorizeSelection(p, current.data.config.report);
    }
    return this.repository.mutate(p.organizationId, p, id, operation, input);
  }
  async preview(user: RequestUser, id: string, input: ReportMutationInput) {
    const p = reportPrincipal(user);
    const current = await this.repository.get(p.organizationId, p, id);
    await this.authorizeSelection(p, current.data.config.report);
    return this.repository.preview(p.organizationId, p, id, input);
  }
  getRun(user: RequestUser, id: string) {
    const p = reportPrincipal(user);
    return this.repository.getRun(p.organizationId, p, id);
  }
  listRuns(user: RequestUser, query: ReportRunsQuery) {
    const p = reportPrincipal(user);
    return this.repository.listRuns(p.organizationId, p, query);
  }
  replay(user: RequestUser, id: string, input: ReportMutationInput) {
    const p = reportPrincipal(user);
    return this.repository.replay(p.organizationId, p, id, input);
  }
  recipients(user: RequestUser, query: ReportListQuery) {
    const p = reportPrincipal(user);
    return this.repository.recipients(p.organizationId, p, query);
  }
  manifest(user: RequestUser, runId: string, recipientId: string) {
    const p = reportPrincipal(user);
    return this.repository.manifest(p.organizationId, p, runId, recipientId);
  }
  async grant(
    user: RequestUser,
    runId: string,
    recipientId: string,
    artifactId: string,
  ) {
    const p = reportPrincipal(user);
    const cookieValue = randomBytes(32).toString("hex");
    const response = await this.repository.grant(
      p.organizationId,
      p,
      runId,
      recipientId,
      artifactId,
      digest(cookieValue),
    );
    return Object.freeze({ response, cookieValue });
  }
  download(
    user: RequestUser,
    runId: string,
    recipientId: string,
    grantId: string,
    cookieValue: string | undefined,
  ) {
    const p = reportPrincipal(user);
    if (!cookieValue || !/^[a-f0-9]{64}$/.test(cookieValue))
      throw new ReportAccessDeniedError();
    return this.repository.download(
      p.organizationId,
      p,
      runId,
      recipientId,
      grantId,
      digest(cookieValue),
    );
  }
  getEmailPreference(user: RequestUser) {
    const p = reportPrincipal(user);
    return this.repository.getEmailPreference(p.organizationId, p);
  }
  setEmailPreference(user: RequestUser, input: ReportEmailPreferenceInput) {
    const p = reportPrincipal(user);
    return this.repository.setEmailPreference(p.organizationId, p, input);
  }
  listAdministration(user: RequestUser, query: ReportListQuery) {
    const p = reportPrincipal(user);
    if (!["admin", "owner"].includes(p.role))
      throw new ReportAccessDeniedError();
    return this.repository.listAdministration(p.organizationId, p, query);
  }
  adminPause(user: RequestUser, id: string, input: ReportMutationInput) {
    const p = reportPrincipal(user);
    if (!["admin", "owner"].includes(p.role))
      throw new ReportAccessDeniedError();
    return this.repository.adminPause(p.organizationId, p, id, input);
  }
}
function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
