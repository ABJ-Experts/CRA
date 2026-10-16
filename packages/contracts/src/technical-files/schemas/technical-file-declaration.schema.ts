import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { z } from "zod";

import { technicalFileProductParamsSchema } from "./technical-file.schema.js";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const expectedVersionSchema = z.number().int().positive();
const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Use a lowercase SHA-256 digest");

/**
 * Pinned legal template metadata. The template and all mandatory content keys
 * are copied into an issued declaration; issuing never renders mutable facts.
 */
export const technicalFileDeclarationTemplateSchema = z
  .object({
    id: z.uuid(),
    key: requiredText(100),
    version: requiredText(80),
    legalAct: requiredText(2_000),
    annex: z.literal("Annex V"),
    language: z
      .string()
      .trim()
      .regex(/^[a-z]{2}(?:-[A-Z]{2})?$/),
    mandatoryContentKeys: z.array(requiredText(100)).min(1).max(32),
    isActive: z.boolean(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const technicalFileDeclarationAssessmentRouteSchema = z.enum([
  "internal_control",
  "eu_type_examination",
  "full_quality_assurance",
]);

export const technicalFileDeclarationCertificateReferenceSchema = z
  .object({
    sourceId: z.uuid(),
    reference: requiredText(300),
    version: requiredText(200),
    issuer: requiredText(300),
  })
  .strict();

export const technicalFileDeclarationNotifiedBodySchema = z
  .object({
    identifier: z
      .string()
      .trim()
      .regex(/^\d{4}$/, "Use the four-digit notified-body identifier"),
    // CRA Annex V requires the identifier where a notified body is involved.
    // A registry name is useful display metadata, but it is not an authority
    // for route selection and may be unavailable in an initial V2 record.
    name: requiredText(300).optional(),
  })
  .strict();

export const technicalFileDeclarationSignatorySchema = z
  .object({
    userId: z.uuid(),
    name: requiredText(300),
    capacity: requiredText(300),
    place: requiredText(300).nullable().optional(),
  })
  .strict();

/** The source facts shown to the issuer, copied into the issued payload. */
export const technicalFileDeclarationSourceProvenanceSchema = z
  .object({
    key: requiredText(100),
    label: requiredText(300),
    sourceKind: z.enum([
      "product",
      "legal_entity",
      "technical_file_source",
      "snapshot",
    ]),
    sourceId: z.uuid().nullable(),
    observedRevision: z.string().trim().min(1).max(200).nullable(),
    value: requiredText(8_000).nullable(),
    status: z.enum(["current", "missing", "stale", "unavailable"]),
  })
  .strict();

export const technicalFileDeclarationMissingFactSchema = z
  .object({
    key: requiredText(100),
    label: requiredText(300),
    reason: requiredText(1_000),
  })
  .strict();

export const technicalFileDeclarationIssuedPayloadSchema = z
  .object({
    schemaVersion: z.literal("m7_05_v1"),
    declarationVersion: expectedVersionSchema,
    template: technicalFileDeclarationTemplateSchema,
    snapshotId: z.uuid(),
    snapshotSha256: sha256Schema,
    signatory: technicalFileDeclarationSignatorySchema,
    assessmentRoute: technicalFileDeclarationAssessmentRouteSchema.nullable(),
    notifiedBody: technicalFileDeclarationNotifiedBodySchema.nullable(),
    certificateReferences: z
      .array(technicalFileDeclarationCertificateReferenceSchema)
      .max(32),
    sourceProvenance: z
      .array(technicalFileDeclarationSourceProvenanceSchema)
      .min(1)
      .max(64),
    issuedAt: z.string().datetime({ offset: true }),
    signatureNotice: z.literal(
      "This declaration identifies a responsible signatory and is not a cryptographic or qualified electronic signature.",
    ),
  })
  .strict();

export const technicalFileDeclarationArtifactSchema = z
  .object({
    fileName: z
      .string()
      .trim()
      .regex(
        /^(?!\.)(?!.*[\\/])(?!.*\.\.)(?=.{1,255}$)[A-Za-z0-9][A-Za-z0-9._ -]*$/,
      ),
    mimeType: z.literal("application/pdf"),
    byteLength: z
      .number()
      .int()
      .positive()
      .max(25 * 1024 * 1024),
    sha256: sha256Schema,
  })
  .strict();

export const technicalFileDeclarationStatusSchema = z.enum([
  "draft",
  "issued",
  "superseded",
]);

export const technicalFileDeclarationSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    productId: z.uuid(),
    snapshotId: z.uuid(),
    templateId: z.uuid(),
    version: expectedVersionSchema,
    /** Optimistic-concurrency revision of mutable draft fields only. */
    draftVersion: expectedVersionSchema,
    status: technicalFileDeclarationStatusSchema,
    signatory: technicalFileDeclarationSignatorySchema,
    assessmentRoute: technicalFileDeclarationAssessmentRouteSchema.nullable(),
    notifiedBody: technicalFileDeclarationNotifiedBodySchema.nullable(),
    certificateReferences: z
      .array(technicalFileDeclarationCertificateReferenceSchema)
      .max(32),
    sourceProvenance: z
      .array(technicalFileDeclarationSourceProvenanceSchema)
      .max(64),
    missingFacts: z.array(technicalFileDeclarationMissingFactSchema).max(32),
    previewDigest: sha256Schema,
    snapshotSha256: sha256Schema,
    issuedPayload: technicalFileDeclarationIssuedPayloadSchema.nullable(),
    issuedArtifact: technicalFileDeclarationArtifactSchema.nullable(),
    issuedAt: z.string().datetime({ offset: true }).nullable(),
    supersededByDeclarationId: z.uuid().nullable(),
    supersedesDeclarationId: z.uuid().nullable(),
    reissueReason: z.string().trim().min(1).max(2_000).nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    const notifiedRoute =
      value.assessmentRoute !== null &&
      value.assessmentRoute !== "internal_control";
    if (
      notifiedRoute &&
      (!value.notifiedBody || value.certificateReferences.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["notifiedBody"],
        message:
          "Notified-body routes require a notified body and certificate reference",
      });
    }
    if (
      (value.assessmentRoute === null ||
        value.assessmentRoute === "internal_control") &&
      (value.notifiedBody || value.certificateReferences.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["assessmentRoute"],
        message:
          "Internal control cannot include notified-body or certificate data",
      });
    }
    const issued = value.status === "issued" || value.status === "superseded";
    const hasCompleteIssuedContent =
      value.issuedPayload !== null &&
      value.issuedArtifact !== null &&
      value.issuedAt !== null;
    const hasAnyIssuedContent =
      value.issuedPayload !== null ||
      value.issuedArtifact !== null ||
      value.issuedAt !== null;
    if (
      (issued && !hasCompleteIssuedContent) ||
      (!issued && hasAnyIssuedContent)
    ) {
      context.addIssue({
        code: "custom",
        path: ["issuedPayload"],
        message:
          "Only issued declarations have immutable issued content and bytes",
      });
    }
    if (value.status === "superseded" && !value.supersededByDeclarationId) {
      context.addIssue({
        code: "custom",
        path: ["supersededByDeclarationId"],
        message: "Superseded declarations require a successor",
      });
    }
    if (value.status !== "superseded" && value.supersededByDeclarationId) {
      context.addIssue({
        code: "custom",
        path: ["supersededByDeclarationId"],
        message: "Only superseded declarations reference a successor",
      });
    }
    if (value.supersedesDeclarationId !== null && !value.reissueReason) {
      context.addIssue({
        code: "custom",
        path: ["reissueReason"],
        message: "Reissues require a reason",
      });
    }
  });

