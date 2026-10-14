import { z } from "zod";
import { licenseStateSchema } from "../../licensing/schemas/license-values.schemas.js";
import {
  systemHealthReasonSchema,
  systemHealthStatusSchema,
} from "../../system/schemas/system-health.schema.js";

const timestamp = z.iso.datetime({ offset: false });
const reasons = z.array(systemHealthReasonSchema).max(30);
const count = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .nullable()
  .default(null);
const text = z.string().trim().min(1).max(80).nullable().default(null);
const nullableTime = timestamp.nullable().default(null);
const cursor = z.string().regex(/^[A-Za-z0-9_-]{1,2048}$/);
const limit = z.preprocess(function parsePageLimit(value) {
  return typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value;
}, z.number().int().min(1).max(100).default(50));

export const operatorInstancesQuerySchema = z.strictObject({
  cursor: cursor.optional(),
  limit,
});
export const operatorTenantsQuerySchema = z.strictObject({
  cursor: cursor.optional(),
  limit,
});
export const operatorInstanceMetadataQuerySchema = z.strictObject({
  cursor: cursor.optional(),
  limit,
});
export const operatorEmptyQuerySchema = z.strictObject({});
export const operatorInstanceParamsSchema = z.strictObject({
  instanceId: z.uuid(),
});
export const operatorSourceObservationSchema = z
  .strictObject({
    source: z.enum([
      "local",
      "database",
      "audit",
      "deadline_monitor",
      "licensing",
      "usage_metering",
      "vulnerability_feeds",
      "storage",
      "backups",
      "version",
    ]),
    status: systemHealthStatusSchema.default("unknown"),
    sourceAt: nullableTime,
    observedAt: nullableTime,
    attemptedAt: nullableTime,
    succeededAt: nullableTime,
    receivedAt: nullableTime,
    reasons: reasons.default([]),
  })
  .refine(function hasHealthySourceProvenance(value) {
    return (
      value.status !== "healthy" ||
      (value.sourceAt !== null &&
        value.observedAt !== null &&
        value.attemptedAt !== null &&
        value.succeededAt !== null &&
        value.receivedAt !== null &&
        value.reasons.length === 0)
    );
  }, "Healthy source observations require successful source and collection timestamps")
  .refine(function hasUnknownBackupAuthority(value) {
    return (
      value.source !== "backups" ||
      (value.status === "unknown" &&
        value.reasons.includes("m15_05_not_available"))
    );
  }, "Backup assurance remains unknown until M15-05");

export const operatorLicenceSummarySchema = z.strictObject({
  active: count,
  grace: count,
  expiredReadOnly: count,
  invalid: count,
  missing: count,
  unknown: count,
});
const operatorInstanceSummaryBaseSchema = z.strictObject({
  instanceId: z.uuid(),
  label: z.string().trim().min(1).max(120),
  status: systemHealthStatusSchema.default("unknown"),
  version: text,
  commit: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/)
    .nullable()
    .default(null),
  expectedVersion: text,
  versionDrift: z.enum(["unknown", "matched", "different"]).default("unknown"),
  versionSourceAt: nullableTime,
  lastObservedAt: nullableTime,
  licenceSummary: operatorLicenceSummarySchema.prefault({}),
  tenantCount: count,
  countScope: z.literal("authorized_tenants").default("authorized_tenants"),
  sources: z.array(operatorSourceObservationSchema).max(12).default([]),
});
export const operatorInstanceSummarySchema =
  operatorInstanceSummaryBaseSchema.refine(function hasConsistentVersion(
    value,
  ) {
    if (value.versionDrift === "unknown") return true;
    if (
      value.version === null ||
      value.expectedVersion === null ||
      value.versionSourceAt === null
    )
      return false;
    return (
      (value.version === value.expectedVersion) ===
      (value.versionDrift === "matched")
    );
  }, "Version drift requires consistent observed and expected releases");
export const operatorTenantSummarySchema = z.strictObject({
  tenantId: z.uuid(),
  label: z.string().trim().min(1).max(120),
  status: systemHealthStatusSchema.default("unknown"),
  licenceState: licenseStateSchema.nullable().default(null),
  licenceExpiresAt: nullableTime,
  graceEndsAt: nullableTime,
  licenceSourceAt: nullableTime,
  lastObservedAt: nullableTime,
  sources: z.array(operatorSourceObservationSchema).max(12).default([]),
});
export const operatorInstancesResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  observedAt: timestamp,
  instances: z.array(operatorInstanceSummarySchema).max(100),
  nextCursor: cursor.nullable(),
});
export const operatorInstanceResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  observedAt: timestamp,
  instance: operatorInstanceSummarySchema,
});
export const operatorTenantsResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  observedAt: timestamp,
  instanceId: z.uuid(),
  tenants: z.array(operatorTenantSummarySchema).max(100),
  nextCursor: cursor.nullable(),
});
export const operatorSessionResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  principalId: z.uuid(),
  grantRevision: z.string().trim().min(1).max(120),
  allowedInstanceIds: z.array(z.uuid()).max(500),
});
// Private source pages contain only this fixed metadata allowlist.
export const operatorInstanceMetadataResponseSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    instanceId: z.uuid(),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    sourceAt: timestamp,
    observedAt: timestamp,
    instance: operatorInstanceSummarySchema,
    tenants: z.array(operatorTenantSummarySchema).max(100),
    nextCursor: cursor.nullable(),
  })
  .refine(function hasMatchingInstance(value) {
    return value.instanceId === value.instance.instanceId;
  }, "Instance metadata binding must match")
  .refine(function hasUniqueTenants(value) {
    return (
      new Set(value.tenants.map((tenant) => tenant.tenantId)).size ===
      value.tenants.length
    );
  }, "Instance metadata must contain unique tenant identities");
export const operatorRegistryPublicationSchema = z.strictObject({
  metadata: operatorInstanceMetadataResponseSchema,
  digest: z.string().regex(/^[0-9a-f]{64}$/),
});
