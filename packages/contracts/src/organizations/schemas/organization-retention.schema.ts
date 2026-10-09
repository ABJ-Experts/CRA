import { z } from "zod";

const retentionDaysSchema = z.number().int().min(0).max(36500);

/**
 * Stable wire grammar only. The API validates this identifier against the
 * organization-supported evidence classes before a retention mutation.
 */
export const evidenceClassIdentifierSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]{0,63}$/, "Use a lowercase evidence class identifier");

export const retentionFloorReasonKindSchema = z.enum([
  "product",
  "evidence_class",
  "obligation",
  "legal_hold",
]);

export const retentionFloorReasonSchema = z
  .object({
    kind: retentionFloorReasonKindSchema,
    recordId: z.uuid(),
    requiredRetentionDays: retentionDaysSchema,
  })
  .strict();

export const retentionPolicyUpdateInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    evidenceClass: evidenceClassIdentifierSchema,
    requestedRetentionDays: retentionDaysSchema,
  })
  .strict();

const retentionPolicyFieldsSchema = z
  .object({
    id: z.uuid(),
    evidenceClass: evidenceClassIdentifierSchema,
    version: z.number().int().positive(),
    requestedRetentionDays: retentionDaysSchema,
    effectiveRetentionDays: retentionDaysSchema,
    effectiveFloorDays: retentionDaysSchema,
    controllingReasons: z.array(retentionFloorReasonSchema),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const retentionPolicySchema = retentionPolicyFieldsSchema.superRefine(
  (value, context) => {
    const expectedFloor = Math.max(
      0,
      ...value.controllingReasons.map((reason) => reason.requiredRetentionDays),
    );
    if (value.effectiveFloorDays !== expectedFloor) {
      context.addIssue({
        code: "custom",
        message: "Effective floor must reflect every controlling reason",
        path: ["effectiveFloorDays"],
      });
    }
    if (
      value.effectiveRetentionDays !==
      Math.max(value.requestedRetentionDays, value.effectiveFloorDays)
    ) {
      context.addIssue({
        code: "custom",
        message: "Effective retention must honor the configured floor",
        path: ["effectiveRetentionDays"],
      });
    }
  },
);

export const retentionPolicySetSchema = z
  .array(retentionPolicySchema)
  .min(1, "Return a policy for every configured evidence class")
  .superRefine((policies, context) => {
    const evidenceClasses = policies.map((policy) => policy.evidenceClass);
    if (new Set(evidenceClasses).size !== evidenceClasses.length) {
      context.addIssue({
        code: "custom",
        message:
          "Evidence classes must be unique within a retention policy set",
      });
    }
  });

export const retentionPolicyResponseSchema = z
  .object({ policies: retentionPolicySetSchema })
  .strict();
