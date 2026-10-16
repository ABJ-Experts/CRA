import {
  operatorInstanceSummarySchema,
  operatorTenantSummarySchema,
} from "@repo/contracts";
export const instanceId = "11111111-1111-4111-8111-111111111111";
export const tenantId = "22222222-2222-4222-8222-222222222222";
export const observedAt = "2026-10-14T10:00:00.000Z";
export const operatorSession = {
  schemaVersion: 1 as const,
  principalId: "33333333-3333-4333-8333-333333333333",
  grantRevision: "one",
  allowedInstanceIds: [instanceId],
};
export const operatorInstance = operatorInstanceSummarySchema.parse({
  instanceId,
  label: "Private deployment",
  version: "1.2.3",
  expectedVersion: "1.2.4",
  versionDrift: "different",
  versionSourceAt: observedAt,
  status: "stale",
  lastObservedAt: observedAt,
  sources: [
    {
      source: "database",
      status: "unreachable",
      sourceAt: observedAt,
      observedAt,
      attemptedAt: observedAt,
      succeededAt: observedAt,
      receivedAt: observedAt,
      reasons: ["collection_unreachable"],
    },
  ],
});
export const operatorTenant = operatorTenantSummarySchema.parse({
  tenantId,
  label: "Example organization",
  licenceState: "expired_read_only",
  lastObservedAt: observedAt,
});
export const instances = {
  schemaVersion: 1 as const,
  observedAt,
  instances: [operatorInstance],
  nextCursor: null,
};
export const tenants = {
  schemaVersion: 1 as const,
  observedAt,
  instanceId,
  tenants: [operatorTenant],
  nextCursor: null,
};
