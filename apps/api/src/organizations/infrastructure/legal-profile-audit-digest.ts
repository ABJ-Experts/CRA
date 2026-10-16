import { createHmac } from "node:crypto";

export type ContactAuditField =
  | "manufacturer_contact_name"
  | "manufacturer_contact_email"
  | "manufacturer_contact_phone";

/**
 * Mirrors the SQL RPC's contact normalization so audit digests describe the
 * committed representation rather than harmless input formatting changes.
 */
export function canonicalContactAuditValue(
  field: ContactAuditField,
  value: string | null,
): string | null {
  if (value === null) return null;

  switch (field) {
    case "manufacturer_contact_name":
      return value.trim().replace(/\s+/g, " ");
    case "manufacturer_contact_email":
      return value.trim().toLowerCase();
    case "manufacturer_contact_phone": {
      const trimmed = value.trim();
      return trimmed.length === 0 ? null : trimmed;
    }
  }
}

/**
 * Domain-separated HMAC for private contact audit comparisons. A null phone is
 * deliberately distinct from an empty string, even though validation rejects
 * the latter, so audit data cannot blur an explicit removal into malformed data.
 */
export function contactAuditDigest(
  field: ContactAuditField,
  value: string | null,
  secret: string,
): string {
  const encodedValue = value === null ? "<null>" : `<string>${value}`;
  return createHmac("sha256", secret)
    .update(
      `cra.organization.legal-profile.audit.v1\u0000${field}\u0000${encodedValue}`,
    )
    .digest("hex");
}
