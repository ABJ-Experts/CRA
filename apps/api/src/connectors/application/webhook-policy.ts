import type { PermissionKey } from "@repo/contracts/permissions";
import type { WebhookDelivery } from "@repo/contracts/connectors/types";
import { ConnectorError } from "./connector-errors";
import type { WebhookSourceScope } from "./webhook-repository.port";

export function webhookReadPermissions(
  eventTypes: readonly string[],
): readonly PermissionKey[] {
  return Object.freeze([
    "can_view_products",
    ...(eventTypes.some(
      (type) =>
        type.startsWith("vulnerability.") ||
        type.startsWith("reporting.") ||
        type.startsWith("remediation."),
    )
      ? ["can_view_findings" as const]
      : []),
  ]);
}
export function assertWebhookScope(
  selected: readonly string[],
  scope: readonly string[],
): void {
  if (
    scope.length === 0 ||
    scope.length > 100 ||
    scope.some((id) => !selected.includes(id))
  )
    throw new ConnectorError("forbidden_by_policy");
}
export function webhookPayload(
  orgId: string,
  delivery: WebhookDelivery,
  scope: WebhookSourceScope,
): string {
  const body = JSON.stringify({
    schemaVersion: 1,
    eventId: delivery.eventId,
    deliveryId: delivery.deliveryId,
    occurredAt: delivery.occurredAt,
    eventType: delivery.eventType,
    organizationId: orgId,
    resource: scope.resource,
  });
  if (Buffer.byteLength(body, "utf8") > 8192)
    throw new ConnectorError("payload_too_large");
  return body;
}
/** Operational labels/reasons cannot carry the canonical signing-key format. */
export function assertSafeWebhookMetadata(
  value: Readonly<Record<string, unknown>>,
): void {
  let text = JSON.stringify(value);
  for (let pass = 0; pass < 3; pass += 1) {
    if (/[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=/.test(text))
      throw new ConnectorError("invalid_request");
    const decoded = text.replace(/(?:%[a-f0-9]{2})+/gi, (encoded) => {
      try {
        return decodeURIComponent(encoded);
      } catch {
        return encoded;
      }
    });
    if (decoded === text) return;
    text = decoded;
  }
}
