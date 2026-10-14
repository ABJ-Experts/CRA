import { z } from "zod";
import { systemHealthStatusSchema } from "../../system/schemas/system-health.schema.js";
import {
  DIAGNOSTIC_DISCLOSURE_VERSION,
  DIAGNOSTIC_LIMITS,
} from "../constants.js";

export const diagnosticTimestampSchema = z.iso.datetime({ offset: false });
export const diagnosticDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const diagnosticCategorySchema = z.enum([
  "logs",
  "configuration",
  "metrics",
]);
export const diagnosticSectionSchema = z.enum([
  "logs",
  "configuration",
  "metrics",
  "omissions",
]);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const diagnosticSelectionSchema = z
  .strictObject({
    categories: z
      .array(diagnosticCategorySchema)
      .min(1)
      .max(3)
      .refine(
        (categories) => new Set(categories).size === categories.length,
        "Categories must be unique",
      ),
    from: diagnosticTimestampSchema,
    to: diagnosticTimestampSchema,
  })
  .refine(
    (selection) => Date.parse(selection.from) < Date.parse(selection.to),
    {
      message: "Start must precede end",
      path: ["from"],
    },
  )
  .refine(
    (selection) =>
      Date.parse(selection.to) - Date.parse(selection.from) <=
      DIAGNOSTIC_LIMITS.maxRangeDays * 86_400_000,
    {
      message: "Diagnostic range must not exceed seven days",
      path: ["to"],
    },
  );

export const diagnosticLogSchema = z.strictObject({
  at: diagnosticTimestampSchema,
  source: z.enum([
    "authentication",
    "audit",
    "connectors",
    "sboms",
    "evidence",
    "reporting",
    "tasks",
    "notifications",
    "licensing",
  ]),
  code: z.enum([
    "operation_started",
    "operation_completed",
    "operation_failed",
    "operation_denied",
  ]),
  outcome: z.enum(["intent", "completed", "failed", "denied"]),
});

export const diagnosticConfigurationSchema = z.strictObject({
  observedAt: diagnosticTimestampSchema,
  accessTokenSeconds: count.positive(),
  refreshTokenSeconds: count.positive(),
  smtpTlsMode: z.enum(["mailpit", "starttls", "tls"]),
  maxBundleBytes: z.literal(DIAGNOSTIC_LIMITS.maxBundleBytes),
  maxLogRows: z.literal(DIAGNOSTIC_LIMITS.maxLogRows),
});

export const diagnosticMetricSchema = z.strictObject({
  source: z.enum([
    "database",
    "audit",
    "deadline_monitor",
    "licensing",
    "usage_metering",
    "vulnerability_feeds",
    "storage",
    "backups",
    "version",
    "exports",
    "reports",
    "evidence_processing",
    "notifications",
    "connectors",
    "sboms",
  ]),
  status: systemHealthStatusSchema,
  sourceAt: diagnosticTimestampSchema.nullable(),
  observedAt: diagnosticTimestampSchema.nullable(),
  pending: count.nullable(),
  running: count.nullable(),
  failedTerminal: count.nullable(),
  storageBytes: count.nullable(),
});

export const diagnosticOmissionSchema = z.strictObject({
  category: diagnosticCategorySchema,
  code: z.enum([
    "source_unavailable",
    "source_withheld",
    "row_limit",
    "invalid_value",
  ]),
});
export const diagnosticOmissionsSchema = z
  .array(diagnosticOmissionSchema)
  .max(100);

export const diagnosticManifestSchema = z.strictObject({
  version: z.literal(DIAGNOSTIC_DISCLOSURE_VERSION),
  jobId: z.uuid(),
  generatedAt: diagnosticTimestampSchema,
  selection: diagnosticSelectionSchema,
  entries: z
    .array(
      z.strictObject({
        name: z.enum([
          "logs.json",
          "configuration.json",
          "metrics.json",
          "omissions.json",
        ]),
        sha256: diagnosticDigestSchema,
        byteSize: count.max(DIAGNOSTIC_LIMITS.maxBundleBytes),
      }),
    )
    .max(4)
    .refine(
      (entries) =>
        new Set(entries.map((entry) => entry.name)).size === entries.length,
      "Archive names must be unique",
    ),
  omissions: diagnosticOmissionsSchema,
});

export const diagnosticPayloadSchema = z.strictObject({
  logs: z
    .array(diagnosticLogSchema)
    .max(DIAGNOSTIC_LIMITS.maxLogRows)
    .optional(),
  configuration: diagnosticConfigurationSchema.optional(),
  metrics: z.array(diagnosticMetricSchema).max(100).optional(),
  omissions: diagnosticOmissionsSchema,
});
