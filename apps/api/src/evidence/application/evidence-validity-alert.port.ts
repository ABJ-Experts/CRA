export const EVIDENCE_VALIDITY_ALERT_QUEUE = Symbol(
  "EVIDENCE_VALIDITY_ALERT_QUEUE",
);
export const EVIDENCE_VALIDITY_ALERT_NOTIFIER = Symbol(
  "EVIDENCE_VALIDITY_ALERT_NOTIFIER",
);

export type EvidenceValidityAlertDeliveryClaim =
  | Readonly<{
      outcome: "claimed";
      organizationId: string;
      outboxId: string;
      email: string;
      thresholdDays: number;
      title: string;
      validUntil: string;
      productId: string | null;
    }>
  | Readonly<{ outcome: "none_available" }>;

/** Database owns recipient authorization, leases, retries, and deduplication. */
export interface EvidenceValidityAlertQueue {
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
  ): Promise<EvidenceValidityAlertDeliveryClaim>;
  complete(
    organizationId: string,
    input: Readonly<{
      outboxId: string;
      workerId: string;
      outcome: "sent" | "retry" | "recipient_unavailable";
      error: string | null;
    }>,
  ): Promise<void>;
}

export interface EvidenceValidityAlertNotifier {
  deliver(
    input: Extract<EvidenceValidityAlertDeliveryClaim, { outcome: "claimed" }>,
  ): Promise<"delivered" | "recipient_unavailable">;
}
