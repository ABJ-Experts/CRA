import type {
  SupportDiagnosticSelection,
  SupportDiagnosticJob,
  SupportDiagnosticList,
  SupportDiagnosticListQuery,
  SupportDiagnosticMutation,
  SupportDiagnosticCleanupInput,
  SupportDiagnosticGrant,
  SupportDiagnosticCleanupReview,
  SupportDiagnosticManifest,
} from "@repo/contracts/support-diagnostics/types";
export interface DiagnosticPrincipal {
  organizationId: string;
  actorId: string;
  sessionId: string;
}
export interface DiagnosticAuthority {
  organizationId: string;
  actorUserId: string;
  sessionId: string;
  permissionVersion: string;
}
export interface DiagnosticAccess {
  job: SupportDiagnosticJob;
  objectPath: string;
  manifest: SupportDiagnosticManifest;
}
export interface DiagnosticRepository {
  authority(
    orgId: string,
    p: DiagnosticPrincipal,
  ): Promise<DiagnosticAuthority>;
  create(
    orgId: string,
    p: DiagnosticPrincipal,
    selection: SupportDiagnosticSelection,
    previewDigest: string,
    idempotencyKey: string,
  ): Promise<SupportDiagnosticJob>;
  list(
    orgId: string,
    p: DiagnosticPrincipal,
    query: SupportDiagnosticListQuery,
  ): Promise<SupportDiagnosticList>;
  get(
    orgId: string,
    p: DiagnosticPrincipal,
    jobId: string,
  ): Promise<SupportDiagnosticJob>;
  cancel(
    orgId: string,
    p: DiagnosticPrincipal,
    jobId: string,
    input: SupportDiagnosticMutation,
  ): Promise<SupportDiagnosticJob>;
  access(
    orgId: string,
    p: DiagnosticPrincipal,
    jobId: string,
    requestId: string,
  ): Promise<DiagnosticAccess>;
  revalidate(
    orgId: string,
    p: DiagnosticPrincipal,
    jobId: string,
    requestId: string,
  ): Promise<DiagnosticAccess>;
  grant(
    orgId: string,
    p: DiagnosticPrincipal,
    jobId: string,
    input: SupportDiagnosticMutation,
    grantId: string,
    grantDigest: string,
  ): Promise<SupportDiagnosticGrant>;
  redeem(
    orgId: string,
    p: DiagnosticPrincipal,
    jobId: string,
    grantId: string,
    grantDigest: string,
    requestId: string,
  ): Promise<DiagnosticAccess>;
  cleanupReview(
    orgId: string,
    p: DiagnosticPrincipal,
    jobId: string,
  ): Promise<SupportDiagnosticCleanupReview>;
  cleanup(
    orgId: string,
    p: DiagnosticPrincipal,
    jobId: string,
    input: SupportDiagnosticCleanupInput,
  ): Promise<SupportDiagnosticJob>;
}
export class DiagnosticDeniedError extends Error {
  constructor() {
    super("Diagnostic is not available");
  }
}
export class DiagnosticConflictError extends Error {
  constructor() {
    super("Diagnostic state changed");
  }
}
export class DiagnosticUnavailableError extends Error {
  constructor() {
    super("Diagnostic service unavailable");
  }
}

export class DiagnosticInvalidError extends Error {
  constructor() {
    super("Diagnostic request is invalid");
  }
}
