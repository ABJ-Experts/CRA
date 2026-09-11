import { organizationAdministrationErrorSchema } from "./organization-export.schema.js";
import { retentionFloorReasonSchema } from "./organization-retention.schema.js";
import { z } from "zod";

export const organizationLifecycleStatusSchema = z.enum([
  "active",
  "deactivated",
  "purge_scheduled",
  "purge_blocked",
  "purging",
  "purged",
]);

/** A blocking retention reason projected for the lifecycle state, not a new authority. */
export const organizationLifecycleControllingBlockerSchema =
  retentionFloorReasonSchema;

/** Safe operational codes intentionally reveal neither provider nor raw failure detail. */
export const organizationLifecycleFailureBlockerCodeSchema = z.enum([
  "dependency_unavailable",
  "worker_failure",
]);

export const organizationLifecycleFailureBlockerSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("unavailable"),
        code: z.literal("dependency_unavailable"),
      })
      .strict(),
    z
      .object({
        kind: z.literal("worker_failure"),
        code: z.literal("worker_failure"),
      })
      .strict(),
  ],
);

export const organizationLifecycleBlockerSchema = z.union([
  organizationLifecycleControllingBlockerSchema,
  organizationLifecycleFailureBlockerSchema,
]);

const organizationLifecycleFieldsSchema = z
  .object({
    status: organizationLifecycleStatusSchema,
    version: z.number().int().nonnegative(),
    changedAt: z.iso.datetime({ offset: true }),
    blockers: z.array(organizationLifecycleBlockerSchema),
    error: organizationAdministrationErrorSchema.nullable(),
  })
  .strict();

export const organizationLifecycleSchema =
  organizationLifecycleFieldsSchema.superRefine((value, context) => {
    const isBlocked = value.status === "purge_blocked";
    if (isBlocked && value.blockers.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Purge-blocked lifecycle states require at least one blocker",
        path: ["blockers"],
      });
    }
    if (!isBlocked && value.blockers.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Only purge-blocked lifecycle states can contain blockers",
        path: ["blockers"],
      });
    }
  });

export const organizationLifecycleResponseSchema = z
  .object({ lifecycle: organizationLifecycleSchema })
  .strict();

/** Fresh challenge material only; handlers must never persist or log this value. */
export const destructiveMfaCodeSchema = z
  .string()
  .length(6)
  .regex(/^\d{6}$/, "Enter the 6-digit code");

export const destructiveReauthenticationInputSchema = z
  .object({
    password: z.string().min(1).max(1024),
    mfaCode: destructiveMfaCodeSchema.optional(),
  })
  .strict();

export const destructiveReauthenticationResponseSchema = z
  .object({
    reauthenticationGrantId: z.uuid(),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const deactivateOrganizationInputSchema = z
  .object({
    reauthenticationGrantId: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    confirmation: z.literal("DEACTIVATE ORGANIZATION"),
  })
  .strict();

/**
 * Structural confirmation only. The verified API/DB boundary must compare the
 * parsed slug to the selected organization's canonical slug exactly.
 */
export const organizationDeletionConfirmationSchema = z
  .string()
  .max(71)
  .regex(
    /^DELETE [a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Type DELETE followed by the organization slug",
  );

export const scheduleOrganizationPurgeInputSchema = z
  .object({
    reauthenticationGrantId: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    confirmation: organizationDeletionConfirmationSchema,
  })
  .strict();

export const recoverOrganizationInputSchema = z
  .object({
    reauthenticationGrantId: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
