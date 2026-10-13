import {
  licensePolicyResponseSchema,
  type LicenseCapability,
  type LicenseClaims,
  type LicensePolicyResponse,
  type LicenseUsage,
} from "@repo/contracts/licensing";
export const LICENSE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
export const LICENSE_CLOCK_ROLLBACK_MS = 5 * 60 * 1000;
export interface TrustedTimeInput {
  wallTimeMs: number;
  persistedHighWaterMs: number;
  processStartedWallMs: number;
  monotonicElapsedMs: number;
}
export function calculateTrustedTime(input: TrustedTimeInput) {
  if (
    Object.values(input).some((value) => !Number.isFinite(value) || value < 0)
  )
    throw new Error("Invalid trusted time input");
  const floor = Math.max(
    input.persistedHighWaterMs,
    input.processStartedWallMs + input.monotonicElapsedMs,
  );
  const effectiveTimeMs = Math.max(input.wallTimeMs, floor);
  return {
    effectiveTimeMs,
    highWaterMs: effectiveTimeMs,
    clockTrusted: floor - input.wallTimeMs <= LICENSE_CLOCK_ROLLBACK_MS,
  };
}
export interface LicensePolicyInput {
  claims: LicenseClaims | null;
  now: Date;
  clockTrusted?: boolean;
  invalidReason?: string;
  usage?: LicenseUsage;
  configuration?: Partial<Record<LicenseCapability, boolean>>;
}
export function evaluateLicensePolicy(
  input: LicensePolicyInput,
): LicensePolicyResponse {
  const { claims, now } = input;
  const time = now.getTime();
  if (!Number.isFinite(time))
    throw new Error("Invalid licence evaluation time");
  const expiry = claims ? Date.parse(claims.expiresAt) : null;
  const grace = expiry === null ? null : expiry + LICENSE_GRACE_MS;
  const state =
    input.clockTrusted === false
      ? "clock_untrusted"
      : input.invalidReason
        ? "invalid"
        : !claims
          ? "missing"
          : time < Date.parse(claims.startsAt)
            ? "invalid"
            : time >= grace!
              ? "expired_read_only"
              : time >= expiry!
                ? "grace"
                : "active";
  const reasons =
    state === "active"
      ? []
      : [
          state === "invalid"
            ? (input.invalidReason ?? "not_yet_active")
            : state,
        ];
  const usable = state === "active" || state === "grace";
  const disabledCapabilities =
    claims?.entitlements.filter(
      (key) => input.configuration?.[key] === false,
    ) ?? [];
  const effectiveCapabilities = usable
    ? claims!.entitlements.filter((key) => input.configuration?.[key] !== false)
    : [];
  const warnings =
    expiry !== null && usable && expiry - time <= LICENSE_GRACE_MS
      ? ["approaching_expiry"]
      : [];
  if (claims && input.usage) {
    if (input.usage.availability === "unavailable")
      warnings.push("usage_unavailable");
    else
      for (const key of [
        "activeMembers",
        "products",
        "storageBytes",
      ] as const) {
        const cap = claims.limits[key];
        const used =
          input.usage[key] +
          (key === "storageBytes" ? input.usage.storageReservedBytes : 0);
        if (cap !== null && (cap === 0 || used >= cap * 0.8))
          warnings.push(
            used >= cap ? `at_${key}_limit` : `approaching_${key}_limit`,
          );
      }
  }
  return licensePolicyResponseSchema.parse({
    state,
    reasons,
    warnings,
    effectiveCapabilities,
    disabledCapabilities,
    customerWritesAllowed: usable,
    evidenceExportAllowed: true,
    evaluatedAt: now.toISOString(),
    expiresAt: claims?.expiresAt ?? null,
    graceEndsAt: grace === null ? null : new Date(grace).toISOString(),
  });
}
