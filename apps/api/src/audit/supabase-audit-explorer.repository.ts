import { Injectable } from "@nestjs/common";
import {
  auditDetailSchema,
  auditEventViewSchema,
  auditExportJobSchema,
  auditExportManifestSchema,
  auditVerificationResultSchema,
} from "@repo/contracts/audit/schemas";
import type { BaseRole, AssignedCustomRole } from "@repo/contracts/permissions";
import { resolveEffectivePermissions } from "@repo/contracts/permissions";
import { z } from "zod";

import { SupabaseService } from "../supabase/supabase.service";
import { SupabaseAuditExportStorageAdapter } from "./infrastructure/audit-export-storage.adapter";
import {
  AuditExplorerConflictError,
  AuditExplorerForbiddenError,
  AuditExplorerNotFoundError,
  AuditExplorerStaleError,
  AuditExplorerUnavailableError,
} from "./audit-explorer.errors";
import type {
  AuditAccessReceipt,
  AuditExplorerPermissions,
  AuditExplorerRepository,
  AuditPageRead,
  AuditSnapshotReceipt,
} from "./application/audit-explorer.port";
import type { AuditExportJob } from "@repo/contracts/audit/types";

const snapshotReceiptSchema = z
  .object({
    receiptId: z.uuid(),
    highWaterSequence: z.string().regex(/^(0|[1-9][0-9]*)$/),
    expiresAt: z.iso.datetime({ offset: true }),
    filterDigest: z.string().regex(/^[0-9a-f]{64}$/),
    scopeDigest: z.string().regex(/^[0-9a-f]{64}$/),
    scopeVersion: z.coerce.string().regex(/^(0|[1-9][0-9]*)$/),
  })
  .strict();

const accessReceiptSchema = z
  .object({ receiptId: z.uuid(), replayed: z.boolean() })
  .strict();

const rawPageSchema = z.array(
  z
    .object({
      event: auditEventViewSchema,
      afterSequence: z.string().nullable(),
      afterCreatedAt: z.iso.datetime({ offset: true }).nullable(),
      afterId: z.uuid(),
    })
    .strict(),
);

const downloadGrantJobSchema = z
  .object({
    artifact: z
      .object({
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        objectPath: z.string().min(1).max(600),
        bytes: z.coerce.number().int().positive().max(268435456),
        contentType: z.literal("application/zip"),
        manifest: auditExportManifestSchema,
      })
      .strip(),
  })
  .passthrough();

