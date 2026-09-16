import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { z } from "zod";

import {
  technicalFileSnapshotArtifactSchema,
  technicalFileSnapshotExportSchema,
  technicalFileSnapshotPayloadSchema,
} from "./technical-file-snapshot.schema.js";
import { technicalFileProductParamsSchema } from "./technical-file.schema.js";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const expectedVersionSchema = z.number().int().positive();
const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Use a lowercase SHA-256 digest");
const recipientEmailSchema = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email({ message: "Enter a valid auditor email address" }))
  .transform((email) => email.toLowerCase());

/** A magic-link secret is opaque, high entropy and never persisted or returned after redemption. */
export const technicalFileAuditorGrantTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43,256}$/, "Use a valid auditor access token");

export const technicalFileAuditorGrantStatusSchema = z.enum([
  "active",
  "revoked",
  "expired",
]);
export const technicalFileAuditorArtifactSelectorSchema = z.enum([
  "pdf",
  "archive",
]);

export const technicalFileAuditorGrantSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    productId: z.uuid(),
    snapshotId: z.uuid(),
    exportId: z.uuid(),
    recipientEmail: recipientEmailSchema,
    recipientReference: requiredText(300).nullable(),
    purpose: requiredText(2_000),
    status: technicalFileAuditorGrantStatusSchema,
    expiresAt: z.string().datetime({ offset: true }),
    grantedByUserId: z.uuid(),
    grantedAt: z.string().datetime({ offset: true }),
    revokedAt: z.string().datetime({ offset: true }).nullable(),
    revocationReason: requiredText(1_000).nullable(),
    version: expectedVersionSchema,
    lastAccessedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()
  .superRefine((grant, context) => {
    if ((grant.status === "revoked") !== (grant.revokedAt !== null)) {
      context.addIssue({
        code: "custom",
        path: ["revokedAt"],
        message: "Only revoked grants include a revocation timestamp",
      });
    }
    if (grant.status !== "revoked" && grant.revocationReason !== null) {
      context.addIssue({
        code: "custom",
        path: ["revocationReason"],
        message: "Only revoked grants include a revocation reason",
      });
    }
  });

export const technicalFileAuditorGrantCollectionParamsSchema =
  technicalFileProductParamsSchema.extend({ snapshotId: z.uuid() }).strict();
export const technicalFileAuditorGrantParamsSchema =
  technicalFileAuditorGrantCollectionParamsSchema.extend({ grantId: z.uuid() }).strict();
export const technicalFileAuditorGrantPreviewQuerySchema = z
  .object({ exportId: z.uuid() })
  .strict();

export const technicalFileAuditorGrantPreviewSchema = z
  .object({
    snapshotId: z.uuid(),
    snapshotSourceDate: z.string().datetime({ offset: true }),
    snapshotRevision: expectedVersionSchema,
    snapshotStatus: z.enum(["current", "superseded"]),
    snapshotSha256: sha256Schema,
    export: technicalFileSnapshotExportSchema,
    maxExpiresAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((preview, context) => {
    if (preview.export.status !== "ready") {
      context.addIssue({
        code: "custom",
        path: ["export"],
        message: "Auditor access requires a ready immutable export",
      });
    }
  });

export const createTechnicalFileAuditorGrantRequestSchema = z
  .object({
    exportId: z.uuid(),
    recipientEmail: recipientEmailSchema,
    recipientReference: requiredText(300).nullable().optional(),
    purpose: requiredText(2_000),
    expiresAt: z.string().datetime({ offset: true }),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const revokeTechnicalFileAuditorGrantRequestSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    reason: requiredText(1_000).nullable().optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const technicalFileAuditorGrantResponseSchema = z
  .object({ grant: technicalFileAuditorGrantSchema })
  .strict();
export const technicalFileAuditorGrantsResponseSchema = z
  .object({ grants: z.array(technicalFileAuditorGrantSchema).max(100) })
  .strict();
export const technicalFileAuditorGrantPreviewResponseSchema = z
  .object({ preview: technicalFileAuditorGrantPreviewSchema })
  .strict();
/** The delivery URL is returned exactly once after creation; list responses never contain it. */
export const technicalFileAuditorGrantCreatedResponseSchema = z
  .object({ grant: technicalFileAuditorGrantSchema, deliveryUrl: z.url().max(4_000) })
  .strict();

export const redeemTechnicalFileAuditorGrantRequestSchema = z
  .object({ token: technicalFileAuditorGrantTokenSchema })
  .strict();
export const technicalFileAuditorGrantRedemptionResponseSchema = z
  .object({ status: z.literal("redeemed"), expiresAt: z.string().datetime({ offset: true }) })
  .strict();

/** Intentionally detail-free so invalid grants never reveal tenant or product information. */
export const technicalFileAuditorAccessUnavailableResponseSchema = z
  .object({
    status: z.enum(["invalid", "expired", "revoked", "rate_limited"]),
    message: z.literal("This auditor access is unavailable."),
  })
  .strict();

export const technicalFileAuditorSnapshotViewSchema = z
  .object({
    snapshotId: z.uuid(),
    sourceDate: z.string().datetime({ offset: true }),
    revision: expectedVersionSchema,
    status: z.enum(["current", "superseded"]),
    payloadSha256: sha256Schema,
    payload: technicalFileSnapshotPayloadSchema,
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
export const technicalFileAuditorSnapshotViewResponseSchema = z
  .object({ snapshot: technicalFileAuditorSnapshotViewSchema })
  .strict();

export const technicalFileAuditorManifestSchema = z
  .object({
    snapshotId: z.uuid(),
    exportId: z.uuid(),
    manifestSha256: sha256Schema,
    artifacts: z.array(technicalFileSnapshotArtifactSchema).min(3).max(4),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
export const technicalFileAuditorManifestResponseSchema = z
  .object({ manifest: technicalFileAuditorManifestSchema })
  .strict();

export const technicalFileAuditorArtifactParamsSchema = z
  .object({ artifact: technicalFileAuditorArtifactSelectorSchema })
  .strict();
