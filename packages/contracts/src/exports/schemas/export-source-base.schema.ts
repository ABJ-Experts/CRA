import { z } from "zod";
import type { PermissionKey } from "../../permissions.js";
export const EXPORT_LIMITS = Object.freeze({
  maxRows: 100_000,
  maxCaptureBytes: 128 * 1024 * 1024,
  maxArtifactBytes: 64 * 1024 * 1024,
  maxTotalArtifactBytes: 1024 * 1024 * 1024,
  maxParts: 512,
  availabilitySeconds: 86_400,
  downloadGrantSeconds: 300,
  xlsxRowsPerSheet: 1_048_576,
  xlsxCellCharacters: 32_767,
});
export const exportColumnTypeSchema = z.enum([
  "text",
  "number",
  "boolean",
  "date",
  "datetime",
]);
export const exportColumnSchema = z
  .object({
    key: z.string().regex(/^[A-Za-z][A-Za-z0-9_.]*$/),
    label: z.string().min(1).max(120),
    type: exportColumnTypeSchema,
  })
  .strict();
export const none = z.object({}).strict();
// URL query transforms must be idempotent when their parsed output is serialized as JSON.
export function jsonArchivedQuery<S extends z.ZodType>(
  schema: S,
  key = "archived",
) {
  return z.preprocess(
    (value) =>
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      key in value &&
      typeof (value as Record<string, unknown>)[key] === "boolean"
        ? { ...value, [key]: String((value as Record<string, unknown>)[key]) }
        : value,
    schema,
  );
}
export const product = z.object({ productId: z.uuid() }).strict();
export const release = z
  .object({ productId: z.uuid(), releaseId: z.uuid() })
  .strict();
export const document = z.object({ documentId: z.uuid() }).strict();
export const source = z.object({ sourceId: z.uuid() }).strict();
export const finding = z.object({ findingId: z.uuid() }).strict();
export const diff = z.object({ diffId: z.uuid() }).strict();
export const review = z.object({ reviewId: z.uuid() }).strict();
type Column = z.output<typeof exportColumnSchema>;
const columnTypes: Readonly<Record<string, Column["type"]>> = Object.freeze({
  placedAt: "datetime",
  retentionUntil: "datetime",
  retentionProtectionUntil: "datetime",
  date: "date",
  editionDate: "date",
  awarenessAt: "datetime",
  detectedAt: "datetime",
  finishedAt: "datetime",
  receivedAt: "datetime",
  deadlineAt: "datetime",
  lastTestedAt: "datetime",
  lastSyncAt: "datetime",
  lastInboundAt: "datetime",
  retryAt: "datetime",
  deadLetteredAt: "datetime",
  appliedAt: "datetime",
  lastDeliveredAt: "datetime",
  canceledAt: "datetime",
  createdAt: "datetime",
  updatedAt: "datetime",
  joinedAt: "datetime",
  expiresAt: "datetime",
  requestedAt: "datetime",
  occurredAt: "datetime",
  recordedAt: "datetime",
  lastEvaluatedAt: "datetime",
  firstDetectedAt: "datetime",
  completedAt: "datetime",
  startedAt: "datetime",
  committedAt: "datetime",
  dueAt: "datetime",
  issuedAt: "datetime",
  validFrom: "datetime",
  validUntil: "datetime",
  availabilityUntil: "datetime",
  effectiveStartsAt: "datetime",
  effectiveEndsAt: "datetime",
  assignedAt: "datetime",
  endedAt: "datetime",
  reviewedAt: "datetime",
  grantedAt: "datetime",
  revokedAt: "datetime",
  resolvedAt: "datetime",
  staleAt: "datetime",
  archivedAt: "datetime",
  releasedAt: "datetime",
  lastUsedAt: "datetime",
  lastAccessedAt: "datetime",
  lastAttemptAt: "datetime",
  nextAttemptAt: "datetime",
  windowStartsAt: "datetime",
  windowEndsAt: "datetime",
  lastAttemptedAt: "datetime",
  lastSuccessfulCompleteAt: "datetime",
  nextScheduledAt: "datetime",
  startsAt: "datetime",
  endsAt: "datetime",
  visibleCount: "number",
  unreadCount: "number",
  previewCount: "number",
  recordCount: "number",
  succeededCount: "number",
  skippedCount: "number",
  failedCount: "number",
  pendingCount: "number",
  requestedRetentionDays: "number",
  effectiveFloorDays: "number",
  effectiveRetentionDays: "number",
  requiredRetentionDays: "number",
  completedParts: "number",
  totalParts: "number",
  attemptNumber: "number",
  lastHttpStatus: "number",
  httpStatus: "number",
  durationMs: "number",
  responseBytes: "number",
  confidence: "number",
  score: "number",
  rowCount: "number",
  processedRowCount: "number",
  sourceRowNumber: "number",
  componentCount: "number",
  dependencyCount: "number",
  memberCount: "number",
  preparedCount: "number",
  attemptCount: "number",
  attempt: "number",
  attempts: "number",
  retryCount: "number",
  recordsFetched: "number",
  recordsPromoted: "number",
  currentRecordCount: "number",
  queueDepth: "number",
  failureCount: "number",
  depth: "number",
  position: "number",
  sortOrder: "number",
  versionNumber: "number",
  revisionNumber: "number",
  baselineRevisionNumber: "number",
  technicalFileVersion: "number",
  templateVersion: "number",
  thresholdDays: "number",
  byteSize: "number",
  value: "number",
  epss: "number",
  cvssBaseScore: "number",
  currentVersion: "boolean",
  ownerActive: "boolean",
  hasSecret: "boolean",
  verified: "boolean",
  includeOrganizationWide: "boolean",
  isDefault: "boolean",
  selected: "boolean",
  curated: "boolean",
  previewTruncated: "boolean",
  canConfigure: "boolean",
  isActive: "boolean",
  enabled: "boolean",
  missed: "boolean",
  obsolete: "boolean",
  read: "boolean",
});
export function textColumns(...keys: string[]): readonly Column[] {
  return keys.map((key) => ({
    key,
    label: key.replace(/([a-z])([A-Z])/g, "$1 $2"),
    type: columnTypes[key] ?? "text",
  }));
}
export function portalDefinition<Q extends z.ZodType, C extends z.ZodType>(
  querySchema: Q,
  contextSchema: C,
  columns: readonly Column[],
  subjectKind: "supplier_session" | "auditor_session",
) {
  return {
    querySchema,
    contextSchema,
    columns,
    subjectKind,
    requiredPermissions: [] as readonly PermissionKey[],
    requiredRole: undefined,
    supportsPage: false,
    supportsSelection: false,
  };
}
export function definition<Q extends z.ZodType, C extends z.ZodType>(
  querySchema: Q,
  contextSchema: C,
  columns: readonly Column[],
  requiredPermissions: readonly PermissionKey[],
  supportsPage = false,
  supportsSelection = false,
  requiredRole?: "admin" | "owner",
) {
  return {
    requiredRole,
    querySchema,
    contextSchema,
    columns,
    requiredPermissions,
    supportsPage,
    supportsSelection,
    subjectKind: "member" as const,
  };
}
