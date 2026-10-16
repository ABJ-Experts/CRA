import type { LicensePolicyResponse } from "@repo/contracts/licensing/types";
export const LICENCE_STATE_LABELS: Record<
  LicensePolicyResponse["state"],
  string
> = {
  missing: "No licence activated",
  active: "Active",
  grace: "Grace period",
  expired_read_only: "Expired · read-only",
  invalid: "Invalid licence",
  clock_untrusted: "Clock requires review",
};
export function licenceReason(reason: string) {
  return reason.replaceAll("_", " ");
}
export function licenceDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Not available";
}
