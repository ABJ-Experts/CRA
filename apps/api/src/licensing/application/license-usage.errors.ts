import { LicensingError } from "./licensing.errors";

/** Stable public failures never carry database details or licence material. */
export function usageFailure(
  outcome: "forbidden" | "conflict" | "busy" | "unavailable",
): LicensingError {
  if (outcome === "forbidden")
    return new LicensingError(
      "forbidden",
      403,
      "Licence usage is not permitted",
    );
  if (outcome === "conflict")
    return new LicensingError(
      "license_usage_conflict",
      409,
      "Licence or usage changed; reload and try again",
    );
  if (outcome === "busy")
    return new LicensingError(
      "license_usage_busy",
      409,
      "Usage reconciliation is already running; try again",
    );
  return new LicensingError(
    "license_usage_unavailable",
    503,
    "Licence usage is temporarily unavailable",
  );
}