export const technicalFileDeclarationPreviewSchema = z
  .object({
    template: technicalFileDeclarationTemplateSchema,
    snapshotId: z.uuid(),
    snapshotSha256: sha256Schema,
    expectedVersion: expectedVersionSchema,
    // A snapshot-only preview identifies the current human but deliberately
    // has no made-up capacity or place. Those are supplied in a draft.
    signatory: z
      .object({
        userId: z.uuid(),
        name: requiredText(300),
        capacity: z.string().trim().max(300).optional(),
        place: z.string().trim().max(300).nullable().optional(),
      })
      .strict(),
    assessmentRoute: technicalFileDeclarationAssessmentRouteSchema.nullable(),
    notifiedBody: technicalFileDeclarationNotifiedBodySchema.nullable(),
    certificateReferences: z
      .array(technicalFileDeclarationCertificateReferenceSchema)
      .max(32),
    sourceProvenance: z
      .array(technicalFileDeclarationSourceProvenanceSchema)
      .max(64),
    missingFacts: z.array(technicalFileDeclarationMissingFactSchema).max(32),
    readinessStatus: z.enum(["empty", "partial", "complete", "stale"]),
    canIssue: z.boolean(),
    previewDigest: sha256Schema,
  })
  .strict();

const declarationDraftFieldsSchema = z.object({
  snapshotId: z.uuid(),
  expectedVersion: expectedVersionSchema,
  signatoryCapacity: requiredText(300),
  // Annex V requires the place of issue.  Keeping this mandatory at the
  // boundary prevents adapters from substituting a made-up default.
  signatoryPlace: requiredText(300),
  assessmentRoute: technicalFileDeclarationAssessmentRouteSchema
    .nullable()
    .default(null),
  notifiedBody: technicalFileDeclarationNotifiedBodySchema
    .nullable()
    .optional(),
  certificateReferences: z
    .array(technicalFileDeclarationCertificateReferenceSchema)
    .max(32)
    .optional(),
  idempotencyKey: idempotencyKeySchema,
});

