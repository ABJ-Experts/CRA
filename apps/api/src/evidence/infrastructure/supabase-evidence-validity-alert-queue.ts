import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { SupabaseService } from "../../supabase/supabase.service";
import type {
  EvidenceValidityAlertDeliveryClaim,
  EvidenceValidityAlertQueue,
} from "../application/evidence-validity-alert.port";

type RpcClient = Readonly<{
  rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<
    Readonly<{ data: unknown; error: Readonly<{ message?: string }> | null }>
  >;
}>;

const organizationPageSize = 250;
const organizationRowSchema = z.object({ organization_id: z.uuid() }).strict();

const claimSchema = z
  .object({
    outboxId: z.uuid(),
    email: z.email().max(320),
    eventType: z.literal("evidence_validity_expiring"),
    thresholdDays: z.number().int().min(1).max(3650),
    versionId: z.uuid(),
    documentId: z.uuid(),
    title: z.string().trim().min(1).max(500),
    validUntil: z.string().datetime({ offset: true }),
    productIds: z.array(z.uuid()).max(100),
  })
  .strict();

/** Service-role adapter: every mutation goes through an org-first database RPC. */
@Injectable()
export class SupabaseEvidenceValidityAlertQueue implements EvidenceValidityAlertQueue {
  constructor(private readonly supabase: SupabaseService) {}

  async dueOrganizationIds(afterOrganizationId: string | null) {
    const { data, error } = await this.client().rpc(
      "list_evidence_validity_alert_organization_ids_atomic",
      {
        p_after_organization_id: afterOrganizationId,
        p_limit: organizationPageSize,
      },
    );
    if (error || !Array.isArray(data)) throw unavailable();
    const organizationIds = data.map((value) => {
      const row = organizationRowSchema.safeParse(value);
      if (!row.success) throw unavailable();
      return row.data.organization_id;
    });
    return {
      organizationIds,
      nextOrganizationId:
        organizationIds.length === organizationPageSize
          ? (organizationIds.at(-1) ?? null)
          : null,
    };
  }

  async reconcile(
    organizationId: string,
    input: Readonly<{ workerId: string }>,
  ): Promise<void> {
    const { error } = await this.client().rpc(
      "reconcile_evidence_validity_alerts_atomic",
      {
        p_organization_id: organizationId,
        p_worker_id: input.workerId,
      },
    );
    if (error) throw unavailable();
  }

  async claimDelivery(
    organizationId: string,
    input: Readonly<{ workerId: string; leaseSeconds: number }>,
  ): Promise<EvidenceValidityAlertDeliveryClaim> {
    const { data, error } = await this.client().rpc(
      "claim_evidence_validity_notification_atomic",
      {
        p_organization_id: organizationId,
        p_worker_id: input.workerId,
        p_lease_seconds: input.leaseSeconds,
      },
    );
    if (error) throw unavailable();
    if (data === null) return { outcome: "none_available" };
    if (object(data).outcome === "recipient_unavailable") {
      return { outcome: "none_available" };
    }
    const claim = claimSchema.safeParse(data);
    if (!claim.success) throw unavailable();
    return {
      outcome: "claimed",
      organizationId,
      outboxId: claim.data.outboxId,
      email: claim.data.email,
      thresholdDays: claim.data.thresholdDays,
      title: claim.data.title,
      validUntil: claim.data.validUntil,
      productId: claim.data.productIds[0] ?? null,
    };
  }

  async complete(
    organizationId: string,
    input: Readonly<{
      outboxId: string;
      workerId: string;
      outcome: "sent" | "retry" | "recipient_unavailable";
      error: string | null;
    }>,
  ): Promise<void> {
    const { data, error } = await this.client().rpc(
      "complete_evidence_validity_notification_atomic",
      {
        p_organization_id: organizationId,
        p_worker_id: input.workerId,
        p_outbox_id: input.outboxId,
        p_outcome: input.outcome,
        p_error: input.error,
      },
    );
    if (
      error ||
      !["sent", "retry", "recipient_unavailable", "replayed"].includes(
        String(data),
      )
    ) {
      throw unavailable();
    }
  }

  private client(): RpcClient {
    return this.supabase.admin() as unknown as RpcClient;
  }
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function unavailable(): Error {
  return new Error("evidence validity alert queue unavailable");
}
