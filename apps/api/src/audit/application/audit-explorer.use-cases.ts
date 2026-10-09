import type {
  AuditDetail,
  AuditDownloadGrant,
  AuditExportInput,
  AuditExportJob,
  AuditOperationQuery,
  AuditPage,
  AuditPageQuery,
  AuditSearchInput,
  AuditSnapshot,
  AuditVerificationInput,
  AuditVerificationResult,
} from "@repo/contracts/audit/types";

import type { RequestUser } from "../../auth/auth.types";
import { buildAuditSourcePolicy } from "../audit-source-policy";
import {
  AuditExplorerForbiddenError,
  AuditExplorerStaleError,
} from "../audit-explorer.errors";
import {
  type AuditCursorTokenPayload,
  type AuditDownloadGrantPayload,
  type AuditExplorerRepository,
  type AuditExplorerTokenCodec,
  type AuditPageCursor,
  type AuditSnapshotTokenPayload,
  type AuditTokenPrincipal,
} from "./audit-explorer.port";

const SNAPSHOT_SCOPE_KIND = "cra.audit.snapshot.scope.v1";
const PAGE_OPERATION_KIND = "cra.audit.page.v1";
const DETAIL_OPERATION_KIND = "cra.audit.detail.v1";
const VERIFY_OPERATION_KIND = "cra.audit.verify.v1";
const GRANT_SECONDS = 5 * 60;

export class AuditExplorerUseCases {
  constructor(
    private readonly repository: AuditExplorerRepository,
    private readonly tokens: AuditExplorerTokenCodec,
  ) {}

  async createSnapshot(
    user: RequestUser,
    input: AuditSearchInput,
  ): Promise<AuditSnapshot> {
    const principal = this.principal(user);
    const permissionState = await this.repository.effectivePermissions(
      principal.organizationId,
      principal.actorId,
      this.baseRole(user),
    );
    const sourcePolicy = buildAuditSourcePolicy(
      permissionState.permissions,
      input.filters,
    );
    const filterDigest = this.tokens.digest(input.filters);
    const scopeDigest = this.tokens.digest({
      kind: SNAPSHOT_SCOPE_KIND,
      permissionsVersion: permissionState.version,
      allowedEntityTypes: sourcePolicy.allowedEntityTypes,
    });
    const receipt = await this.repository.createSnapshot({
      organizationId: principal.organizationId,
      actorId: principal.actorId,
      requestId: input.requestId,
      filterDigest,
      scopeDigest,
    });
    return {
      snapshotToken: this.tokens.snapshot({
        kind: "snapshot",
        ...principal,
        requestId: input.requestId,
        receiptId: receipt.receiptId,
        highWaterSequence: receipt.highWaterSequence,
        expiresAt: receipt.expiresAt,
        filterDigest: receipt.filterDigest,
        scopeDigest: receipt.scopeDigest,
        scopeVersion: receipt.scopeVersion,
        filters: input.filters,
      }),
      expiresAt: receipt.expiresAt,
      filters: input.filters,
    };
  }

  async page(
    user: RequestUser,
    snapshotToken: string,
    query: AuditPageQuery,
  ): Promise<AuditPage> {
    const principal = this.principal(user);
    const snapshot = this.openSnapshot(snapshotToken, principal);
    const sourcePolicy = await this.currentSourcePolicy(user, snapshot.filters);
    const cursor = query.cursor
      ? this.openCursor(query.cursor, principal)
      : null;
    if (cursor && cursor.receiptId !== snapshot.receiptId)
      throw new AuditExplorerForbiddenError();
    await this.repository.recordAccess({
      organizationId: principal.organizationId,
      actorId: principal.actorId,
      requestId: query.requestId,
      action: "audit.search.page",
      receiptId: snapshot.receiptId,
      operationDigest: this.tokens.digest({
        kind: PAGE_OPERATION_KIND,
        requestId: query.requestId,
        cursor: query.cursor ?? null,
        limit: query.limit,
      }),
    });
    const page = await this.repository.readPage({
      organizationId: principal.organizationId,
      actorId: principal.actorId,
      receiptId: snapshot.receiptId,
      filterDigest: snapshot.filterDigest,
      scopeDigest: snapshot.scopeDigest,
      filters: snapshot.filters,
      allowedEntityTypes: sourcePolicy.allowedEntityTypes,
      cursor: cursorToRead(cursor),
      limit: query.limit,
    });
    return {
      items: page.items,
      nextCursor: page.lastCursor
        ? this.tokens.cursor({
            kind: "cursor",
            ...principal,
            requestId: snapshot.requestId,
            receiptId: snapshot.receiptId,
            ...page.lastCursor,
          })
        : null,
    };
  }

