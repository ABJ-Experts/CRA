import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { utcZDateTimeSchema } from "../../products/schemas/release-market-lifecycle.schema.js";
import { syncPermittedFieldActionSchema } from "./sync-run.schema.js";
import { z } from "zod";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const expectedVersionSchema = z.number().int().nonnegative();

export const syncConflictEntityTypeSchema = z.enum([
  "product",
  "release",
  "baseline",
  "relationship",
]);
export const syncConflictKindSchema = z.enum([
  "field_value",
  "deletion_vs_active_use",
  "cycle",
  "duplicate_identity",
]);
export const syncConflictValueSourceSchema = z.enum([
  "cra_manual_entry",
  "prior_sync_apply",
]);
export const syncConflictResolutionStatusSchema = z.enum([
  "open",
  "resolved",
  "superseded",
]);
/** Reuses the same closed set a field diff may offer; a conflict is a field diff that blocked. */
export const syncConflictChosenActionSchema = syncPermittedFieldActionSchema;

export const syncConflictParamsSchema = z
  .object({ connectorId: z.uuid(), conflictId: z.uuid() })
  .strict();

/** The conflict routes are flat (`/connectors/conflicts/:conflictId`), not
 * nested under a connector segment -- a conflict id alone is unambiguous. */
export const conflictParamsSchema = z.object({ conflictId: z.uuid() }).strict();

export const syncConflictSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    connectorId: z.uuid(),
    syncRunId: z.uuid(),
    // A first-run hierarchy conflict is bound to its immutable dry-run plan
    // item until product materialization creates the external identity.
    externalIdentityId: z.uuid().nullable(),
    entityType: syncConflictEntityTypeSchema,
    entityId: z.uuid().nullable(),
    fieldPath: requiredText(200),
    conflictKind: syncConflictKindSchema,
    craValue: z.unknown(),
    craValueSource: syncConflictValueSourceSchema,
    craValueObservedAt: utcZDateTimeSchema,
    externalValue: z.unknown(),
    externalValueObservedAt: utcZDateTimeSchema,
    detectedAt: utcZDateTimeSchema,
    authorityPolicyId: z.uuid().nullable(),
    permittedActions: z.array(syncPermittedFieldActionSchema).min(1),
    resolutionStatus: syncConflictResolutionStatusSchema,
    resolutionChosenAction: syncConflictChosenActionSchema.nullable(),
    resolutionValue: z.unknown().nullable(),
    resolutionReason: requiredText(1_000).nullable(),
    resolvedBy: z.uuid().nullable(),
    resolvedAt: utcZDateTimeSchema.nullable(),
    version: z.number().int().positive(),
  })
  .strict()
  .superRefine((conflict, context) => {
    if (
      conflict.resolutionChosenAction !== null &&
      !conflict.permittedActions.includes(conflict.resolutionChosenAction)
    ) {
      context.addIssue({
        code: "custom",
        path: ["resolutionChosenAction"],
        message: "The chosen action must be one of the permitted actions",
      });
    }
    const resolvedFieldsSet = [
      conflict.resolutionChosenAction !== null,
      conflict.resolvedBy !== null,
      conflict.resolvedAt !== null,
    ];
    const open = conflict.resolutionStatus === "open";
    if (
      open ? resolvedFieldsSet.some(Boolean) : !resolvedFieldsSet.every(Boolean)
    ) {
      context.addIssue({
        code: "custom",
        path: ["resolutionStatus"],
        message:
          "Resolution fields must be complete exactly when the conflict is not open",
      });
    }
    if (!open && conflict.resolutionReason === null) {
      context.addIssue({
        code: "custom",
        path: ["resolutionReason"],
        message: "A resolved or superseded conflict requires a reason",
      });
    }
  });

export const resolveSyncConflictInputSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    chosenAction: syncConflictChosenActionSchema,
    manualValue: z.unknown().optional(),
    reason: requiredText(1_000),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (
      (input.chosenAction === "enter_manual_value") !==
      (input.manualValue !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["manualValue"],
        message: "A manual value is required only when entering a manual value",
      });
    }
  });
