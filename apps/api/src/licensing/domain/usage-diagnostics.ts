import {
  LICENSE_USAGE_DEFINITIONS,
  licenseUsageCounterSchema,
  type LicenseLimits,
  type LicenseUsageComponents,
  type LicenseUsageCounter,
  type LicenseUsageCounterId,
  type LicenseUsageLimit,
} from "@repo/contracts/licensing";

export interface LicenseUsageDiagnosticsInput {
  components: LicenseUsageComponents;
  availability: Record<LicenseUsageCounterId, "ready" | "unavailable">;
  reasons: Record<LicenseUsageCounterId, string[]>;
  limits: LicenseLimits | null;
  verified: boolean;
}

const limitKeys = {
  seats: "activeMembers",
  products: "products",
  storage: "storageBytes",
} as const;
function safeInteger(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}
function limitFor(
  id: LicenseUsageCounterId,
  input: LicenseUsageDiagnosticsInput,
): LicenseUsageLimit {
  if (id === "protected_storage") return { kind: "exempt", value: null };
  if (!input.verified || !input.limits)
    return { kind: "unverified", value: null };
  const value = input.limits[limitKeys[id]];
  return value === null
    ? { kind: "unlimited", value: null }
    : safeInteger(value)
      ? { kind: "finite", value }
      : { kind: "unverified", value: null };
}
function stateFor(
  value: number | null,
  limit: LicenseUsageLimit,
): LicenseUsageCounter["state"] {
  if (value === null || limit.kind === "unverified") return "unavailable";
  if (limit.kind !== "finite") return "normal";
  if (value > limit.value) return "over_limit";
  if (value === limit.value) return "at_limit";
  return BigInt(value) * 5n >= BigInt(limit.value) * 4n
    ? "near_limit"
    : "normal";
}

/** Presentation diagnostics only; source quota admission remains authoritative. */
export function buildLicenseUsageCounters(
  input: LicenseUsageDiagnosticsInput,
): LicenseUsageCounter[] {
  return LICENSE_USAGE_DEFINITIONS.map(({ componentKeys, ...definition }) => {
    const components = componentKeys.map((key) => ({
      key,
      value: safeInteger(input.components[key]) ? input.components[key] : null,
    }));
    const invalid = components.some((component) => component.value === null);
    const sum = invalid
      ? null
      : components.reduce(
          (total, component) => total + BigInt(component.value!),
          0n,
        );
    const overflow = sum !== null && sum > BigInt(Number.MAX_SAFE_INTEGER);
    const unavailable =
      input.availability[definition.id] === "unavailable" ||
      invalid ||
      overflow;
    const value = unavailable ? null : Number(sum);
    const limit = limitFor(definition.id, input);
    const invalidLimit =
      input.verified && input.limits !== null && limit.kind === "unverified";
    const reasons = [
      ...new Set([
        ...input.reasons[definition.id],
        ...(invalid ? ["invalid_component"] : []),
        ...(overflow ? ["unsafe_component_sum"] : []),
        ...(invalidLimit ? ["invalid_limit"] : []),
      ]),
    ];
    return licenseUsageCounterSchema.parse({
      ...definition,
      kind: "gauge",
      scope: "organization",
      period: {
        kind: "current_state",
        resetRule: "source_changes_only",
        nextResetAt: null,
      },
      value,
      components,
      availability: unavailable ? "unavailable" : "ready",
      limit,
      state: stateFor(value, limit),
      reasons,
    });
  });
}
