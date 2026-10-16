import { Injectable } from "@nestjs/common";
import {
  organizationExportSchema,
  organizationLifecycleSchema,
  organizationSettingsCatalogSchema,
  organizationSettingsSchema,
  retentionPolicySchema,
  retentionPolicySetSchema,
  type DeactivateOrganizationInput,
  type OrganizationExport,
  type RecoverOrganizationInput,
  type RetentionPolicyUpdateInput,
  type ScheduleOrganizationPurgeInput,
  type UpdateOrganizationSettingsInput,
} from "@repo/contracts/organizations";

import type { CraSupabaseClient } from "../../../supabase/supabase.service";
import { SupabaseService } from "../../../supabase/supabase.service";
import {
  TenantAdministrationProviderError,
  type ExportRequestOutcome,
  type LifecycleMutationOutcome,
  type ReauthenticationGrantOutcome,
  type RetentionWriteOutcome,
  type SettingsWriteOutcome,
  type TenantAdministrationRepository,
} from "../application/tenant-administration-use-cases";

type ProviderRow = Readonly<Record<string, unknown>>;
type ProviderResult = Readonly<{
  data: unknown;
  error: Readonly<{ message: string }> | null;
}>;

const SAFE_ERROR_MESSAGE =
  "Organization administration request could not be completed.";

const SETTINGS_READ_OUTCOMES = new Set(["found", "not_found"]);
const SETTINGS_WRITE_OUTCOMES = new Set([
  "updated",
  "conflict",
  "invalid_catalog",
  "not_found",
]);
const RETENTION_WRITE_OUTCOMES = new Set([
  "updated",
  "conflict",
  "invalid_request",
  "not_found",
]);
const EXPORT_REQUEST_OUTCOMES = new Set([
  "created",
  "replayed",
  "idempotency_mismatch",
  "invalid_request",
  "not_found",
]);
const LIFECYCLE_READ_OUTCOMES = new Set(["found", "not_found"]);
const GRANT_OUTCOMES = new Set(["created", "not_found"]);
const DEACTIVATE_OUTCOMES = new Set([
  "deactivated",
  "invalid_grant",
  "invalid_request",
  "conflict",
  "invalid_state",
  "not_found",
]);
const RECOVER_OUTCOMES = new Set([
  "recovered",
  "invalid_grant",
  "conflict",
  "invalid_state",
  "not_found",
]);
const PURGE_OUTCOMES = new Set([
  "scheduled",
  "invalid_grant",
  "invalid_request",
  "conflict",
  "invalid_state",
  "not_found",
]);

