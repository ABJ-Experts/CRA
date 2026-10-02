import { z } from "zod";

export const EU27_MEMBER_STATE_CODES = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
] as const;

const expectedVersionSchema = z.number().int().nonnegative();
const meaningfulReasonSchema = z.string().trim().min(1).max(1_000);

/** Input and output timestamps are UTC instants, never local-time approximations. */
export const utcZDateTimeSchema = z.iso
  .datetime({ offset: true })
  .endsWith("Z", { error: "Use a UTC timestamp ending in Z" });

export const memberStateCountryCodeSchema = z.enum(EU27_MEMBER_STATE_CODES);

export const releaseLifecycleStateSchema = z.enum([
  "development",
  "placed_on_market",
  "in_support",
  "end_of_support",
  "withdrawn",
]);

/** Versioned reference data selected by code at write boundaries. */
export const memberStateReferenceSchema = z
  .object({
    countryCode: memberStateCountryCodeSchema,
    name: z.string().trim().min(1).max(200),
    version: expectedVersionSchema,
    active: z.boolean(),
  })
  .strict();

export const memberStatesResponseSchema = z
  .object({ memberStates: z.array(memberStateReferenceSchema) })
  .strict();

/** The current availability projection, retaining the reference version used. */
export const releaseMarketAvailabilitySchema = z
  .object({
    countryCode: memberStateCountryCodeSchema,
    memberStateName: z.string().trim().min(1).max(200),
    referenceVersion: expectedVersionSchema,
    availableAt: utcZDateTimeSchema,
    unavailableAt: utcZDateTimeSchema.nullable(),
    active: z.boolean(),
  })
  .strict()
  .superRefine((availability, context) => {
    if (availability.active !== (availability.unavailableAt === null)) {
      context.addIssue({
        code: "custom",
        message: "Availability activity and removal timestamp must agree",
        path: ["unavailableAt"],
      });
    }
  });

export const releaseMarketAvailabilityResponseSchema = z
  .object({ marketAvailability: z.array(releaseMarketAvailabilitySchema) })
  .strict();

export const releaseMarketAvailabilityParamsSchema = z
  .object({
    productId: z.uuid(),
    releaseId: z.uuid(),
    countryCode: memberStateCountryCodeSchema,
  })
  .strict();

export const addReleaseMarketAvailabilityInputSchema = z
  .object({
    countryCode: memberStateCountryCodeSchema,
    expectedVersion: expectedVersionSchema,
    reason: meaningfulReasonSchema.optional(),
  })
  .strict();

/** Country identity is owned by the strict route params, not this body. */
export const removeReleaseMarketAvailabilityInputSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    reason: meaningfulReasonSchema.optional(),
  })
  .strict();

export const correctReleaseMarketAvailabilityInputSchema = z
  .object({
    fromCountryCode: memberStateCountryCodeSchema,
    toCountryCode: memberStateCountryCodeSchema,
    expectedVersion: expectedVersionSchema,
    reason: meaningfulReasonSchema.optional(),
  })
  .strict()
  .refine(
    ({ fromCountryCode, toCountryCode }) => fromCountryCode !== toCountryCode,
    {
      message: "Choose a different replacement Member State",
      path: ["toCountryCode"],
    },
  );

export const transitionReleaseLifecycleInputSchema = z
  .object({
    targetState: releaseLifecycleStateSchema,
    expectedVersion: expectedVersionSchema,
    placedOnMarketAt: utcZDateTimeSchema.optional(),
    reason: meaningfulReasonSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const isPlacement = input.targetState === "placed_on_market";
    if (isPlacement && input.placedOnMarketAt === undefined) {
      context.addIssue({
        code: "custom",
        message: "Placed-on-market transitions require placedOnMarketAt",
        path: ["placedOnMarketAt"],
      });
    }
    if (!isPlacement && input.placedOnMarketAt !== undefined) {
      context.addIssue({
        code: "custom",
        message:
          "Only placed-on-market transitions can include placedOnMarketAt",
        path: ["placedOnMarketAt"],
      });
    }
    if (input.targetState === "withdrawn" && input.reason === undefined) {
      context.addIssue({
        code: "custom",
        message: "Withdrawal requires a reason",
        path: ["reason"],
      });
    }
  });

export const correctPlacedOnMarketDateInputSchema = z
  .object({
    correctedPlacedOnMarketAt: utcZDateTimeSchema,
    expectedVersion: expectedVersionSchema,
    reason: meaningfulReasonSchema,
  })
  .strict();

export const releaseMarketAvailabilityWarningSchema = z.enum([
  "no_active_member_state_availability",
]);

export const releaseLifecycleTimelineEventTypeSchema = z.enum([
  "transition",
  "placed_on_market_date_corrected",
]);

export const releaseLifecycleTimelineEventSchema = z
  .object({
    id: z.uuid(),
    eventType: releaseLifecycleTimelineEventTypeSchema,
    beforeLifecycle: releaseLifecycleStateSchema.nullable(),
    afterLifecycle: releaseLifecycleStateSchema.nullable(),
    originalPlacedOnMarketAt: utcZDateTimeSchema.nullable(),
    correctedPlacedOnMarketAt: utcZDateTimeSchema.nullable(),
    actorId: z.uuid(),
    reason: meaningfulReasonSchema.nullable(),
    correlationId: z.uuid(),
    occurredAt: utcZDateTimeSchema,
  })
  .strict();

export const releaseLifecycleTimelineResponseSchema = z
  .object({ timeline: z.array(releaseLifecycleTimelineEventSchema) })
  .strict();

export const releaseMarketLifecycleDomainErrorCodeSchema = z.enum([
  "invalid_transition",
  "placement_requires_placed_on_market_at",
  "placement_requires_active_market_availability",
  "placed_on_market_date_not_set",
  "member_state_unavailable",
  "market_availability_not_found",
]);

export const releaseMarketLifecycleDomainErrorSchema = z
  .object({
    code: releaseMarketLifecycleDomainErrorCodeSchema,
    message: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