@Injectable()
export class SupabaseAuditExplorerRepository implements AuditExplorerRepository {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly storage: SupabaseAuditExportStorageAdapter,
  ) {}

  async effectivePermissions(
    orgId: string,
    actorId: string,
    baseRole: BaseRole,
  ): Promise<AuditExplorerPermissions> {
    const client = this.supabase.admin();
    const [rolesResult, overridesResult, versionResult] = await Promise.all([
      client
        .from("user_role_assignments")
        .select(
          "custom_roles(id,name,base_role,permissions,is_active,is_deleted)",
        )
        .eq("organization_id", orgId)
        .eq("user_id", actorId),
      client
        .from("base_role_permission_overrides")
        .select("permissions")
        .eq("organization_id", orgId)
        .eq("base_role", baseRole)
        .maybeSingle(),
      client
        .from("organization_permissions_version")
        .select("version")
        .eq("organization_id", orgId)
        .maybeSingle(),
    ]);
    if (rolesResult.error || overridesResult.error || versionResult.error) {
      throw new AuditExplorerUnavailableError();
    }
    const customRoles = (
      (rolesResult.data ?? []) as Array<{
        custom_roles?: AssignedCustomRole | AssignedCustomRole[] | null;
      }>
    ).flatMap((row) => {
      const value = row.custom_roles;
      if (!value) return [];
      return Array.isArray(value) ? value : [value];
    });
    return {
      permissions: resolveEffectivePermissions({
        baseRole,
        customRoles,
        baseRoleOverrides: overridesResult.data?.permissions,
      }),
      version: String(versionResult.data?.version ?? 0),
    };
  }

  async createSnapshot(input: {
    organizationId: string;
    actorId: string;
    requestId: string;
    filterDigest: string;
    scopeDigest: string;
  }): Promise<AuditSnapshotReceipt> {
    const data = await this.rpc("m13_03_create_snapshot", {
      p_organization_id: input.organizationId,
      p_actor_user_id: input.actorId,
      p_request_id: input.requestId,
      p_filter_digest: input.filterDigest,
      p_scope_digest: input.scopeDigest,
    });
    return snapshotReceiptSchema.parse(data);
  }

  async recordDenial(input: {
    organizationId: string;
    actorId: string;
    requestId: string;
    operationDigest: string;
  }): Promise<AuditAccessReceipt> {
    const data = await this.rpc("m13_03_record_denial", {
      p_organization_id: input.organizationId,
      p_actor_user_id: input.actorId,
      p_request_id: input.requestId,
      p_operation_digest: input.operationDigest,
    });
    return accessReceiptSchema.parse(data);
  }

  async recordAccess(input: {
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
  }): Promise<AuditAccessReceipt> {
    const data = await this.rpc("m13_03_record_access", {
      p_organization_id: input.organizationId,
      p_actor_user_id: input.actorId,
      p_request_id: input.requestId,
      p_action: input.action,
      p_receipt_id: input.receiptId,
      p_operation_digest: input.operationDigest,
    });
    return accessReceiptSchema.parse(data);
  }

  async readPage(
    input: Parameters<AuditExplorerRepository["readPage"]>[0],
  ): Promise<AuditPageRead> {
    const data = await this.rpc("m13_03_read_page", {
      p_organization_id: input.organizationId,
      p_actor_user_id: input.actorId,
      p_receipt_id: input.receiptId,
      p_filter_digest: input.filterDigest,
      p_scope_digest: input.scopeDigest,
      p_filters: input.filters,
      p_allowed_entity_types: [...input.allowedEntityTypes],
      p_after_sequence: input.cursor.afterSequence,
      p_after_created_at: input.cursor.afterCreatedAt,
      p_after_id: input.cursor.afterId,
      p_limit: input.limit,
    });
    const rows = rawPageSchema.parse(data);
    const last = rows.at(-1) ?? null;
    return {
      items: rows.map((row) => row.event),
      lastCursor: last
        ? {
            afterSequence: last.afterSequence,
            afterCreatedAt: last.afterCreatedAt,
            afterId: last.afterId,
          }
        : null,
    };
  }

  async readDetail(
    input: Parameters<AuditExplorerRepository["readDetail"]>[0],
  ) {
    const data = await this.rpc("m13_03_read_detail", {
      p_organization_id: input.organizationId,
      p_actor_user_id: input.actorId,
      p_receipt_id: input.receiptId,
      p_filter_digest: input.filterDigest,
      p_scope_digest: input.scopeDigest,
      p_filters: input.filters,
      p_allowed_entity_types: [...input.allowedEntityTypes],
      p_event_id: input.eventId,
    });
    return auditDetailSchema.parse(data);
  }

  async verify(input: Parameters<AuditExplorerRepository["verify"]>[0]) {
    const data = await this.rpc("m13_03_verify_events", {
      p_organization_id: input.organizationId,
      p_actor_user_id: input.actorId,
      p_receipt_id: input.receiptId,
      p_filter_digest: input.filterDigest,
      p_scope_digest: input.scopeDigest,
      p_filters: input.filters,
      p_allowed_entity_types: [...input.allowedEntityTypes],
      p_event_ids: [...input.eventIds],
    });
    return auditVerificationResultSchema.parse(data);
  }

  async createExport(
    input: Parameters<AuditExplorerRepository["createExport"]>[0],
  ): Promise<AuditExportJob> {
    const data = await this.rpc("m13_03_create_export", {
      p_organization_id: input.organizationId,
      p_actor_user_id: input.actorId,
      p_request_id: input.requestId,
      p_receipt_id: input.receiptId,
      p_filters: {
        ...input.filters,
        allowedEntityTypes: [...input.allowedEntityTypes],
      },
      p_filter_digest: input.filterDigest,
      p_scope_digest: input.scopeDigest,
      p_format: input.format,
    });
    return parseJob(data);
  }

  async getExport(
    input: Parameters<AuditExplorerRepository["getExport"]>[0],
  ): Promise<AuditExportJob> {
    const data = await this.rpc("m13_03_get_export", {
      p_organization_id: input.organizationId,
      p_actor_user_id: input.actorId,
      p_job_id: input.jobId,
      p_request_id: input.requestId,
    });
    return parseJob(data);
  }

  async issueDownloadGrant(
    input: Parameters<AuditExplorerRepository["issueDownloadGrant"]>[0],
  ): Promise<AuditExportJob> {
    const data = await this.rpc("m13_03_issue_download_grant", {
      p_organization_id: input.organizationId,
      p_actor_user_id: input.actorId,
      p_job_id: input.jobId,
      p_session_id: input.sessionId,
      p_digest: input.grantDigest,
      p_request_id: input.requestId,
    });
    return parseJob(data);
  }

  async redeemDownloadGrant(
    input: Parameters<AuditExplorerRepository["redeemDownloadGrant"]>[0],
  ) {
    const data = await this.rpc("m13_03_redeem_download_grant", {
      p_organization_id: input.organizationId,
      p_actor_user_id: input.actorId,
      p_job_id: input.jobId,
      p_session_id: input.sessionId,
      p_digest: input.grantDigest,
      p_request_id: input.requestId,
    });
    const parsed = downloadGrantJobSchema.parse(data);
    return {
      packageHash: parsed.artifact.sha256,
      objectPath: parsed.artifact.objectPath,
      bytes: parsed.artifact.bytes,
    };
  }

  async downloadPackage(
    input: Parameters<AuditExplorerRepository["downloadPackage"]>[0],
  ) {
    const expectedPath = `${input.organizationId}/${input.jobId}/${input.packageHash}.zip`;
    if (input.objectPath !== expectedPath)
      throw new AuditExplorerForbiddenError();
    const opened = await this.storage.openVerified({
      objectPath: input.objectPath,
      sha256: input.packageHash,
      byteSize: input.bytes,
    });
    if (!opened) throw new AuditExplorerUnavailableError();
    return {
      body: opened.stream(),
      contentLength: opened.byteSize,
      packageHash: opened.sha256,
      cleanup: opened.cleanup,
    };
  }

  private async rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const { data, error } = await this.supabase
      .admin()
      .rpc(name as never, args as never);
    if (error) throw mapRpcError(error);
    return data;
  }
}

