import { z } from "zod";
import { licenseStateSchema } from "../../licensing/schemas/license-values.schemas.js";

const timestamp = z.iso.datetime({ offset: false });
export const systemHealthReasonSchema = z.enum([
  "source_unavailable",
  "source_permission_withheld",
  "source_stale",
  "source_timeout",
  "database_unavailable",
  "audit_unavailable",
  "worker_heartbeat_stale",
  "worker_heartbeat_unavailable",
  "queue_backlog",
  "queue_terminal_failures",
  "queue_uncertain_delivery",
  "queue_human_review",
  "meter_unavailable",
  "storage_unreachable",
  "storage_integrity_unknown",
  "m15_05_not_available",
  "version_unavailable",
  "version_drift",
  "licence_unavailable",
  "licence_expired",
  "licence_grace",
  "licence_invalid",
  "clock_untrusted",
  "no_successful_observation",
  "collection_unreachable",
]);
const reasons = z.array(systemHealthReasonSchema).max(30);
const count = z.number().int().nonnegative().max(10_000).nullable();
const bytes = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const provenance = {
  sourceAt: timestamp.nullable(),
  observedAt: timestamp.nullable(),
};

export const systemHealthStatusSchema = z.enum([
  "healthy",
  "degraded",
  "stale",
  "unreachable",
  "unknown",
]);
export const systemHealthAvailabilitySchema = z.enum([
  "ready",
  "unavailable",
  "withheld",
]);
export const systemHealthComponentIdSchema = z.enum([
  "database",
  "audit",
  "deadline_monitor",
  "licensing",
  "usage_metering",
  "vulnerability_feeds",
  "storage",
  "backups",
  "version",
]);
export const systemHealthComponentSchema = z
  .strictObject({
    id: systemHealthComponentIdSchema,
    label: z.string().trim().min(1).max(80),
    status: systemHealthStatusSchema,
    ...provenance,
    source: z.enum([
      "supabase",
      "audit",
      "m6",
      "licensing",
      "usage_metering",
      "vulnerability_feeds",
      "storage",
      "m15_05",
      "build",
    ]),
    summary: z.string().trim().min(1).max(240),
    reasons,
  })
  .refine(function hasHealthyComponentProvenance(value) {
    return (
      value.status !== "healthy" ||
      (value.sourceAt !== null &&
        value.observedAt !== null &&
        value.reasons.length === 0)
    );
  }, "Healthy components require source and observation timestamps and no reasons")
  .refine(function hasUnknownBackupComponentAuthority(value) {
    if (value.id !== "backups" && value.source !== "m15_05") return true;
    return (
      value.id === "backups" &&
      value.source === "m15_05" &&
      value.status === "unknown" &&
      value.sourceAt === null &&
      value.reasons.includes("m15_05_not_available")
    );
  }, "Backup components require unavailable M15-05 authority without a source observation");

export const systemHealthQueueSchema = z
  .strictObject({
    id: z.enum([
      "vulnerability_feeds",
      "exports",
      "reports",
      "evidence_processing",
      "notifications",
      "connectors",
      "sboms",
    ]),
    label: z.string().trim().min(1).max(80),
    availability: systemHealthAvailabilitySchema,
    pending: count,
    running: count,
    retrying: count,
    waitingForReview: count,
    uncertainDelivery: count,
    failedTerminal: count,
    oldestPendingAt: timestamp.nullable(),
    countRelation: z.enum(["exact", "at_least"]).nullable(),
    ...provenance,
    status: systemHealthStatusSchema,
    reasons,
    interpretation: z.literal("queue_observation"),
  })
  .refine(function hasAvailableQueueObservations(value) {
    const counts = [
      value.pending,
      value.running,
      value.retrying,
      value.waitingForReview,
      value.uncertainDelivery,
      value.failedTerminal,
    ];
    if (value.availability !== "ready") {
      return (
        counts.every((item) => item === null) &&
        value.countRelation === null &&
        value.oldestPendingAt === null &&
        value.sourceAt === null &&
        value.reasons.length > 0 &&
        value.status !== "healthy"
      );
    }
    return (
      counts.every((item) => item !== null) &&
      value.countRelation !== null &&
      value.sourceAt !== null &&
      value.observedAt !== null
    );
  }, "Queue availability must match its observations")
  .refine(function hasQualifiedCappedCounts(value) {
    return (
      ![
        value.pending,
        value.running,
        value.retrying,
        value.waitingForReview,
        value.uncertainDelivery,
        value.failedTerminal,
      ].includes(10_000) || value.countRelation === "at_least"
    );
  }, "Capped queue counts must use at_least")
  .refine(function hasOldestPendingTimestamp(value) {
    return (
      value.pending === null ||
      value.pending === 0 ||
      value.oldestPendingAt !== null ||
      value.countRelation === "at_least"
    );
  }, "Pending work requires an oldest pending timestamp unless capped");

