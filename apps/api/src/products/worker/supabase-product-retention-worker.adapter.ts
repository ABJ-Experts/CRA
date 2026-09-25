import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";

import {
  RequiredMailDeliveryError,
  MailService,
} from "../../mail/mail.service";
import { SupabaseService } from "../../supabase/supabase.service";
import {
  ProductRetentionWorkerFailure,
  type ProductRetentionClaim,
  type ProductRetentionEvent,
  type ProductRetentionRecipient,
  type ProductRetentionWorkerDependencies,
} from "./product-retention-worker";

type ProviderRow = Readonly<Record<string, unknown>>;
type ProviderResult = Readonly<{ data: unknown; error: unknown }>;

const uuid = z.uuid();
const dateTime = z.string().datetime({ offset: true });
const alertEvent = z
  .object({
    organizationId: uuid,
    productId: uuid,
    productName: z.string().trim().min(1).max(500),
    releaseId: uuid.nullable(),
    eventType: z.literal("support_period.alert"),
    eventKey: z.string().trim().min(1).max(500),
    supportPeriodId: uuid,
    supportPeriodRevision: z.number().int().positive(),
    thresholdDays: z.number().int().positive(),
    supportEndsAt: dateTime,
    dueAt: dateTime,
    deliveryState: z.enum(["current", "missed_catch_up"]),
  })
  .strict();
const recipient = z
  .object({ user_id: uuid, email: z.string().email().max(320) })
  .strict();

const asRecord = (value: unknown): ProviderRow => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProductRetentionWorkerFailure("malformed_provider", false);
  }
  return value as ProviderRow;
};

const one = (value: unknown): ProviderRow => {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new ProductRetentionWorkerFailure("malformed_provider", false);
  }
  return asRecord(value[0]);
};

const outcome = (row: ProviderRow): string => {
  if (typeof row.outcome !== "string") {
    throw new ProductRetentionWorkerFailure("malformed_provider", false);
  }
  return row.outcome;
};

/**
 * Service-role persistence for the alert worker. The global due-list exposes
 * organization IDs only; every claim/complete/fail RPC takes the org first and
 * validates its state again inside PostgreSQL.
 */
@Injectable()
export class SupabaseProductRetentionWorkerRepository {
  private readonly logger = new Logger(
    SupabaseProductRetentionWorkerRepository.name,
  );

  constructor(private readonly supabase: SupabaseService) {}

  readonly clock: ProductRetentionWorkerDependencies["clock"] = Object.freeze({
    databaseNow: async () => {
      const row = await this.rpc("get_product_retention_worker_now", {});
      if (outcome(row) !== "found" || typeof row.database_now !== "string") {
        throw new ProductRetentionWorkerFailure("malformed_provider", false);
      }
      const parsed = dateTime.safeParse(row.database_now);
      if (!parsed.success) {
        throw new ProductRetentionWorkerFailure("malformed_provider", false);
      }
      return new Date(parsed.data);
    },
    localNow: () => new Date(),
    observeSkew: ({ skewMilliseconds }) => {
      // Scheduling always remains database-time authoritative. This is an
      // operational warning only and deliberately contains no user or payload.
      this.logger.warn(
        `Product retention worker clock skew: ${skewMilliseconds}ms`,
      );
      return Promise.resolve();
    },
  });

