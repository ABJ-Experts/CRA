import { z } from "zod";
import {
  exportArtifactSchema,
  exportManifestSchema,
  EXPORT_LIMITS,
} from "../../exports/schemas/index.js";
import { reportConfigurationSchema } from "./report-input.schema.js";
import { REPORT_SCHEMA_VERSION } from "./report-source.schema.js";
const instant = z.iso.datetime({ offset: true });
const version = z.number().int().positive();
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const safeCode = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,79}$/)
  .nullable();
export const reportDefinitionSchema = z
  .object({
    id: z.uuid(),
    ownerUserId: z.uuid(),
    definitionVersion: version,
    version,
    state: z.enum(["draft", "active", "paused", "archived"]),
    config: reportConfigurationSchema,
    configDigest: digest,
    schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
    nextDueAt: instant.nullable(),
    previewRunId: z.uuid().nullable(),
    pauseReason: safeCode,
    createdAt: instant,
    updatedAt: instant,
  })
  .strict();
export const reportRunSchema = z
  .object({
    id: z.uuid(),
    definitionId: z.uuid(),
    definitionVersion: version,
    kind: z.enum(["preview", "scheduled"]),
    state: z.enum(["scheduled", "running", "succeeded", "failed", "paused"]),
    scheduledFor: instant,
    occurrenceKey: z.string().min(1).max(200),
    createdAt: instant,
    finishedAt: instant.nullable(),
    safeErrorCode: safeCode,
  })
  .strict();
export const reportRunRecipientSchema = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    generationState: z.enum([
      "waiting",
      "running",
      "ready",
      "skipped",
      "failed",
      "revoked",
    ]),
    emailState: z.enum([
      "pending",
      "off",
      "queued",
      "accepted",
      "uncertain",
      "failed",
      "skipped",
    ]),
    safeErrorCode: safeCode,
    expiresAt: instant.nullable(),
    artifacts: z.array(exportArtifactSchema).max(EXPORT_LIMITS.maxParts),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.artifacts.length > 0 && value.expiresAt === null)
      ctx.addIssue({
        code: "custom",
        message: "Available artifacts require an expiry",
      });
    if (value.generationState !== "ready" && value.artifacts.length > 0)
      ctx.addIssue({
        code: "custom",
        path: ["artifacts"],
        message: "Artifacts are available only to ready recipients",
      });
  });
export const reportManifestSchema = z
  .object({
    schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
    definitionId: z.uuid(),
    definitionVersion: version,
    configDigest: digest,
    runId: z.uuid(),
    recipientId: z.uuid(),
    occurrenceKey: z.string().min(1).max(200),
    scheduledFor: instant,
    asOf: instant,
    sourceContextDigest: digest,
    ownerPermissionVersion: z.string().min(1).max(256),
    recipientPermissionVersion: z.string().min(1).max(256),
    scopeDigest: digest,
    exportManifest: exportManifestSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.exportManifest.scope === "all_filtered" &&
      Date.parse(value.asOf) === Date.parse(value.exportManifest.snapshotAsOf),
    "Scheduled manifest must match the all-filtered capture",
  );
export const reportDefinitionResponseSchema = z
  .object({ data: reportDefinitionSchema })
  .strict();
export const reportDefinitionListResponseSchema = z
  .object({
    items: z.array(reportDefinitionSchema).max(50),
    nextCursor: z.uuid().nullable(),
  })
  .strict();
export const reportRecipientEligibilitySchema = z
  .object({
    userId: z.uuid(),
    state: z.enum(["eligible", "ineligible"]),
    safeErrorCode: z
      .enum(["source_access_denied", "membership_ineligible"])
      .nullable(),
  })
  .strict()
  .refine(
    (value) => (value.state === "eligible") === (value.safeErrorCode === null),
    "Eligibility reason must match state",
  );
export const reportRunDetailResponseSchema = z
  .object({
    run: reportRunSchema,
    recipients: z.array(reportRunRecipientSchema).max(20),
    recipientEligibility: z
      .array(reportRecipientEligibilitySchema)
      .max(20)
      .default([]),
  })
  .strict();
export const reportRunListResponseSchema = z
  .object({
    items: z.array(reportRunSchema).max(50),
    nextCursor: z.uuid().nullable(),
  })
  .strict();
export const reportRecipientsResponseSchema = z
  .object({
    items: z
      .array(
        z
          .object({ id: z.uuid(), displayName: z.string().min(1).max(400) })
          .strict(),
      )
      .max(50),
    nextCursor: z.uuid().nullable(),
  })
  .strict();
export const reportEmailPreferenceSchema = z
  .object({ mode: z.enum(["immediate", "off"]), version })
  .strict();
export const reportManifestResponseSchema = z
  .object({ data: reportManifestSchema })
  .strict();
export const reportDownloadGrantResponseSchema = z
  .object({
    data: z
      .object({
        grantId: z.uuid(),
        url: z
          .string()
          .startsWith("/api/v1/reports/")
          .max(500)
          .refine(
            (value) =>
              !value.includes("..") &&
              !value.includes("\\") &&
              Array.from(value).every(
                (character) =>
                  character.charCodeAt(0) > 32 &&
                  character.charCodeAt(0) !== 127,
              ),
            "Invalid protected download URL",
          ),
        expiresAt: instant,
        artifact: exportArtifactSchema,
      })
      .strict(),
  })
  .strict();

/** Administrators receive lifecycle metadata without another owner's report content. */
export const reportAdministrationSummarySchema = z
  .object({
    id: z.uuid(),
    ownerUserId: z.uuid(),
    state: z.enum(["draft", "active", "paused", "archived"]),
    version,
  })
  .strict();
export const reportAdministrationListResponseSchema = z
  .object({
    items: z.array(reportAdministrationSummarySchema).max(50),
    nextCursor: z.uuid().nullable(),
  })
  .strict();
export const reportAdministrationMutationResponseSchema = z
  .object({
    data: reportAdministrationSummarySchema,
  })
  .strict();
