import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { SupabaseService } from "../../supabase/supabase.service";
import {
  NotificationDispatchFailure,
  type NotificationDispatchWorkerDependencies,
} from "./notification-dispatch-worker";

type Queue = NotificationDispatchWorkerDependencies["queue"];
type RpcResult = Readonly<{ data: unknown; error: unknown }>;
type RpcRow = Readonly<Record<string, unknown>>;

const organizationPageSize = 100;
const bridgePageSize = 100;
const bridgeProcedures = [
  "bridge_vulnerability_triage_notification_dispatches_atomic",
  "bridge_evidence_validity_notification_dispatches_atomic",
  "bridge_evidence_scan_notification_dispatches_atomic",
  "bridge_supplier_owner_notification_dispatches_atomic",
] as const;
const uuid = z.uuid();
const sha256 = /^[a-f0-9]{64}$/;
const recipientSchema = z
  .object({
    userId: uuid,
    email: z.string().email().max(320),
  })
  .strict();
const payloadSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("finding_triage"),
      advisoryId: z.string().trim().min(1).max(200),
      severity: z.string().trim().min(1).max(40),
      alertKind: z.enum(["suppression_expired", "internal_sla_breached"]),
    })
    .strict(),
  z.object({ kind: z.literal("evidence_quarantined") }).strict(),
  z.object({ kind: z.literal("evidence_integrity_failure") }).strict(),
  z
    .object({
      kind: z.literal("evidence_validity"),
      title: z.string().trim().min(1).max(500),
      validUntil: z.iso.date(),
      thresholdDays: z.number().int().min(1).max(3650),
      productId: uuid.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("supplier_owner"),
      portalTitle: z.string().trim().min(1).max(500),
      dueAt: z.string().trim().min(1).max(40),
    })
    .strict(),
  z
    .object({
      kind: z.literal("digest"),
      items: z
        .array(
          z
            .object({
              title: z.string().trim().min(1).max(500),
              href: z.string().startsWith("/").max(2048),
              date: z.string().trim().min(1).max(40),
              category: z.string().trim().min(1).max(100),
            })
            .strict(),
        )
        .min(1)
        .max(100),
    })
    .strict(),
]);
const claimSchema = z
  .object({
    dispatchId: uuid,
    leaseOwner: uuid,
    checkpointVersion: z.number().int().positive(),
  })
  .strict();
const preparedSchema = z
  .object({
    deliveryRef: uuid,
    idempotencyKey: z.string().trim().min(1).max(200),
    recipient: recipientSchema,
    payload: payloadSchema,
  })
  .strict();

/** Parses org-scoped RPC results before optional dispatch work reaches SMTP. */
@Injectable()
export class SupabaseNotificationDispatchQueueAdapter implements Queue {
  constructor(private readonly supabase: SupabaseService) {}

  async bridge(organizationId: string): Promise<void> {
    if (!uuid.safeParse(organizationId).success) throw malformedProvider();
    for (const procedure of bridgeProcedures) {
      const row = await this.one(procedure, {
        p_organization_id: organizationId,
        p_limit: bridgePageSize,
      });
      const result = z
        .object({
          outcome: z.enum(["bridged", "legacy"]),
          created: z.number().int().min(0).max(bridgePageSize),
        })
        .passthrough()
        .safeParse(row);
      if (!result.success) throw malformedProvider();
    }
  }

  async dueOrganizations(
    afterOrganizationId: string | null,
  ): ReturnType<Queue["dueOrganizations"]> {
    const data = await this.rpc(
      "list_due_notification_dispatch_organizations_atomic",
      {
        p_after_organization_id: afterOrganizationId,
        p_limit: organizationPageSize,
      },
    );
    const rows = z
      .array(z.object({ organization_id: uuid }).passthrough())
      .max(organizationPageSize)
      .safeParse(data);
    if (!rows.success) throw malformedProvider();
    const organizationIds = rows.data.map((row) => row.organization_id);
    let previous = afterOrganizationId;
    for (const organizationId of organizationIds) {
      if (previous !== null && organizationId <= previous)
        throw malformedProvider();
      previous = organizationId;
    }
    return Object.freeze({
      organizationIds: Object.freeze(organizationIds),
      nextOrganizationId:
        organizationIds.length === organizationPageSize
          ? (organizationIds.at(-1) ?? null)
          : null,
    });
  }