export const createTechnicalFileDeclarationDraftRequestSchema =
  declarationDraftFieldsSchema.strict().superRefine((value, context) => {
    const certificates = value.certificateReferences ?? [];
    if (
      (value.assessmentRoute === null ||
        value.assessmentRoute === "internal_control") &&
      (value.notifiedBody || certificates.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["assessmentRoute"],
        message:
          "Internal control cannot include notified-body or certificate data",
      });
    }
    if (
      value.assessmentRoute !== null &&
      value.assessmentRoute !== "internal_control" &&
      (!value.notifiedBody || certificates.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["notifiedBody"],
        message:
          "Notified-body routes require a notified body and certificate reference",
      });
    }
  });

export const updateTechnicalFileDeclarationDraftRequestSchema =
  createTechnicalFileDeclarationDraftRequestSchema;
export const issueTechnicalFileDeclarationRequestSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    previewDigest: sha256Schema,
    snapshotSha256: sha256Schema,
    confirmIssue: z.literal(true),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const reissueTechnicalFileDeclarationRequestSchema =
  declarationDraftFieldsSchema
    .extend({
      expectedCurrentVersion: expectedVersionSchema,
      reason: requiredText(2_000),
    })
    .omit({ expectedVersion: true })
    .strict()
    .superRefine((value, context) => {
      const certificates = value.certificateReferences ?? [];
      if (
        value.assessmentRoute !== null &&
        value.assessmentRoute !== "internal_control" &&
        (!value.notifiedBody || certificates.length === 0)
      ) {
        context.addIssue({
          code: "custom",
          path: ["notifiedBody"],
          message:
            "Notified-body routes require a notified body and certificate reference",
        });
      }
    });

export const technicalFileDeclarationParamsSchema =
  technicalFileProductParamsSchema.extend({ declarationId: z.uuid() }).strict();
export const technicalFileDeclarationDownloadResponseSchema = z
  .object({
    download: z
      .object({
        artifact: technicalFileDeclarationArtifactSchema,
        downloadUrl: z.url().max(4_000),
        expiresAt: z.string().datetime({ offset: true }),
      })
      .strict(),
  })
  .strict();
export const technicalFileDeclarationPreviewResponseSchema = z
  .object({ preview: technicalFileDeclarationPreviewSchema })
  .strict();
export const technicalFileDeclarationResponseSchema = z
  .object({ declaration: technicalFileDeclarationSchema })
  .strict();
export const technicalFileDeclarationsResponseSchema = z
  .object({ declarations: z.array(technicalFileDeclarationSchema) })
  .strict();
export const technicalFileDeclarationConflictResponseSchema = z
  .object({
    code: z.literal("version_conflict"),
    message: requiredText(500),
    currentVersion: expectedVersionSchema,
  })
  .strict();
