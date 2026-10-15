import { z } from "zod";
import { backupAssuranceSchema } from "../../backups/schemas/index.js";
import {
  customerSystemHealthQuerySchema,
  customerSystemHealthResponseSchema,
  systemHealthComponentSchema,
} from "./system-health.schema.js";

/** Version 1 remains the default and retains its unavailable backup authority. */
export const customerSystemHealthV2QuerySchema = z.strictObject({
  schemaVersion: z
    .union([z.literal(2), z.literal("2")])
    .transform(() => 2 as const),
});
export const customerSystemHealthVersionedQuerySchema = z.union([
  customerSystemHealthQuerySchema,
  customerSystemHealthV2QuerySchema,
]);
export const systemHealthV2ComponentSchema = z
  .strictObject({
    ...systemHealthComponentSchema.shape,
    reasons: z
      .array(
        z.union([
          systemHealthComponentSchema.shape.reasons.element,
          backupAssuranceSchema.shape.reasons.element,
        ]),
      )
      .max(30),
  })
  .refine(
    (value) =>
      value.status !== "healthy" ||
      (value.sourceAt !== null &&
        value.observedAt !== null &&
        value.reasons.length === 0),
    "Healthy components require source and observation timestamps and no reasons",
  )
  .refine(
    (value) => (value.id === "backups") === (value.source === "m15_05"),
    "Backup component authority must come from M15-05",
  );
export const customerSystemHealthV2ResponseSchema = z
  .strictObject({
    ...customerSystemHealthResponseSchema.shape,
    schemaVersion: z.literal(2),
    components: z.array(systemHealthV2ComponentSchema).max(20),
    backup: backupAssuranceSchema,
  })
  .refine(
    (value) =>
      !value.components.some(
        (component) =>
          component.id === "backups" && component.status === "healthy",
      ) || value.backup.status === "verified",
    "Healthy backup components require verified restoration assurance",
  );
export const customerSystemHealthVersionedResponseSchema = z.union([
  customerSystemHealthResponseSchema,
  customerSystemHealthV2ResponseSchema,
]);
