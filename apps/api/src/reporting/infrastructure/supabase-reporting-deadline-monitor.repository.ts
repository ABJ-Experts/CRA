import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";

import { SupabaseService } from "../../supabase/supabase.service";
import type { ReportingDeadlineMonitorHealthReader } from "../application/reporting-deadline-monitor-health.port";
import {
  ReportingDeadlineMonitorFailure,
  type ReportingDeadlineDeliveryClaim,
  type ReportingDeadlineDeliveryDetails,
  type ReportingDeadlineMonitorDependencies,
} from "../worker/reporting-deadline-monitor-worker";

type ProviderRow = Readonly<Record<string, unknown>>;
type ProviderResult = Readonly<{ data: unknown; error: unknown }>;

const uuid = z.uuid();
const dateTime = z.string().datetime({ offset: true });
const outcomeSchema = z.string().trim().min(1).max(100);
const recipientSchema = z
  .object({ userId: uuid, email: z.string().email().max(320) })
  .passthrough();
const alertSchema = z
  .object({
    deliveryId: uuid,
    obligationId: uuid,
    stageKind: z.enum(["early_warning", "notification", "final_report"]),
    thresholdPercent: z.union([
      z.literal(50),
      z.literal(75),
      z.literal(90),
      z.literal(100),
    ]),
    dueAt: dateTime,
  })
  .passthrough();

const asRecord = (value: unknown): ProviderRow => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReportingDeadlineMonitorFailure("malformed_provider", false);
  }
  return value as ProviderRow;
};

const one = (value: unknown): ProviderRow => {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new ReportingDeadlineMonitorFailure("malformed_provider", false);
  }
  return asRecord(value[0]);
};

const outcome = (row: ProviderRow): string => {
  const parsed = outcomeSchema.safeParse(row.outcome);
  if (!parsed.success) {
    throw new ReportingDeadlineMonitorFailure("malformed_provider", false);
  }
  return parsed.data;
};

/**
 * Service-role adapter for the reporting deadline monitor. SQL owns every
 * queue transition and permission recheck; this class only parses provider
 * rows before a worker is allowed to act on them.
 */
@Injectable()
export class SupabaseReportingDeadlineMonitorRepository implements ReportingDeadlineMonitorHealthReader {
  private readonly logger = new Logger(
    SupabaseReportingDeadlineMonitorRepository.name,
  );

  constructor(private readonly supabase: SupabaseService) {}

  readonly clock: ReportingDeadlineMonitorDependencies["clock"] = Object.freeze(
    {
      databaseNow: async () => {
        const row = await this.rpc("get_reporting_deadline_monitor_now", {});
        if (typeof row.database_now !== "string") {
          throw new ReportingDeadlineMonitorFailure(
            "malformed_provider",
            false,
          );
        }
        const parsed = dateTime.safeParse(row.database_now);
        if (!parsed.success) {
          throw new ReportingDeadlineMonitorFailure(
            "malformed_provider",
            false,
          );
        }
        return new Date(parsed.data);
      },
      localNow: () => new Date(),
      observeSkew: async ({ databaseNow, skewMilliseconds, critical }) => {
        const row = await this.rpc(
          "observe_reporting_deadline_monitor_clock_skew_atomic",
          {
            p_observed_at: databaseNow.toISOString(),
            p_clock_skew_milliseconds: skewMilliseconds,
          },
        );
        if (outcome(row) !== "observed") {
          throw new ReportingDeadlineMonitorFailure(
            "malformed_provider",
            false,
          );
        }
        if (critical) {
          this.logger.error(
            `Reporting deadline monitor clock skew: ${skewMilliseconds}ms`,
          );
        }
      },
    },
  );

