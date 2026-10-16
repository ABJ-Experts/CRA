import {
  LICENSE_USAGE_DEFINITIONS,
  licenseUsageSnapshotSchema,
} from "@repo/contracts/licensing/schemas";
export const usageOrganizationId = "22222222-2222-4222-8222-222222222222";
export function usageSnapshot() {
  return licenseUsageSnapshotSchema.parse({
    schemaVersion: 1,
    definitionVersion: "m15_02_v1",
    organizationId: usageOrganizationId,
    observedAt: "2026-10-13T00:00:00.000Z",
    reconciledAt: null,
    meterVersion: 4,
    license: {
      version: 2,
      issuanceSequence: 1,
      policyRevision: 1,
      state: "active",
      verified: true,
      reasons: [],
      startsAt: "2026-10-01T00:00:00.000Z",
      expiresAt: "2027-10-01T00:00:00.000Z",
      graceEndsAt: "2027-10-31T00:00:00.000Z",
      effectiveCapabilities: ["products"],
    },
    counters: LICENSE_USAGE_DEFINITIONS.map(
      ({ componentKeys, ...definition }) => ({
        ...definition,
        kind: "gauge",
        scope: "organization",
        period: {
          kind: "current_state",
          resetRule: "source_changes_only",
          nextResetAt: null,
        },
        value: 0,
        components: componentKeys.map((key) => ({ key, value: 0 })),
        availability: "ready",
        limit:
          definition.id === "protected_storage"
            ? { kind: "exempt", value: null }
            : { kind: "finite", value: 10 },
        state: "normal",
        reasons: [],
      }),
    ),
  });
}
export function usageReceipt() {
  return {
    snapshot: usageSnapshot(),
    auditEventId: "33333333-3333-4333-8333-333333333333",
    replayed: false,
  };
}
