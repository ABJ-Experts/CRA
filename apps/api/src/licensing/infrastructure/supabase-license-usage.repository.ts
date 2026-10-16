import { Injectable } from "@nestjs/common";
import { z } from "zod";
import type { LicenseUsageSnapshot } from "@repo/contracts/licensing/types";
import { SupabaseService } from "../../supabase/supabase.service";
import {
  usageExportResultSchema,
  usageReadResultSchema,
  usageReceiptResultSchema,
  usageReconcileResultSchema,
  type LicenseUsagePort,
  type UsageCommand,
  type UsageOperation,
} from "../application/license-usage.port";
import { usageFailure } from "../application/license-usage.errors";
import { LicensingError } from "../application/licensing.errors";

interface RpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
const databaseTimestampSchema = z.iso.datetime({ offset: true });
const timestampKeys = new Set([
  "observedAt",
  "reconciledAt",
  "completedAt",
  "startsAt",
  "expiresAt",
  "graceEndsAt",
]);
/** Normalize only declared timestamp keys; all response values are schema checked next. */
function utc(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(utc);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      timestampKeys.has(key) &&
      typeof item === "string" &&
      databaseTimestampSchema.safeParse(item).success
        ? new Date(item).toISOString()
        : utc(item),
    ]),
  );
}
/** Every service-role RPC is explicitly tenant and current-actor scoped. */
@Injectable()
export class SupabaseLicenseUsageRepository implements LicenseUsagePort {
  constructor(private readonly supabase: SupabaseService) {}
  read(orgId: string, actorId: string, expectedLicenseVersion: number | null) {
    return this.rpc(
      "m15_02_read_usage",
      {
        p_organization_id: orgId,
        p_actor_user_id: actorId,
        p_expected_license_version: expectedLicenseVersion,
      },
      usageReadResultSchema,
    );
  }
  receipt(
    orgId: string,
    actorId: string,
    operation: UsageOperation,
    command: UsageCommand,
  ) {
    return this.rpc(
      "m15_02_usage_receipt",
      {
        p_organization_id: orgId,
        p_actor_user_id: actorId,
        p_operation: operation,
        p_idempotency_key: command.idempotencyKey,
        p_request_digest: command.requestDigest,
      },
      usageReceiptResultSchema,
    );
  }
  export(
    orgId: string,
    actorId: string,
    command: UsageCommand,
    snapshot: LicenseUsageSnapshot,
  ) {
    return this.rpc(
      "m15_02_export_usage",
      { ...this.args(orgId, actorId, command), p_snapshot: snapshot },
      usageExportResultSchema,
    );
  }
  reconcile(orgId: string, actorId: string, command: UsageCommand) {
    return this.rpc(
      "m15_02_reconcile_usage",
      this.args(orgId, actorId, command),
      usageReconcileResultSchema,
    );
  }
  private args(
    orgId: string,
    actorId: string,
    command: UsageCommand,
  ): Record<string, unknown> {
    return {
      p_organization_id: orgId,
      p_actor_user_id: actorId,
      p_expected_license_version: command.expectedLicenseVersion,
      p_expected_meter_version: command.expectedMeterVersion,
      p_idempotency_key: command.idempotencyKey,
      p_request_digest: command.requestDigest,
    };
  }
  private async rpc<T>(
    name: string,
    args: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    try {
      const { data, error } = await (
        this.supabase.admin() as unknown as RpcClient
      ).rpc(name, args);
      if (error) {
        if (
          typeof error === "object" &&
          "code" in error &&
          error.code === "42501"
        )
          throw usageFailure("forbidden");
        throw usageFailure("unavailable");
      }
      const parsed = schema.safeParse(utc(data));
      if (!parsed.success) throw usageFailure("unavailable");
      return parsed.data;
    } catch (error) {
      if (error instanceof LicensingError) throw error;
      throw usageFailure("unavailable");
    }
  }
}