  async detail(
    user: RequestUser,
    snapshotToken: string,
    eventId: string,
    query: AuditOperationQuery,
  ): Promise<AuditDetail> {
    const principal = this.principal(user);
    const snapshot = this.openSnapshot(snapshotToken, principal);
    const sourcePolicy = await this.currentSourcePolicy(user, snapshot.filters);
    await this.repository.recordAccess({
      organizationId: principal.organizationId,
      actorId: principal.actorId,
      requestId: query.requestId,
      action: "audit.search.detail",
      receiptId: snapshot.receiptId,
      operationDigest: this.tokens.digest({
        kind: DETAIL_OPERATION_KIND,
        eventId,
      }),
    });
    return this.repository.readDetail({
      organizationId: principal.organizationId,
      actorId: principal.actorId,
      receiptId: snapshot.receiptId,
      filterDigest: snapshot.filterDigest,
      scopeDigest: snapshot.scopeDigest,
      filters: snapshot.filters,
      allowedEntityTypes: sourcePolicy.allowedEntityTypes,
      eventId,
    });
  }

  async verify(
    user: RequestUser,
    snapshotToken: string,
    input: AuditVerificationInput,
  ): Promise<AuditVerificationResult> {
    const principal = this.principal(user);
    const snapshot = this.openSnapshot(snapshotToken, principal);
    const sourcePolicy = await this.currentSourcePolicy(user, snapshot.filters);
    await this.repository.recordAccess({
      organizationId: principal.organizationId,
      actorId: principal.actorId,
      requestId: input.requestId,
      action: "audit.search.verify",
      receiptId: snapshot.receiptId,
      operationDigest: this.tokens.digest({
        kind: VERIFY_OPERATION_KIND,
        eventIds: [...input.eventIds].sort(),
      }),
    });
    return this.repository.verify({
      organizationId: principal.organizationId,
      actorId: principal.actorId,
      receiptId: snapshot.receiptId,
      filterDigest: snapshot.filterDigest,
      scopeDigest: snapshot.scopeDigest,
      filters: snapshot.filters,
      allowedEntityTypes: sourcePolicy.allowedEntityTypes,
      eventIds: input.eventIds,
    });
  }

  async createExport(
    user: RequestUser,
    input: AuditExportInput,
  ): Promise<AuditExportJob> {
    const principal = this.principal(user);
    const snapshot = this.tokens.openSnapshot(input.snapshotToken, principal);
    const sourcePolicy = await this.currentSourcePolicy(user, snapshot.filters);
    return this.repository.createExport({
      organizationId: principal.organizationId,
      actorId: principal.actorId,
      requestId: input.requestId,
      receiptId: snapshot.receiptId,
      filters: snapshot.filters,
      allowedEntityTypes: sourcePolicy.allowedEntityTypes,
      filterDigest: snapshot.filterDigest,
      scopeDigest: snapshot.scopeDigest,
      format: input.format,
    });
  }

  async getExport(
    user: RequestUser,
    jobId: string,
    query: AuditOperationQuery,
  ): Promise<AuditExportJob> {
    const principal = this.principal(user);
    return this.repository.getExport({
      organizationId: principal.organizationId,
      actorId: principal.actorId,
      requestId: query.requestId,
      jobId,
    });
  }

