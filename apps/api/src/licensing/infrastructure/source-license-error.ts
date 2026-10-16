import { LicensingError } from "../application/licensing.errors";

/** Only exact PostgreSQL source guard failures carry licence policy meaning. */
export function sourceLicenseError(error: unknown): LicensingError | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as Readonly<{ code?: unknown; message?: unknown }>;
  if (candidate.code !== "42501") return null;
  switch (candidate.message) {
    case "licensing_product_limit":
      return new LicensingError(
        "license_product_limit",
        409,
        "The licensed product limit has been reached",
        "product_limit",
      );
    case "licensing_seat_limit":
      return new LicensingError(
        "license_seat_limit",
        409,
        "The licensed active member limit has been reached",
        "seat_limit",
      );
    case "licensing_customer_write_denied":
      return new LicensingError(
        "license_write_denied",
        403,
        "The verified licence does not permit this customer write",
        "customer_write_denied",
      );
    default:
      return null;
  }
}