  async claim(
    input: Parameters<Queue["claim"]>[0],
  ): ReturnType<Queue["claim"]> {
    if (input.leaseSeconds < 30 || input.leaseSeconds > 900) {
      throw malformedProvider();
    }
    const row = await this.one("claim_notification_dispatch_atomic", {
      p_organization_id: input.organizationId,
      p_worker_id: input.workerId,
      p_lease_seconds: input.leaseSeconds,
    });
    if (row.outcome === "none_available" || row.outcome === "conflict") {
      return Object.freeze({ outcome: row.outcome });
    }
    if (row.outcome !== "claimed") throw malformedProvider();
    const claim = claimSchema.safeParse(row.dispatch);
    if (!claim.success || claim.data.leaseOwner !== input.workerId) {
      throw malformedProvider();
    }
    return Object.freeze({ outcome: "claimed" as const, ...claim.data });
  }

  async prepare(
    input: Parameters<Queue["prepare"]>[0],
  ): ReturnType<Queue["prepare"]> {
    const row = await this.one("prepare_notification_dispatch_atomic", {
      p_organization_id: input.organizationId,
      p_dispatch_id: input.dispatchId,
      p_worker_id: input.leaseOwner,
      p_expected_version: input.checkpointVersion,
    });
    if (["cancelled", "conflict", "not_found"].includes(String(row.outcome))) {
      return Object.freeze({
        outcome: row.outcome as "cancelled" | "conflict" | "not_found",
      });
    }
    if (row.outcome !== "ready") throw malformedProvider();
    const prepared = preparedSchema.safeParse(row.delivery);
    if (!prepared.success || prepared.data.deliveryRef !== input.dispatchId) {
      throw malformedProvider();
    }
    return Object.freeze({
      outcome: "ready" as const,
      recipient: Object.freeze(prepared.data.recipient),
      idempotencyKey: prepared.data.idempotencyKey,
      payload: Object.freeze(prepared.data.payload),
    });
  }

  async complete(
    input: Parameters<Queue["complete"]>[0],
  ): ReturnType<Queue["complete"]> {
    if (input.messageIdHash !== null && !sha256.test(input.messageIdHash)) {
      throw malformedProvider();
    }
    const row = await this.one("complete_notification_dispatch_atomic", {
      p_organization_id: input.organizationId,
      p_dispatch_id: input.dispatchId,
      p_worker_id: input.leaseOwner,
      p_expected_version: input.checkpointVersion,
      p_outcome: "provider_accepted",
      p_message_id_hash: input.messageIdHash,
      p_error_code: null,
    });
    if (row.outcome === "completed" || row.outcome === "replayed") {
      return Object.freeze({ outcome: "completed" as const });
    }
    if (row.outcome === "conflict" || row.outcome === "not_found") {
      return Object.freeze({ outcome: "conflict" as const });
    }
    throw malformedProvider();
  }

  async fail(input: Parameters<Queue["fail"]>[0]): ReturnType<Queue["fail"]> {
    const code = [
      "provider_unavailable",
      "delivery_failed",
      "malformed_provider",
    ].includes(input.code)
      ? input.code
      : "provider_unavailable";
    const row = await this.one("fail_notification_dispatch_atomic", {
      p_organization_id: input.organizationId,
      p_dispatch_id: input.dispatchId,
      p_worker_id: input.leaseOwner,
      p_expected_version: input.checkpointVersion,
      p_error_code: code,
      p_retryable: input.retryable,
    });
    if (
      ["retry_scheduled", "exhausted", "conflict"].includes(String(row.outcome))
    ) {
      return Object.freeze({
        outcome: row.outcome as "retry_scheduled" | "exhausted" | "conflict",
      });
    }
    throw malformedProvider();
  }

  private async one(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<RpcRow> {
    const data = await this.rpc(name, args);
    if (!Array.isArray(data) || data.length !== 1) throw malformedProvider();
    const row = data[0] as unknown;
    if (!row || typeof row !== "object" || Array.isArray(row))
      throw malformedProvider();
    return row as RpcRow;
  }

  private async rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    try {
      const result = await (
        this.supabase.admin() as unknown as {
          rpc(
            procedure: string,
            parameters: Readonly<Record<string, unknown>>,
          ): Promise<RpcResult>;
        }
      ).rpc(name, args);
      if (result.error) throw providerUnavailable();
      return result.data;
    } catch (error) {
      if (error instanceof NotificationDispatchFailure) throw error;
      throw providerUnavailable();
    }
  }
}

function malformedProvider(): NotificationDispatchFailure {
  return new NotificationDispatchFailure("malformed_provider", false);
}

function providerUnavailable(): NotificationDispatchFailure {
  return new NotificationDispatchFailure("provider_unavailable", true);
}