export const systemHealthStorageSchema = z
  .strictObject({
    status: systemHealthStatusSchema,
    customerBytes: bytes.nullable(),
    customerReservedBytes: bytes.nullable(),
    protectedBytes: bytes.nullable(),
    unit: z.literal("bytes"),
    ...provenance,
    reasons,
    reachability: z.enum(["healthy", "unreachable", "unknown"]),
    integrity: z.literal("unknown"),
  })
  .refine(function hasAvailableStorageAccounting(value) {
    const values = [
      value.customerBytes,
      value.customerReservedBytes,
      value.protectedBytes,
    ];
    if (value.status === "unknown" || value.status === "unreachable") {
      return values.every((item) => item === null) && value.reasons.length > 0;
    }
    return (
      values.every((item) => item !== null) &&
      value.sourceAt !== null &&
      value.observedAt !== null
    );
  }, "Storage accounting availability must match its values");

export const systemHealthFeedFreshnessSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  label: z.string().trim().min(1).max(80),
  status: systemHealthStatusSchema,
  lastSuccessAt: timestamp.nullable(),
  lastSourceSnapshotAt: timestamp.nullable(),
  staleAfterSeconds: z.number().int().positive().max(31_536_000),
  ...provenance,
  reasons,
});
export const systemHealthVersionSchema = z.strictObject({
  version: z.string().trim().min(1).max(80).nullable(),
  commit: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/)
    .nullable(),
  builtAt: timestamp.nullable(),
  ...provenance,
});
export const systemHealthLicenceLinkSchema = z.strictObject({
  state: licenseStateSchema.nullable(),
  expiresAt: timestamp.nullable(),
  graceEndsAt: timestamp.nullable(),
  managementUrl: z.literal("/organization?settings=licence").nullable(),
  usageUrl: z.literal("/organization?settings=licence").nullable(),
  ...provenance,
});
export const systemHealthBackupSchema = z
  .strictObject({
    lastExecutionAt: z.null(),
    lastVerifiedRestoreAt: z.null(),
    status: z.literal("unknown"),
    ...provenance,
    reasons,
  })
  .refine(function hasUnknownBackupAuthority(value) {
    return value.reasons.includes("m15_05_not_available");
  }, "Backup assurance remains unknown until M15-05");

export const customerSystemHealthQuerySchema = z.strictObject({});
export const customerSystemHealthResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  organizationId: z.uuid(),
  observedAt: timestamp,
  overallStatus: systemHealthStatusSchema,
  currentVersion: systemHealthVersionSchema,
  licence: systemHealthLicenceLinkSchema,
  components: z.array(systemHealthComponentSchema).max(20),
  queues: z.array(systemHealthQueueSchema).max(10),
  storage: systemHealthStorageSchema,
  feedFreshness: z.array(systemHealthFeedFreshnessSchema).max(10),
  backup: systemHealthBackupSchema,
  // Licensing preserves exports that the caller is otherwise authorized to perform.
  evidenceExportPreserved: z.literal(true),
});
