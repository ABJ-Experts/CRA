import { z } from "zod";

const SETTINGS_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const IANA_TIMEZONE_PATTERN =
  /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z][A-Za-z0-9_+-]*)+$/;

function addDuplicateIssue(
  values: readonly string[],
  context: z.RefinementCtx,
  message: string,
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", message });
  }
}

const nonEmptyIdentifierSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(SETTINGS_IDENTIFIER_PATTERN, "Use a lowercase settings identifier");

export const ianaTimezoneSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(IANA_TIMEZONE_PATTERN, "Use an IANA timezone identifier");

export const workingDaySchema = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

export const localDateSchema = z.iso.date();

export const maximumSessionAgeMinutesSchema = z
  .number()
  .int()
  .min(5)
  .max(43200);

export const organizationSettingsValuesSchema = z
  .object({
    timezone: ianaTimezoneSchema,
    workingDays: z
      .array(workingDaySchema)
      .min(1)
      .superRefine((values, context) =>
        addDuplicateIssue(values, context, "Working days must be unique"),
      ),
    holidays: z
      .array(localDateSchema)
      .superRefine((values, context) =>
        addDuplicateIssue(values, context, "Holidays must be unique"),
      ),
    notificationChannelIds: z
      .array(nonEmptyIdentifierSchema)
      .superRefine((values, context) =>
        addDuplicateIssue(
          values,
          context,
          "Notification channel identifiers must be unique",
        ),
      ),
    mfaEnforcementDate: localDateSchema.nullable(),
    maximumSessionAgeMinutes: maximumSessionAgeMinutesSchema,
    aiProviderId: nonEmptyIdentifierSchema,
    dataResidencyId: nonEmptyIdentifierSchema,
  })
  .strict();

export const updateOrganizationSettingsInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    values: organizationSettingsValuesSchema,
  })
  .strict();

export const organizationSettingsSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("unconfigured"),
      version: z.literal(0),
      values: z.null(),
    })
    .strict(),
  z
    .object({
      status: z.literal("configured"),
      version: z.number().int().positive(),
      values: organizationSettingsValuesSchema,
    })
    .strict(),
]);

/** Authoritative aggregate only; individual member identities never cross this boundary. */
export const mfaRolloutReadinessSchema = z
  .object({
    enrolledMemberCount: z.number().int().nonnegative(),
    unenrolledMemberCount: z.number().int().nonnegative(),
    safeToEnforce: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.safeToEnforce !== (value.unenrolledMemberCount === 0)) {
      context.addIssue({
        code: "custom",
        message:
          "MFA enforcement readiness must reflect the unenrolled member count",
        path: ["safeToEnforce"],
      });
    }
  });

export const organizationSettingsResponseSchema = z
  .object({
    settings: organizationSettingsSchema,
    mfaRolloutReadiness: mfaRolloutReadinessSchema,
  })
  .strict();

export const organizationSettingsCatalogSchema = z
  .object({
    timezones: z
      .array(ianaTimezoneSchema)
      .min(1)
      .superRefine((values, context) =>
        addDuplicateIssue(
          values,
          context,
          "Timezone identifiers must be unique",
        ),
      ),
    notificationChannels: z
      .array(nonEmptyIdentifierSchema)
      .superRefine((values, context) =>
        addDuplicateIssue(
          values,
          context,
          "Notification channel identifiers must be unique",
        ),
      ),
    aiProviders: z
      .array(nonEmptyIdentifierSchema)
      .superRefine((values, context) =>
        addDuplicateIssue(
          values,
          context,
          "AI provider identifiers must be unique",
        ),
      ),
    dataResidencies: z
      .array(nonEmptyIdentifierSchema)
      .superRefine((values, context) =>
        addDuplicateIssue(
          values,
          context,
          "Data residency identifiers must be unique",
        ),
      ),
    minimumSessionAgeMinutes: maximumSessionAgeMinutesSchema,
    maximumSessionAgeMinutes: maximumSessionAgeMinutesSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.minimumSessionAgeMinutes > value.maximumSessionAgeMinutes) {
      context.addIssue({
        code: "custom",
        message: "Minimum session age cannot exceed maximum session age",
        path: ["minimumSessionAgeMinutes"],
      });
    }
  });

export const organizationSettingsCatalogResponseSchema = z
  .object({ catalog: organizationSettingsCatalogSchema })
  .strict();
