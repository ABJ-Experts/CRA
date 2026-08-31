import { z } from "zod";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);

export const fieldAuthorityEntityTypeSchema = z.enum(["product", "release"]);
export const fieldAuthorityPolicyValueSchema = z.enum([
  "external_authoritative",
  "cra_authoritative",
  "newest_with_review",
  "manual_only",
]);
/** Mirrors `m2_v2_valid_field_authority_field`'s product branch. */
export const productFieldAuthorityFieldSchema = z.enum([
  "name",
  "internalCode",
  "productType",
  "description",
  "parentExternalId",
]);
/** Mirrors `m2_v2_valid_field_authority_field`'s release branch. */
export const releaseFieldAuthorityFieldSchema = z.enum([
  "label",
  "releaseVersion",
  "description",
]);

export const fieldAuthorityPolicyParamsSchema = z
  .object({ connectorId: z.uuid() })
  .strict();

function isValidFieldAuthorityField(
  entityType: z.output<typeof fieldAuthorityEntityTypeSchema>,
  fieldName: string,
): boolean {
  return entityType === "product"
    ? productFieldAuthorityFieldSchema.safeParse(fieldName).success
    : releaseFieldAuthorityFieldSchema.safeParse(fieldName).success;
}

export const fieldAuthorityPolicySchema = z
  .object({
    id: z.uuid(),
    connectorId: z.uuid(),
    entityType: fieldAuthorityEntityTypeSchema,
    fieldName: requiredText(100),
    policyValue: fieldAuthorityPolicyValueSchema,
    protected: z.boolean(),
    protectedReason: requiredText(500).nullable(),
    policyVersion: z.number().int().positive(),
  })
  .strict()
  .superRefine((policy, context) => {
    if (!isValidFieldAuthorityField(policy.entityType, policy.fieldName)) {
      context.addIssue({
        code: "custom",
        path: ["fieldName"],
        message: "Unsupported field for this entity type",
      });
    }
    if (policy.protected !== (policy.protectedReason !== null)) {
      context.addIssue({
        code: "custom",
        path: ["protectedReason"],
        message:
          "A protected field requires a reason, and only a protected field carries one",
      });
    }
    if (policy.protected && policy.policyValue === "external_authoritative") {
      context.addIssue({
        code: "custom",
        path: ["policyValue"],
        message: "A protected field can never be external-authoritative",
      });
    }
  });

export const upsertFieldAuthorityPolicyInputSchema = z
  .object({
    entityType: fieldAuthorityEntityTypeSchema,
    fieldName: requiredText(100),
    policyValue: fieldAuthorityPolicyValueSchema,
    protected: z.boolean(),
    protectedReason: requiredText(500).optional(),
    /** Returned from the bounded server-side preview. Persistence recomputes
     * this digest under the connector/policy lock, rejecting stale previews. */
    previewDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/, "Use a lowercase SHA-256"),
  })
  .strict()
  .superRefine((input, context) => {
    if (!isValidFieldAuthorityField(input.entityType, input.fieldName)) {
      context.addIssue({
        code: "custom",
        path: ["fieldName"],
        message: "Unsupported field for this entity type",
      });
    }
    if (input.protected !== (input.protectedReason !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["protectedReason"],
        message:
          "A protected field requires a reason, and only a protected field carries one",
      });
    }
    if (input.protected && input.policyValue === "external_authoritative") {
      context.addIssue({
        code: "custom",
        path: ["policyValue"],
        message: "A protected field can never be external-authoritative",
      });
    }
  });

/** Body for `POST .../mapping/preview` -- same shape as the upsert input,
 * minus persistence; previewing never writes a policy row. */
export const previewFieldAuthorityPolicyInputSchema = z
  .object({
    entityType: fieldAuthorityEntityTypeSchema,
    fieldName: requiredText(100),
    policyValue: fieldAuthorityPolicyValueSchema,
    protected: z.boolean(),
    protectedReason: requiredText(500).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (!isValidFieldAuthorityField(input.entityType, input.fieldName)) {
      context.addIssue({
        code: "custom",
        path: ["fieldName"],
        message: "Unsupported field for this entity type",
      });
    }
    if (input.protected !== (input.protectedReason !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["protectedReason"],
        message:
          "A protected field requires a reason, and only a protected field carries one",
      });
    }
    if (input.protected && input.policyValue === "external_authoritative") {
      context.addIssue({
        code: "custom",
        path: ["policyValue"],
        message: "A protected field can never be external-authoritative",
      });
    }
  });

const fieldAuthorityImpactSampleDiffSchema = z
  .object({
    externalId: requiredText(500),
    field: requiredText(100),
    craValue: z.unknown(),
    externalValue: z.unknown(),
  })
  .strict();

/** A synchronous, non-persisted preview computed from a caller-supplied sample. */
export const fieldAuthorityImpactPreviewSchema = z
  .object({
    wouldCreate: z.number().int().nonnegative(),
    wouldUpdate: z.number().int().nonnegative(),
    wouldBeIgnored: z.number().int().nonnegative(),
    wouldConflict: z.number().int().nonnegative(),
    sampleDiffs: z.array(fieldAuthorityImpactSampleDiffSchema).max(50),
    previewDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/, "Use a lowercase SHA-256"),
  })
  .strict();
