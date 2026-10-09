import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { SupabaseService } from "../../supabase/supabase.service";
import type {
  PreparedSupplierEvidenceReminderDelivery,
  SupplierEvidenceReminderDeliveryClaim,
  SupplierEvidenceReminderQueue,
} from "../worker/supplier-evidence-reminder-worker.port";

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
    outcome: z.literal("claimed"),
    deliveryId: z.uuid(),
    eventKind: z.enum(["supplier_reminder", "owner_escalation"]),
  })
  .strict();
const noneAvailableSchema = z
  .object({ outcome: z.literal("none_available") })
  .strict();
const nonClaimSchema = z
  .object({ outcome: z.enum(["obsolete", "none_available"]) })
  .passthrough();
const preparedSupplierResultSchema = z
  .object({
    deliveryId: z.uuid(),
    eventKind: z.literal("supplier_reminder"),
    recipientKind: z.literal("supplier"),
    recipientEmail: z.email().max(320),
    recipientName: z.string().trim().max(500),
    instructions: z.string().trim().max(2_000).nullable(),
    dueAt: z.string().datetime({ offset: true }),
    portalTitle: z.string().trim().min(1).max(160),
    invitationId: z.uuid(),
  })
  .strict();
const preparedOwnerResultSchema = z
  .object({
    deliveryId: z.uuid(),
    eventKind: z.literal("owner_escalation"),
    recipientKind: z.literal("owner"),
    recipientEmail: z.email().max(320),
    requestTitle: z.string().trim().min(1).max(160),
    dueAt: z.string().datetime({ offset: true }),
  })
  .strict();
const preparedResultSchema = z.union([
  preparedSupplierResultSchema,
  preparedOwnerResultSchema,
]);
const prepareRowSchema = z
  .object({
    outcome: z.string().trim().min(1).max(64),
    result: z.unknown().nullable(),
  })
  .strict();

/** Service-role adapter: all reminder state changes are org-first RPC calls. */
@Injectable()
export class SupabaseSupplierEvidenceReminderQueue implements SupplierEvidenceReminderQueue {
  constructor(private readonly supabase: SupabaseService) {}

  async dueOrganizationIds(afterOrganizationId: string | null) {
    const { data, error } = await this.client().rpc(
      "list_supplier_evidence_reminder_organization_ids_atomic",
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
      "reconcile_supplier_evidence_reminders_atomic",
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
  ): Promise<SupplierEvidenceReminderDeliveryClaim> {
    const { data, error } = await this.client().rpc(
      "claim_supplier_evidence_reminder_delivery_atomic",
      {
        p_organization_id: organizationId,
        p_worker_id: input.workerId,
        p_lease_seconds: input.leaseSeconds,
      },
    );
    if (error) throw unavailable();
    if (
      noneAvailableSchema.safeParse(data).success ||
      nonClaimSchema.safeParse(data).success ||
      data === null
    ) {
      return { outcome: "none_available" };
    }
    const claim = claimSchema.safeParse(data);
    if (!claim.success) throw unavailable();
    return {
      outcome: "claimed",
      organizationId,
      deliveryId: claim.data.deliveryId,
      eventKind: claim.data.eventKind,
    };
  }

  async prepareDelivery(
    claim: Extract<
      SupplierEvidenceReminderDeliveryClaim,
      { outcome: "claimed" }
    >,
    input: Readonly<{ workerId: string; tokenHash: string | null }>,
  ): Promise<PreparedSupplierEvidenceReminderDelivery> {
    const { data, error } = await this.client().rpc(
      "prepare_supplier_evidence_reminder_delivery_atomic",
      {
        p_organization_id: claim.organizationId,
        p_delivery_id: claim.deliveryId,
        p_worker_id: input.workerId,
        p_token_hash: input.tokenHash,
      },
    );
    if (error || !Array.isArray(data) || data.length !== 1) throw unavailable();
    const row = prepareRowSchema.safeParse(data[0]);
    if (!row.success) throw unavailable();
    if (row.data.outcome !== "prepared") {
      return { outcome: "obsolete" };
    }
    const prepared = preparedResultSchema.safeParse(row.data.result);
    if (!prepared.success || prepared.data.deliveryId !== claim.deliveryId) {
      throw unavailable();
    }
    if (prepared.data.eventKind === "supplier_reminder") {
      return {
        outcome: "prepared",
        organizationId: claim.organizationId,
        deliveryId: claim.deliveryId,
        recipientKind: "supplier",
        email: prepared.data.recipientEmail,
        requestTitle: prepared.data.portalTitle,
        instructions: prepared.data.instructions,
        dueAt: prepared.data.dueAt,
      };
    }
    return {
      outcome: "prepared",
      organizationId: claim.organizationId,
      deliveryId: claim.deliveryId,
      recipientKind: "owner",
      email: prepared.data.recipientEmail,
      requestTitle: prepared.data.requestTitle,
      dueAt: prepared.data.dueAt,
    };
  }

  async complete(
    organizationId: string,
    input: Readonly<{
      deliveryId: string;
      workerId: string;
      outcome: "sent" | "retry" | "recipient_unavailable";
      error: string | null;
    }>,
  ): Promise<void> {
    const { data, error } = await this.client().rpc(
      "complete_supplier_evidence_reminder_delivery_atomic",
      {
        p_organization_id: organizationId,
        p_delivery_id: input.deliveryId,
        p_worker_id: input.workerId,
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

function unavailable(): Error {
  return new Error("supplier evidence reminder queue unavailable");
}
