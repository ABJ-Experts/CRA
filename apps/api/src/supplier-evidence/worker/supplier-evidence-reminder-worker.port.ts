export const SUPPLIER_EVIDENCE_REMINDER_QUEUE = Symbol(
  "SUPPLIER_EVIDENCE_REMINDER_QUEUE",
);
export const SUPPLIER_EVIDENCE_REMINDER_NOTIFIER = Symbol(
  "SUPPLIER_EVIDENCE_REMINDER_NOTIFIER",
);

export type SupplierEvidenceReminderDeliveryClaim =
  | Readonly<{
      outcome: "claimed";
      organizationId: string;
      deliveryId: string;
      eventKind: "supplier_reminder" | "owner_escalation";
    }>
  | Readonly<{ outcome: "none_available" }>;

export type PreparedSupplierEvidenceReminderDelivery =
  | Readonly<{
      outcome: "prepared";
      organizationId: string;
      deliveryId: string;
      recipientKind: "supplier";
      email: string;
      requestTitle: string;
      instructions: string | null;
      dueAt: string;
    }>
  | Readonly<{
      outcome: "prepared";
      organizationId: string;
      deliveryId: string;
      recipientKind: "owner";
      email: string;
      requestTitle: string;
      dueAt: string;
    }>
  | Readonly<{ outcome: "obsolete" }>;

/** Database RPCs own tenant scoping, eligibility, leases, and durable retries. */
export interface SupplierEvidenceReminderQueue {
  dueOrganizationIds(afterOrganizationId: string | null): Promise<
    Readonly<{
      organizationIds: readonly string[];
      nextOrganizationId: string | null;
    }>
  >;
  reconcile(
    organizationId: string,
    input: Readonly<{ workerId: string }>,
  ): Promise<void>;
  claimDelivery(
    organizationId: string,
    input: Readonly<{ workerId: string; leaseSeconds: number }>,
  ): Promise<SupplierEvidenceReminderDeliveryClaim>;
  prepareDelivery(
    claim: Extract<
      SupplierEvidenceReminderDeliveryClaim,
      { outcome: "claimed" }
    >,
    input: Readonly<{ workerId: string; tokenHash: string | null }>,
  ): Promise<PreparedSupplierEvidenceReminderDelivery>;
  complete(
    organizationId: string,
    input: Readonly<{
      deliveryId: string;
      workerId: string;
      outcome: "sent" | "retry" | "recipient_unavailable";
      error: string | null;
    }>,
  ): Promise<void>;
}

export interface SupplierEvidenceReminderNotifier {
  deliver(
    input:
      | (Extract<
          PreparedSupplierEvidenceReminderDelivery,
          { outcome: "prepared" }
        > &
          Readonly<{ recipientKind: "supplier"; rawToken: string }>)
      | (Extract<
          PreparedSupplierEvidenceReminderDelivery,
          { outcome: "prepared" }
        > &
          Readonly<{ recipientKind: "owner" }>),
  ): Promise<"delivered" | "recipient_unavailable">;
}