/** Service-role adapter; every tenant read carries organizationId first. */
@Injectable()
export class SupabaseTenantAdministrationRepository implements TenantAdministrationRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async getSettings(organizationId: string) {
    const result = await this.rpc(
      this.client().rpc("get_organization_settings", {
        p_organization_id: organizationId,
      }),
    );
    const row = this.singleRow(result);
    const outcome = this.outcome(row, SETTINGS_READ_OUTCOMES);
    if (outcome === "not_found") return Object.freeze({ outcome });
    if (outcome !== "found") throw this.malformed();
    return Object.freeze({
      outcome,
      settings: this.parse(organizationSettingsSchema, row.settings),
    });
  }

  async getSettingsCatalog(organizationId: string) {
    const result = await this.rpc(
      this.client().rpc("get_organization_settings_catalog", {
        p_organization_id: organizationId,
      }),
    );
    const row = this.singleRow(result);
    const outcome = this.outcome(row, SETTINGS_READ_OUTCOMES);
    if (outcome === "not_found") return Object.freeze({ outcome });
    if (outcome !== "found") throw this.malformed();
    return Object.freeze({
      outcome,
      catalog: this.parse(organizationSettingsCatalogSchema, row.catalog),
    });
  }

  async updateSettings(
    organizationId: string,
    actorId: string,
    sessionId: string,
    input: UpdateOrganizationSettingsInput,
  ): Promise<SettingsWriteOutcome> {
    // PostgREST accepts SQL NULL here although generated nullable RPC arguments
    // are represented as strings. Keep that narrow bridge inside this adapter.
    const nullableMfaDate = input.values
      .mfaEnforcementDate as unknown as string;
    const result = await this.rpc(
      this.client().rpc("update_organization_settings_atomic", {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_expected_version: input.expectedVersion,
        p_timezone: input.values.timezone,
        p_working_days: [...input.values.workingDays],
        p_holidays: [...input.values.holidays],
        p_notification_channel_ids: [...input.values.notificationChannelIds],
        p_mfa_enforcement_date: nullableMfaDate,
        p_maximum_session_age_minutes: input.values.maximumSessionAgeMinutes,
        p_ai_provider_id: input.values.aiProviderId,
        p_data_residency_id: input.values.dataResidencyId,
        p_session_id: sessionId,
      }),
    );
    const row = this.singleRow(result);
    const outcome = this.outcome(row, SETTINGS_WRITE_OUTCOMES);
    if (outcome === "not_found") return Object.freeze({ outcome });
    if (outcome === "invalid_catalog") {
      return Object.freeze({ outcome: "invalid_request" });
    }
    if (outcome !== "updated" && outcome !== "conflict") {
      throw this.malformed();
    }
    const settings = this.parse(organizationSettingsSchema, row.settings);
    if (outcome === "conflict") return Object.freeze({ outcome, settings });
    if (typeof row.session_policy_tightened !== "boolean") {
      throw this.malformed();
    }
    return Object.freeze({
      outcome,
      settings,
      sessionPolicyTightened: row.session_policy_tightened,
    });
  }

  async getRetentionPolicies(organizationId: string) {
    const result = await this.rpc(
      this.client().rpc("get_organization_retention_policies", {
        p_organization_id: organizationId,
      }),
    );
    const row = this.singleRow(result);
    const outcome = this.outcome(row, SETTINGS_READ_OUTCOMES);
    if (outcome === "not_found") return Object.freeze({ outcome });
    if (outcome !== "found") throw this.malformed();
    return Object.freeze({
      outcome,
      policies: Object.freeze([
        ...this.parse(retentionPolicySetSchema, row.policies),
      ]),
    });
  }

  async updateRetentionPolicy(
    organizationId: string,
    actorId: string,
    input: RetentionPolicyUpdateInput,
  ): Promise<RetentionWriteOutcome> {
    const result = await this.rpc(
      this.client().rpc("update_organization_retention_policy_atomic", {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_evidence_class: input.evidenceClass,
        p_expected_version: input.expectedVersion,
        p_requested_retention_days: input.requestedRetentionDays,
      }),
    );
    const row = this.singleRow(result);
    const outcome = this.outcome(row, RETENTION_WRITE_OUTCOMES);
    if (outcome === "not_found" || outcome === "invalid_request") {
      return Object.freeze({ outcome });
    }
    if (outcome !== "updated" && outcome !== "conflict") {
      throw this.malformed();
    }
    return Object.freeze({
      outcome,
      policy: this.parse(retentionPolicySchema, row.policy),
    });
  }

  async requestExport(
    organizationId: string,
    actorId: string,
    idempotencyKey: string,
    requestDigest: string,
    correlationId: string,
  ): Promise<ExportRequestOutcome> {
    const result = await this.rpc(
      this.client().rpc("request_organization_export_atomic", {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_idempotency_key: idempotencyKey,
        p_request_digest: requestDigest,
        p_correlation_id: correlationId,
      }),
    );
    const row = this.singleRow(result);
    const outcome = this.outcome(row, EXPORT_REQUEST_OUTCOMES);
    if (outcome === "idempotency_mismatch") {
      return Object.freeze({ outcome: "conflict" });
    }
    if (outcome === "invalid_request" || outcome === "not_found") {
      return Object.freeze({ outcome });
    }
    if (outcome !== "created" && outcome !== "replayed") {
      throw this.malformed();
    }
    const exportId = this.requiredString(row, "export_job_id");
    const committed = await this.getExport(organizationId, exportId);
    if (committed.outcome !== "found" || typeof row.idempotent !== "boolean") {
      throw this.malformed();
    }
    return Object.freeze({
      outcome,
      export: committed.value,
      idempotent: row.idempotent,
    });
  }

  async getExport(organizationId: string, exportId: string) {
    const result = await this.query(
      this.client()
        .from("organization_export_jobs")
        .select(
          "id, status, completed_parts, total_parts, manifest_format_version, manifest_sha256, manifest_file_count, verified_at, created_at, updated_at, safe_error_code",
        )
        .eq("organization_id", organizationId)
        .eq("id", exportId)
        .maybeSingle(),
    );
    if (!result.data) return Object.freeze({ outcome: "not_found" as const });
    const row = this.recordOrFail(result.data);
    return Object.freeze({
      outcome: "found" as const,
      value: this.publicExport(row),
    });
  }

  async getLatestExport(
    organizationId: string,
  ): Promise<OrganizationExport | null> {
    const result = await this.query(
      this.client()
        .from("organization_export_jobs")
        .select(
          "id, status, completed_parts, total_parts, manifest_format_version, manifest_sha256, manifest_file_count, verified_at, created_at, updated_at, safe_error_code",
        )
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    );
    if (!result.data) return null;
    return this.publicExport(this.recordOrFail(result.data));
  }

  async getLifecycle(organizationId: string) {
    const result = await this.rpc(
      this.client().rpc("get_organization_lifecycle", {
        p_organization_id: organizationId,
      }),
    );
    const row = this.singleRow(result);
    const outcome = this.outcome(row, LIFECYCLE_READ_OUTCOMES);
    if (outcome === "not_found") return Object.freeze({ outcome });
    if (outcome !== "found") throw this.malformed();
    return Object.freeze({
      outcome,
      lifecycle: this.parse(organizationLifecycleSchema, row.lifecycle),
    });
  }

  async createReauthenticationGrant(
    organizationId: string,
    actorId: string,
    sessionId: string,
    lifecycleVersion: number,
    expiresAt: string,
  ): Promise<ReauthenticationGrantOutcome> {
    const result = await this.rpc(
      this.client().rpc("create_destructive_reauth_grant_atomic", {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_session_id: sessionId,
        p_lifecycle_version: lifecycleVersion,
        p_expires_at: expiresAt,
      }),
    );
    const row = this.singleRow(result);
    const outcome = this.outcome(row, GRANT_OUTCOMES);
    if (outcome === "not_found") return Object.freeze({ outcome });
    if (outcome !== "created") throw this.malformed();
    return Object.freeze({
      outcome,
      reauthenticationGrantId: this.requiredString(row, "grant_id"),
      expiresAt: this.requiredString(row, "expires_at"),
    });
  }

  async deactivate(
    organizationId: string,
    actorId: string,
    sessionId: string,
    input: DeactivateOrganizationInput,
  ): Promise<LifecycleMutationOutcome> {
    const result = await this.rpc(
      this.client().rpc("deactivate_organization_atomic", {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_session_id: sessionId,
        p_reauth_grant_id: input.reauthenticationGrantId,
        p_expected_version: input.expectedVersion,
        p_confirmation: input.confirmation,
      }),
    );
    return this.lifecycleMutation(result, DEACTIVATE_OUTCOMES, "deactivated");
  }

  async schedulePurge(
    organizationId: string,
    actorId: string,
    sessionId: string,
    input: ScheduleOrganizationPurgeInput,
  ): Promise<LifecycleMutationOutcome> {
    const result = await this.rpc(
      this.client().rpc("schedule_organization_purge_atomic", {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_session_id: sessionId,
        p_reauth_grant_id: input.reauthenticationGrantId,
        p_expected_version: input.expectedVersion,
        p_confirmation: input.confirmation,
      }),
    );
    return this.lifecycleMutation(result, PURGE_OUTCOMES, "scheduled");
  }

  async recover(
    organizationId: string,
    actorId: string,
    sessionId: string,
    input: RecoverOrganizationInput,
  ): Promise<LifecycleMutationOutcome> {
    const result = await this.rpc(
      this.client().rpc("recover_organization_atomic", {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_session_id: sessionId,
        p_reauth_grant_id: input.reauthenticationGrantId,
        p_expected_version: input.expectedVersion,
      }),
    );
    return this.lifecycleMutation(result, RECOVER_OUTCOMES, "recovered");
  }

  private lifecycleMutation(
    result: ProviderResult,
    allowed: ReadonlySet<string>,
    successOutcome: string,
  ): LifecycleMutationOutcome {
    const row = this.singleRow(result);
    const outcome = this.outcome(row, allowed);
    if (outcome !== successOutcome) {
      return Object.freeze({
        outcome: outcome as Exclude<
          LifecycleMutationOutcome["outcome"],
          "updated"
        >,
      });
    }
    return Object.freeze({
      outcome: "updated",
      lifecycle: this.parse(organizationLifecycleSchema, row.lifecycle),
    });
  }

  private publicExport(row: ProviderRow): OrganizationExport {
    const internalStatus = this.requiredString(row, "status");
    const status =
      internalStatus === "paused" || internalStatus === "dead_letter"
        ? "failed"
        : internalStatus;
    const manifest =
      status === "completed"
        ? {
            formatVersion: row.manifest_format_version,
            sha256: row.manifest_sha256,
            fileCount: row.manifest_file_count,
            verifiedAt: row.verified_at,
          }
        : null;
    const error =
      status === "failed"
        ? {
            code:
              row.safe_error_code === "verification_failed"
                ? "verification_failed"
                : "unavailable",
            message: SAFE_ERROR_MESSAGE,
          }
        : null;
    return this.parse(organizationExportSchema, {
      id: row.id,
      status,
      progress: {
        completedParts: row.completed_parts,
        totalParts: row.total_parts,
      },
      error,
      manifest,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private client(): CraSupabaseClient {
    return this.supabase.admin();
  }

  private async rpc(
    pending: PromiseLike<ProviderResult>,
  ): Promise<ProviderResult> {
    return this.query(pending);
  }

  private async query(
    pending: PromiseLike<ProviderResult>,
  ): Promise<ProviderResult> {
    try {
      const result = await pending;
      if (result.error)
        throw new TenantAdministrationProviderError("unavailable");
      return result;
    } catch (error) {
      if (error instanceof TenantAdministrationProviderError) throw error;
      throw new TenantAdministrationProviderError("unavailable");
    }
  }

  private singleRow(result: ProviderResult): ProviderRow {
    if (!Array.isArray(result.data) || result.data.length !== 1) {
      throw this.malformed();
    }
    return this.recordOrFail(result.data[0]);
  }

  private outcome(row: ProviderRow, allowed: ReadonlySet<string>): string {
    const outcome = this.requiredString(row, "outcome");
    if (!allowed.has(outcome)) throw this.malformed();
    return outcome;
  }

  private parse<T>(
    schema: Readonly<{
      safeParse(value: unknown): Readonly<{ success: boolean; data?: T }>;
    }>,
    value: unknown,
  ): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success || parsed.data === undefined) throw this.malformed();
    return Object.freeze(parsed.data);
  }

  private recordOrFail(value: unknown): ProviderRow {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw this.malformed();
    }
    return value as ProviderRow;
  }

  private requiredString(row: ProviderRow, key: string): string {
    const value = row[key];
    if (typeof value !== "string" || value.length === 0) throw this.malformed();
    return value;
  }

  private malformed(): TenantAdministrationProviderError {
    return new TenantAdministrationProviderError("malformed");
  }
}
