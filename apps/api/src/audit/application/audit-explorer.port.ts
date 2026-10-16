import type {
  AuditDetail,
  AuditEventView,
  AuditExportFormat,
  AuditExportJob,
  AuditSearchFilters,
  AuditVerificationResult,
} from "@repo/contracts/audit/types";
import type { BaseRole, PermissionSet } from "@repo/contracts/permissions";

export const AUDIT_EXPLORER_REPOSITORY = Symbol("AUDIT_EXPLORER_REPOSITORY");

export interface AuditTokenPrincipal {
  organizationId: string;
  actorId: string;
  sessionId: string;
}

export interface AuditSnapshotTokenPayload extends AuditTokenPrincipal {
  kind: "snapshot";
  requestId: string;
  receiptId: string;
  highWaterSequence: string;
  expiresAt: string;
  filterDigest: string;
  scopeDigest: string;
  scopeVersion: string;
  filters: AuditSearchFilters;
}

export interface AuditCursorTokenPayload extends AuditTokenPrincipal {
  kind: "cursor";
  requestId: string;
  receiptId: string;
  afterSequence: string | null;
  afterCreatedAt: string | null;
  afterId: string;
}

export interface AuditDownloadGrantPayload extends AuditTokenPrincipal {
  kind: "download";
  requestId: string;
  jobId: string;
  packageHash: string;
  permissionFingerprint: string;
  randomDigest: string;
  expiresAt: string;
}

export interface AuditExplorerTokenCodec {
  snapshot(payload: AuditSnapshotTokenPayload): string;
  openSnapshot(
    token: string,
    principal: AuditTokenPrincipal,
  ): AuditSnapshotTokenPayload;
  cursor(payload: AuditCursorTokenPayload): string;
  openCursor(
    token: string,
    principal: AuditTokenPrincipal,
  ): AuditCursorTokenPayload;
  downloadGrant(payload: AuditDownloadGrantPayload): string;
  openDownloadGrant(
    token: string,
    principal: AuditTokenPrincipal,
  ): AuditDownloadGrantPayload;
  digest(value: unknown): string;
  randomDigest(): string;
}

export interface AuditSnapshotReceipt {
  receiptId: string;
  highWaterSequence: string;
  expiresAt: string;
  filterDigest: string;
  scopeDigest: string;
  scopeVersion: string;
}

export interface AuditAccessReceipt {
  receiptId: string;
  replayed: boolean;
}

export interface AuditExplorerPermissions {
  permissions: PermissionSet;
  version: string;
}

export interface AuditPageCursor {
  afterSequence: string | null;
  afterCreatedAt: string | null;
  afterId: string | null;
}

export interface AuditPageRead {
  items: AuditEventView[];
  lastCursor: {
    afterSequence: string | null;
    afterCreatedAt: string | null;
    afterId: string;
  } | null;
}

export interface AuditExportDownloadPackage {
  body: NodeJS.ReadableStream;
  contentLength: number;
  packageHash: string;
  cleanup: () => Promise<void>;
}

export interface AuditExplorerRepository {
  effectivePermissions(
    orgId: string,
    actorId: string,
    baseRole: BaseRole,
  ): Promise<AuditExplorerPermissions>;

  createSnapshot(input: {
    organizationId: string;
    actorId: string;
    requestId: string;
    filterDigest: string;
    scopeDigest: string;
  }): Promise<AuditSnapshotReceipt>;

  recordDenial(input: {
    organizationId: string;
    actorId: string;
    requestId: string;
    operationDigest: string;
  }): Promise<AuditAccessReceipt>;

  recordAccess(input: {
    organizationId: string;
    actorId: string;
    requestId: string;
    action:
      | "audit.search.page"
      | "audit.search.detail"
      | "audit.search.verify"
      | "audit.search.denied";
    receiptId: string;
    operationDigest: string;
  }): Promise<AuditAccessReceipt>;

  readPage(input: {
    organizationId: string;
    actorId: string;
    receiptId: string;
    filterDigest: string;
    scopeDigest: string;
    filters: AuditSearchFilters;
    allowedEntityTypes: readonly string[];
    cursor: AuditPageCursor;
    limit: number;
  }): Promise<AuditPageRead>;

  readDetail(input: {
    organizationId: string;
    actorId: string;
    receiptId: string;
    filterDigest: string;
    scopeDigest: string;
    filters: AuditSearchFilters;
    allowedEntityTypes: readonly string[];
    eventId: string;
  }): Promise<AuditDetail>;

  verify(input: {
    organizationId: string;
    actorId: string;
    receiptId: string;
    filterDigest: string;
    scopeDigest: string;
    filters: AuditSearchFilters;
    allowedEntityTypes: readonly string[];
    eventIds: readonly string[];
  }): Promise<AuditVerificationResult>;

  createExport(input: {
    organizationId: string;
    actorId: string;
    requestId: string;
    receiptId: string;
    filters: AuditSearchFilters;
    allowedEntityTypes: readonly string[];
    filterDigest: string;
    scopeDigest: string;
    format: AuditExportFormat;
  }): Promise<AuditExportJob>;

  getExport(input: {
    organizationId: string;
    actorId: string;
    requestId: string;
    jobId: string;
  }): Promise<AuditExportJob>;

  issueDownloadGrant(input: {
    organizationId: string;
    actorId: string;
    requestId: string;
    jobId: string;
    sessionId: string;
    grantDigest: string;
  }): Promise<AuditExportJob>;

  redeemDownloadGrant(input: {
    organizationId: string;
    actorId: string;
    requestId: string;
    jobId: string;
    sessionId: string;
    grantDigest: string;
  }): Promise<{ packageHash: string; objectPath: string; bytes: number }>;

  downloadPackage(input: {
    organizationId: string;
    jobId: string;
    packageHash: string;
    objectPath: string;
    bytes: number;
  }): Promise<AuditExportDownloadPackage>;
}