function parseJob(value: unknown): AuditExportJob {
  const row = z
    .object({
      id: z.uuid(),
      state: z.enum(["queued", "processing", "ready", "failed", "expired"]),
      format: z.enum(["csv", "json"]),
      created_at: z.iso.datetime({ offset: true }),
      expires_at: z.iso.datetime({ offset: true }).nullable(),
      row_count: z.coerce.number().int().min(0).max(100000).optional(),
      selected_event_ids: z.array(z.uuid()).optional(),
      artifact: z
        .object({ sha256: z.string().regex(/^[0-9a-f]{64}$/) })
        .passthrough()
        .nullable()
        .optional(),
      failure_code: auditExportJobSchema.shape.failureCode,
    })
    .passthrough()
    .parse(value);
  return auditExportJobSchema.parse({
    id: row.id,
    status: exportStatus(row.state, row.expires_at),
    format: row.format,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    rowCount: row.row_count ?? row.selected_event_ids?.length ?? null,
    packageHash: row.artifact?.sha256 ?? null,
    failureCode: row.failure_code ?? null,
  });
}

function exportStatus(
  state: "queued" | "processing" | "ready" | "failed" | "expired",
  expiresAt: string | null,
) {
  if (state === "ready" && expiresAt && Date.parse(expiresAt) <= Date.now()) {
    return "expired";
  }
  return state;
}

function mapRpcError(error: { code?: string; message?: string }): Error {
  const message = error.message ?? "";
  if (error.code === "40001" || message.includes("scope_changed")) {
    return new AuditExplorerStaleError();
  }
  if (error.code === "23505" || message.includes("request_conflict")) {
    return new AuditExplorerConflictError();
  }
  if (
    error.code === "P0002" ||
    message.includes("not_found") ||
    message.includes("unavailable") ||
    message.includes("denied")
  ) {
    return new AuditExplorerNotFoundError();
  }
  if (error.code === "42501") return new AuditExplorerNotFoundError();
  return new AuditExplorerUnavailableError();
}