  async issueDownloadGrant(
    user: RequestUser,
    jobId: string,
    query: AuditOperationQuery,
  ): Promise<{
    grant: AuditDownloadGrant;
    cookieValue: string;
    cookieMaxAge: number;
  }> {
    const principal = this.principal(user);
    const job = await this.repository.getExport({
      organizationId: principal.organizationId,
      actorId: principal.actorId,
      requestId: query.requestId,
      jobId,
    });
    if (job.status !== "ready" || !job.packageHash)
      throw new AuditExplorerForbiddenError();
    const randomDigest = this.tokens.randomDigest();
    const expiresAt = new Date(Date.now() + GRANT_SECONDS * 1000).toISOString();
    const permissionState = await this.repository.effectivePermissions(
      principal.organizationId,
      principal.actorId,
      this.baseRole(user),
    );
    const permissionFingerprint = this.tokens.digest({
      permissions: permissionState.permissions,
      version: permissionState.version,
    });
    const cookieValue = this.tokens.downloadGrant({
      kind: "download",
      ...principal,
      requestId: query.requestId,
      jobId,
      packageHash: job.packageHash,
      permissionFingerprint,
      randomDigest,
      expiresAt,
    });
    await this.repository.issueDownloadGrant({
      organizationId: principal.organizationId,
      actorId: principal.actorId,
      requestId: query.requestId,
      jobId,
      sessionId: principal.sessionId,
      grantDigest: this.tokens.digest({
        jobId,
        randomDigest,
        packageHash: job.packageHash,
      }),
    });
    return {
      grant: {
        url: `/api/v1/audit/exports/${jobId}/download`,
        expiresAt,
        packageHash: job.packageHash,
      },
      cookieValue,
      cookieMaxAge: GRANT_SECONDS,
    };
  }

  async download(
    user: RequestUser,
    jobId: string,
    requestId: string,
    cookieValue: string | undefined,
  ) {
    if (!cookieValue) throw new AuditExplorerForbiddenError();
    const principal = this.principal(user);
    const grant = this.openDownloadGrant(cookieValue, principal);
    if (grant.jobId !== jobId) throw new AuditExplorerForbiddenError();
    const packageRef = await this.repository.redeemDownloadGrant({
      organizationId: principal.organizationId,
      actorId: principal.actorId,
      requestId,
      jobId,
      sessionId: principal.sessionId,
      grantDigest: this.tokens.digest({
        jobId,
        randomDigest: grant.randomDigest,
        packageHash: grant.packageHash,
      }),
    });
    if (packageRef.packageHash !== grant.packageHash)
      throw new AuditExplorerStaleError();
    return this.repository.downloadPackage({
      organizationId: principal.organizationId,
      jobId,
      packageHash: packageRef.packageHash,
      objectPath: packageRef.objectPath,
      bytes: packageRef.bytes,
    });
  }

  private async currentSourcePolicy(
    user: RequestUser,
    filters: AuditSearchInput["filters"],
  ) {
    const principal = this.principal(user);
    const permissionState = await this.repository.effectivePermissions(
      principal.organizationId,
      principal.actorId,
      this.baseRole(user),
    );
    return buildAuditSourcePolicy(permissionState.permissions, filters);
  }

  private openSnapshot(
    token: string,
    principal: AuditTokenPrincipal,
  ): AuditSnapshotTokenPayload {
    try {
      return this.tokens.openSnapshot(token, principal);
    } catch (error) {
      throw tokenError(error);
    }
  }

  private openCursor(
    token: string,
    principal: AuditTokenPrincipal,
  ): AuditCursorTokenPayload {
    try {
      return this.tokens.openCursor(token, principal);
    } catch (error) {
      throw tokenError(error);
    }
  }

  private openDownloadGrant(
    token: string,
    principal: AuditTokenPrincipal,
  ): AuditDownloadGrantPayload {
    try {
      return this.tokens.openDownloadGrant(token, principal);
    } catch (error) {
      throw tokenError(error);
    }
  }

  private principal(user: RequestUser) {
    if (!user.organizationId || !user.sessionId)
      throw new AuditExplorerForbiddenError();
    return {
      organizationId: user.organizationId,
      actorId: user.id,
      sessionId: user.sessionId,
    };
  }

  private baseRole(user: RequestUser) {
    if (!user.role) throw new AuditExplorerForbiddenError();
    return user.role;
  }
}

function cursorToRead(
  cursor: {
    afterSequence: string | null;
    afterCreatedAt: string | null;
    afterId: string;
  } | null,
): AuditPageCursor {
  return {
    afterSequence: cursor?.afterSequence ?? null,
    afterCreatedAt: cursor?.afterCreatedAt ?? null,
    afterId: cursor?.afterId ?? null,
  };
}

function tokenError(error: unknown): Error {
  if (error instanceof Error && error.message === "token expired") {
    return new AuditExplorerStaleError();
  }
  return new AuditExplorerForbiddenError();
}
