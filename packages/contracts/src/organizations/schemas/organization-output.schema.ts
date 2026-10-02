import {
  e164PhoneSchema,
  iso3166Alpha2CountrySchema,
  registeredAddressSchema,
} from "./organization-input.schema.js";
import { z } from "zod";

export const legalProfileSchema = z
  .object({
    id: z.uuid(),
    legalName: z.string().min(1).max(200),
    registeredAddress: registeredAddressSchema,
    mainEstablishmentCountry: iso3166Alpha2CountrySchema,
    phone: e164PhoneSchema.nullable(),
    manufacturerContactName: z.string().min(1).max(160),
    manufacturerContactEmail: z.email(),
    version: z.number().int().nonnegative(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    createdBy: z.uuid(),
    updatedBy: z.uuid(),
  })
  .strict();

export const organizationSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(200),
    slug: z.string().min(1).max(64),
    legalProfile: legalProfileSchema.nullable(),
  })
  .strict();

export const currentOrganizationResponseSchema = z
  .object({ organization: organizationSchema.nullable() })
  .strict();

export const switchOrganizationResponseSchema = z
  .object({ organization: organizationSchema })
  .strict();

export const onboardingStageSchema = z.enum([
  "organization_details",
  "first_product",
  "first_sbom",
  "invite_team",
  "completed",
]);

export const onboardingStageStatusSchema = z.enum([
  "pending",
  "blocked",
  "completed",
]);

export const onboardingBlockReasonSchema = z.enum([
  "awaiting_authoritative_product",
  "awaiting_authoritative_sbom",
  "awaiting_prior_stage",
]);

const onboardingStageRecordFieldsSchema = z
  .object({
    stage: onboardingStageSchema,
    status: onboardingStageStatusSchema,
    resourceIds: z.array(z.uuid()),
    /** Historical identifiers whose upstream authority is no longer available. */
    unavailableResourceIds: z.array(z.uuid()),
    completedAt: z.iso.datetime({ offset: true }).nullable(),
    actorId: z.uuid().nullable(),
    blockReason: onboardingBlockReasonSchema.nullable(),
  })
  .strict();

function validateStageState(
  value: z.output<typeof onboardingStageRecordFieldsSchema>,
  context: z.RefinementCtx,
): void {
  const hasCompletion = value.completedAt !== null && value.actorId !== null;
  const hasPartialCompletion =
    (value.completedAt === null) !== (value.actorId === null);

  if (hasPartialCompletion) {
    context.addIssue({
      code: "custom",
      message: "Completion timestamp and actor must be present together",
      path: ["completedAt"],
    });
  }

  if (value.status === "completed") {
    if (!hasCompletion) {
      context.addIssue({
        code: "custom",
        message: "Completed stages require a completion timestamp and actor",
        path: ["status"],
      });
    }
    if (value.blockReason !== null) {
      context.addIssue({
        code: "custom",
        message: "Completed stages cannot be blocked",
        path: ["blockReason"],
      });
    }
    return;
  }

  if (hasCompletion) {
    context.addIssue({
      code: "custom",
      message: "Only completed stages can contain completion metadata",
      path: ["status"],
    });
  }

  if (value.status === "blocked" && value.blockReason === null) {
    context.addIssue({
      code: "custom",
      message: "Blocked stages require a blocking reason",
      path: ["blockReason"],
    });
  }
  if (value.status === "pending" && value.blockReason !== null) {
    context.addIssue({
      code: "custom",
      message: "Pending stages cannot contain a blocking reason",
      path: ["blockReason"],
    });
  }
}

export const onboardingStageRecordSchema = onboardingStageRecordFieldsSchema.superRefine(
  validateStageState,
);

function stageRecordSchema<TStage extends z.output<typeof onboardingStageSchema>>(
  stage: TStage,
) {
  return onboardingStageRecordFieldsSchema
    .extend({ stage: z.literal(stage) })
    .superRefine(validateStageState);
}

const onboardingStagesSchema = z.tuple([
  stageRecordSchema("organization_details"),
  stageRecordSchema("first_product"),
  stageRecordSchema("first_sbom"),
  stageRecordSchema("invite_team"),
  stageRecordSchema("completed"),
]);

export const integrationAvailabilitySchema = z
  .object({
    products: z.boolean(),
    sbom: z.boolean(),
    invitations: z.boolean(),
  })
  .strict();

export const onboardingResponseSchema = z
  .object({
    organization: organizationSchema,
    stages: onboardingStagesSchema,
    nextIncompleteStage: onboardingStageSchema.nullable(),
    blocked: z.boolean(),
    integrationAvailability: integrationAvailabilitySchema,
  })
  .strict();
