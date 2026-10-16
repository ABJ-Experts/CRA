import { z } from "zod";

import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import {
  SBOM_MAX_UPLOAD_BYTES,
  safeSbomFileNameSchema,
  sbomDeclaredFormatSchema,
  sbomMediaTypeSchema,
  sbomSourceSchema,
  sbomUploadInstructionSchema,
  sbomUploadCompletionResponseSchema,
} from "./sbom.schema.js";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const utcDateTimeSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const allowedRefSchema = z.string().min(12).max(500)
  .regex(/^refs\/(?:heads|tags)\/[A-Za-z0-9._/-]+$/)
  .refine((value) => !value.includes("..") && !value.includes("//") && !value.endsWith("/"));

export const ciProviderSchema = z.enum([
  "github_actions",
  "gitlab_ci",
  "azure_devops",
]);

export const ciProviderHostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(253)
  .regex(
    /^(?!localhost$)(?!\d+\.\d+\.\d+\.\d+$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/,
    "Use an approved DNS hostname",
  );

export const ciRepositoryIdentitySchema = z
  .object({
    provider: ciProviderSchema,
    providerHost: ciProviderHostSchema,
    repositoryOwner: requiredText(120),
    repositoryName: requiredText(160),
    repositoryId: requiredText(160),
  })
  .strict();

export const ciProviderReleaseBindingSchema = ciRepositoryIdentitySchema
  .extend({
    id: z.uuid(),
    connectorId: z.uuid(),
    connectionRevision: z.number().int().positive(),
    credentialRevision: z.number().int().positive(),
    organizationId: z.uuid(),
    productId: z.uuid(),
    releaseId: z.uuid(),
    credentialId: z.uuid(),
    providerInstallationId: requiredText(160).nullable(),
    projectKey: requiredText(200).nullable(),
    pipelineDefinitionId: requiredText(200).nullable(),
    allowedRef: allowedRefSchema,
    status: z.enum(["active", "revoked"]),
    version: z.number().int().positive(),
    createdAt: utcDateTimeSchema,
    updatedAt: utcDateTimeSchema,
  })
  .strict();

export const upsertCiProviderReleaseBindingInputSchema =
  ciRepositoryIdentitySchema
    .extend({
      connectorId: z.uuid(),
      productId: z.uuid(),
      releaseId: z.uuid(),
      credentialId: z.uuid(),
      providerInstallationId: requiredText(160).optional(),
      projectKey: requiredText(200).optional(),
      pipelineDefinitionId: requiredText(200).optional(),
      allowedRef: allowedRefSchema,
      expectedBindingId: z.uuid().optional(),
      expectedVersion: z.number().int().positive().optional(),
      idempotencyKey: idempotencyKeySchema,
    })
    .strict()
    .superRefine((input, context) => {
      if (Boolean(input.expectedBindingId) !== Boolean(input.expectedVersion)) {
        context.addIssue({
          code: "custom",
          path: ["expectedVersion"],
          message: "Updates require the binding ID and current version together",
        });
      }
      if (
        input.provider === "github_actions" &&
        !input.providerInstallationId
      ) {
        context.addIssue({
          code: "custom",
          path: ["providerInstallationId"],
          message: "GitHub Actions bindings require a GitHub App installation",
        });
      }
      if (input.provider !== "github_actions" && input.providerInstallationId) {
        context.addIssue({
          code: "custom",
          path: ["providerInstallationId"],
          message: "Only GitHub Actions uses installation identity",
        });
      }
      if (input.provider === "azure_devops" &&
        (!input.projectKey || !input.pipelineDefinitionId)) {
        context.addIssue({
          code: "custom",
          path: ["pipelineDefinitionId"],
          message: "Azure bindings require project and pipeline IDs",
        });
      }
    });

export const revokeCiProviderReleaseBindingInputSchema = z
  .object({
    expectedBindingId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    idempotencyKey: idempotencyKeySchema,
    reason: requiredText(500),
  })
  .strict();

export const ciBuildReferenceSchema = z
  .object({
    bindingId: z.uuid(),
    runId: requiredText(200),
    runAttempt: requiredText(80),
  })
  .strict();

/** Parsed provider response, produced inside the API after provider verification. */
export const ciBuildMetadataSchema = ciRepositoryIdentitySchema
  .extend({
    bindingId: z.uuid(),
    providerInstallationId: requiredText(160).optional(),
    projectKey: requiredText(200).optional(),
    pipelineDefinitionId: requiredText(200).optional(),
    runId: requiredText(200),
    runAttempt: requiredText(80),
    jobId: requiredText(200).optional(),
    ref: requiredText(500),
    commitSha: z.string().regex(/^[a-f0-9]{40}$/),
    eventName: z.enum([
      "push",
      "pipeline",
      "build",
      "release",
      "manual",
    ]),
    observedAt: utcDateTimeSchema,
  })
  .strict();

export const ciInitializeSbomWithBuildInputSchema = ciBuildReferenceSchema
  .extend({
    fileName: safeSbomFileNameSchema,
    mediaType: sbomMediaTypeSchema,
    byteSize: z.number().int().min(1).max(SBOM_MAX_UPLOAD_BYTES),
    sha256: sha256Schema,
    declaredFormat: sbomDeclaredFormatSchema.optional(),
    declaredSpecVersion: requiredText(40).optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const ciCompleteSbomWithBuildInputSchema = ciBuildReferenceSchema
  .extend({
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const ciProviderReleaseBindingParamsSchema = z
  .object({ bindingId: z.uuid() })
  .strict();

export const ciBuildParamsSchema = ciBuildReferenceSchema;

export const ciProviderWebhookParamsSchema = z.object({
  provider: z.enum(["github_actions", "gitlab_ci"]),
  organizationId: z.uuid(),
  bindingId: z.uuid(),
}).strict();

export const ciBuildGatePolicySchema = z.literal("unconfigured");
export const ciBuildGateStateSchema = z.enum([
  "pending",
  "error",
  "policy_not_configured",
]);

export const ciBuildGateVerdictSchema = z
  .object({
    policy: ciBuildGatePolicySchema,
    state: ciBuildGateStateSchema,
    buildRunId: z.uuid().nullable(),
    sourceId: z.uuid().nullable(),
    jobId: z.uuid().nullable(),
    correlationId: requiredText(200),
    message: requiredText(500),
    checkedAt: utcDateTimeSchema,
  })
  .strict();

export const ciProviderReleaseBindingResponseSchema = z
  .object({ binding: ciProviderReleaseBindingSchema })
  .strict();
export const ciProviderReleaseBindingsResponseSchema = z
  .object({ bindings: z.array(ciProviderReleaseBindingSchema).max(100) })
  .strict();
export const ciBuildGateVerdictResponseSchema = z
  .object({ verdict: ciBuildGateVerdictSchema })
  .strict();

export const ciBuildUploadInitializationResponseSchema = z.union([
  z.object({
    source: sbomSourceSchema,
    upload: sbomUploadInstructionSchema,
    buildRunId: z.uuid(),
  }).strict(),
  z.object({
    source: sbomSourceSchema.extend({
      status: z.literal("verified"),
      completedAt: utcDateTimeSchema,
    }),
    upload: z.null(),
    replayed: z.literal(true),
    buildRunId: z.uuid(),
  }).strict(),
]);
export const ciBuildUploadCompletionResponseSchema =
  sbomUploadCompletionResponseSchema.extend({ buildRunId: z.uuid() });

export const ciBindingRunsQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(50).default(20) })
  .strict();

export const ciBuildRunSummarySchema = z
  .object({
    id: z.uuid(),
    bindingId: z.uuid(),
    runId: requiredText(200),
    runAttempt: requiredText(80).nullable(),
    commitSha: z.string().regex(/^[a-f0-9]{40}$/),
    ref: requiredText(500),
    sourceId: z.uuid().nullable(),
    jobId: z.uuid().nullable(),
    state: ciBuildGateStateSchema,
    createdAt: utcDateTimeSchema,
  })
  .strict();

export const ciBindingRunsResponseSchema = z
  .object({ runs: z.array(ciBuildRunSummarySchema).max(50) })
  .strict();