  readonly queue: ReportingDeadlineMonitorDependencies["queue"] = Object.freeze(
    {
      reconcile: async (databaseNow) => {
        const row = await this.rpc(
          "reconcile_reporting_deadline_monitoring_atomic",
          {
            p_database_now: databaseNow.toISOString(),
            p_limit: 1_000,
          },
        );
        if (outcome(row) !== "reconciled") {
          throw new ReportingDeadlineMonitorFailure(
            "malformed_provider",
            false,
          );
        }
      },
      dueOrganizationIds: async () => {
        const rows = await this.rows(
          "list_due_reporting_deadline_alert_organizations",
          { p_limit: 1_000 },
        );
        return Object.freeze(
          rows.map((row) => {
            const parsed = uuid.safeParse(row.organization_id);
            if (!parsed.success) {
              throw new ReportingDeadlineMonitorFailure(
                "malformed_provider",
                false,
              );
            }
            return parsed.data;
          }),
        );
      },
      claim: async ({ organizationId, workerId, leaseSeconds }) => {
        const row = await this.rpc(
          "claim_reporting_deadline_alert_delivery_atomic",
          {
            p_organization_id: organizationId,
            p_worker_id: workerId,
            p_lease_seconds: leaseSeconds,
          },
        );
        const value = outcome(row);
        if (value !== "claimed") {
          if (
            ![
              "none_available",
              "conflict",
              "not_found",
              "invalid_state",
            ].includes(value)
          ) {
            throw new ReportingDeadlineMonitorFailure(
              "malformed_provider",
              false,
            );
          }
          return Object.freeze({
            outcome: value as Exclude<
              ReportingDeadlineDeliveryClaim["outcome"],
              "claimed"
            >,
          });
        }
        const delivery = z
          .object({ id: uuid, checkpointVersion: z.number().int().positive() })
          .passthrough()
          .safeParse(row.delivery);
        if (!delivery.success) {
          throw new ReportingDeadlineMonitorFailure(
            "malformed_provider",
            false,
          );
        }
        return Object.freeze({
          outcome: "claimed" as const,
          organizationId,
          deliveryId: delivery.data.id,
          leaseOwner: workerId,
          checkpointVersion: delivery.data.checkpointVersion,
        });
      },
      deliveryDetails: async ({
        organizationId,
        deliveryId,
        leaseOwner,
        checkpointVersion,
      }) => {
        const row = await this.rpc(
          "get_reporting_deadline_alert_delivery_details",
          {
            p_organization_id: organizationId,
            p_delivery_id: deliveryId,
            p_worker_id: leaseOwner,
            p_expected_checkpoint_version: checkpointVersion,
          },
        );
        const value = outcome(row);
        if (value !== "found") {
          if (!["cancelled", "conflict", "not_found"].includes(value)) {
            throw new ReportingDeadlineMonitorFailure(
              "malformed_provider",
              false,
            );
          }
          return Object.freeze({
            outcome: value as Exclude<
              ReportingDeadlineDeliveryDetails["outcome"],
              "deliverable"
            >,
          });
        }
        const detail = asRecord(row.details);
        const parsedRecipient = recipientSchema.safeParse(detail.recipient);
        const parsedAlert = alertSchema.safeParse(detail);
        if (!parsedRecipient.success || !parsedAlert.success) {
          throw new ReportingDeadlineMonitorFailure(
            "malformed_provider",
            false,
          );
        }
        return Object.freeze({
          outcome: "deliverable" as const,
          recipient: Object.freeze({
            userId: parsedRecipient.data.userId,
            email: parsedRecipient.data.email,
          }),
          alert: Object.freeze({
            obligationId: parsedAlert.data.obligationId,
            stageKind: parsedAlert.data.stageKind,
            thresholdPercent: parsedAlert.data.thresholdPercent,
            dueAt: normalizeTimestamp(parsedAlert.data.dueAt),
            idempotencyKey: `reporting-deadline:${parsedAlert.data.deliveryId}`,
          }),
        });
      },
      complete: async ({
        organizationId,
        deliveryId,
        leaseOwner,
        checkpointVersion,
      }) => {
        const row = await this.rpc(
          "complete_reporting_deadline_alert_delivery_atomic",
          {
            p_organization_id: organizationId,
            p_delivery_id: deliveryId,
            p_worker_id: leaseOwner,
            p_expected_checkpoint_version: checkpointVersion,
          },
        );
        const value = outcome(row);
        if (!["completed", "conflict", "not_found"].includes(value)) {
          throw new ReportingDeadlineMonitorFailure(
            "malformed_provider",
            false,
          );
        }
        return Object.freeze({
          outcome: value as "completed" | "conflict" | "not_found",
        });
      },
      fail: async ({
        organizationId,
        deliveryId,
        leaseOwner,
        checkpointVersion,
        code,
        retryable,
      }) => {
        const row = await this.rpc(
          "fail_reporting_deadline_alert_delivery_atomic",
          {
            p_organization_id: organizationId,
            p_delivery_id: deliveryId,
            p_worker_id: leaseOwner,
            p_expected_checkpoint_version: checkpointVersion,
            p_code: code,
            p_retryable: retryable,
          },
        );
        if (
          !["retry_scheduled", "dead_letter", "conflict"].includes(outcome(row))
        ) {
          throw new ReportingDeadlineMonitorFailure(
            "malformed_provider",
            false,
          );
        }
      },
    },
  );

  async isReady(): Promise<boolean> {
    try {
      const row = await this.rpc("get_reporting_deadline_monitor_health", {});
      if (outcome(row) !== "found") return false;
      const health = z
        .object({ critical: z.boolean() })
        .passthrough()
        .safeParse(row.health);
      return health.success && !health.data.critical;
    } catch {
      // A missing or unavailable durable health record must fail readiness;
      // silently reporting healthy would conceal a critical clock observation.
      return false;
    }
  }

  private async rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<ProviderRow> {
    return one((await this.query(name, args)).data);
  }

  private async rows(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<readonly ProviderRow[]> {
    const data = (await this.query(name, args)).data;
    if (!Array.isArray(data)) {
      throw new ReportingDeadlineMonitorFailure("malformed_provider", false);
    }
    return Object.freeze(data.map(asRecord));
  }

  private async query(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<ProviderResult> {
    try {
      const result = await (
        this.supabase.admin() as unknown as {
          rpc(
            procedure: string,
            params: Readonly<Record<string, unknown>>,
          ): Promise<ProviderResult>;
        }
      ).rpc(name, args);
      if (result.error) {
        throw new ReportingDeadlineMonitorFailure("provider_unavailable", true);
      }
      return result;
    } catch (error) {
      if (error instanceof ReportingDeadlineMonitorFailure) throw error;
      throw new ReportingDeadlineMonitorFailure("provider_unavailable", true);
    }
  }
}

function normalizeTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new ReportingDeadlineMonitorFailure("malformed_provider", false);
  }
  return timestamp.toISOString().replace(".000Z", "Z");
}