  readonly queue: ProductRetentionWorkerDependencies["queue"] = Object.freeze({
    dueOrganizationIds: async () => {
      const rows = await this.rows(
        "list_due_product_support_alert_organizations",
        {},
      );
      return Object.freeze(
        rows.flatMap((row) => {
          const parsed = uuid.safeParse(row.organization_id);
          return parsed.success ? [parsed.data] : [];
        }),
      );
    },
    claim: async ({
      organizationId,
      workerId,
      leaseSeconds,
    }): Promise<ProductRetentionClaim> => {
      const row = await this.rpc("claim_product_support_alert_atomic", {
        p_organization_id: organizationId,
        p_lease_owner: workerId,
        p_lease_seconds: leaseSeconds,
      });
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
          throw new ProductRetentionWorkerFailure("malformed_provider", false);
        }
        return Object.freeze({
          outcome: value as
            "none_available" | "conflict" | "not_found" | "invalid_state",
        });
      }
      const event = alertEvent.safeParse(row.event);
      if (
        !event.success ||
        !uuid.safeParse(row.delivery_id).success ||
        !uuid.safeParse(row.lease_owner).success ||
        !Number.isInteger(row.checkpoint_version)
      ) {
        throw new ProductRetentionWorkerFailure("malformed_provider", false);
      }
      return Object.freeze({
        outcome: "claimed",
        deliveryId: row.delivery_id as string,
        leaseOwner: row.lease_owner as string,
        checkpointVersion: row.checkpoint_version as number,
        event: event.data,
      });
    },
    complete: async ({
      organizationId,
      deliveryId,
      leaseOwner,
      checkpointVersion,
      recipientId,
    }) => {
      const row = await this.rpc(
        "complete_product_support_alert_delivery_atomic",
        {
          p_organization_id: organizationId,
          p_delivery_id: deliveryId,
          p_lease_owner: leaseOwner,
          p_expected_checkpoint_version: checkpointVersion,
          p_recipient_user_id: recipientId,
        },
      );
      const value = outcome(row);
      if (!["completed", "conflict", "not_found"].includes(value)) {
        throw new ProductRetentionWorkerFailure("malformed_provider", false);
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
      const row = await this.rpc("fail_product_support_alert_delivery_atomic", {
        p_organization_id: organizationId,
        p_delivery_id: deliveryId,
        p_lease_owner: leaseOwner,
        p_expected_checkpoint_version: checkpointVersion,
        p_code: code,
        p_retryable: retryable,
      });
      if (!["failed", "conflict"].includes(outcome(row))) {
        throw new ProductRetentionWorkerFailure("malformed_provider", false);
      }
    },
  });

  readonly recipients: ProductRetentionWorkerDependencies["recipients"] =
    Object.freeze({
      productOwner: async ({ organizationId, productId }) =>
        this.recipient("get_product_support_alert_product_owner_recipient", {
          p_organization_id: organizationId,
          p_product_id: productId,
        }),
      organizationOwnerOrAdmin: async ({ organizationId }) =>
        this.recipient("get_product_support_alert_owner_or_admin_recipient", {
          p_organization_id: organizationId,
        }),
    });

  private async recipient(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<ProductRetentionRecipient | null> {
    const rows = await this.rows(name, args);
    if (rows.length === 0) return null;
    if (rows.length !== 1) {
      throw new ProductRetentionWorkerFailure("malformed_provider", false);
    }
    const parsed = recipient.safeParse(rows[0]);
    if (!parsed.success) {
      throw new ProductRetentionWorkerFailure("malformed_provider", false);
    }
    return Object.freeze({
      userId: parsed.data.user_id,
      email: parsed.data.email,
    });
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
      throw new ProductRetentionWorkerFailure("malformed_provider", false);
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
        throw new ProductRetentionWorkerFailure("provider_unavailable", true);
      }
      return result;
    } catch (error) {
      if (error instanceof ProductRetentionWorkerFailure) throw error;
      throw new ProductRetentionWorkerFailure("provider_unavailable", true);
    }
  }
}

/** Required-delivery adapter; it does not swallow mail-provider failures. */
@Injectable()
export class MailProductRetentionDeliveryAdapter {
  constructor(private readonly mail: MailService) {}

  async deliver(
    input: Readonly<{
      idempotencyKey: string;
      recipient: ProductRetentionRecipient;
      event: ProductRetentionEvent;
    }>,
  ): Promise<void> {
    try {
      await this.mail.sendSupportPeriodAlert(
        input.recipient.email,
        {
          productName: input.event.productName,
          supportEndsAt: input.event.supportEndsAt,
          thresholdDays: input.event.thresholdDays,
          missed: input.event.deliveryState === "missed_catch_up",
        },
        input.idempotencyKey,
      );
    } catch (error) {
      if (error instanceof RequiredMailDeliveryError) {
        throw new ProductRetentionWorkerFailure(error.code, true);
      }
      throw new ProductRetentionWorkerFailure("provider_unavailable", true);
    }
  }
}
