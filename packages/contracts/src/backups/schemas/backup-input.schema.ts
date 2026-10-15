import { z } from "zod";
import {
  backupAliasSchema,
  backupDigestSchema,
  backupPolicyConfigurationSchema,
} from "./backup-values.schema.js";
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const backupMutationSchema = z.strictObject({
  expectedVersion: version,
  idempotencyKey: z.uuid(),
});
export const backupPolicyInputSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  idempotencyKey: z.uuid(),
  configuration: backupPolicyConfigurationSchema,
});
export const backupPolicyValidationInputSchema = z.strictObject({
  configuration: backupPolicyConfigurationSchema,
});
export const backupRunRequestSchema = backupMutationSchema;
export const backupVerificationRequestSchema = backupMutationSchema.extend({
  targetProfile: backupAliasSchema,
});
export const backupCleanupInputSchema = backupMutationSchema.extend({
  reviewFingerprint: backupDigestSchema,
});
export const backupCleanupReviewInputSchema = z.strictObject({
  expectedVersion: version,
});
export const backupInstanceParamsSchema = z.strictObject({
  instanceId: z.uuid(),
});
export const backupRunParamsSchema = backupInstanceParamsSchema.extend({
  runId: z.uuid(),
});
export const backupCustomerRunParamsSchema = z.strictObject({
  runId: z.uuid(),
});
export const backupEmptyQuerySchema = z.strictObject({});
const limit = z
  .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
  .pipe(z.number().int().min(1).max(100))
  .default(25);
export const backupHistoryQuerySchema = z.strictObject({
  limit,
  cursor: z.uuid().optional(),
  kind: z.enum(["capture", "verification"]).optional(),
});
