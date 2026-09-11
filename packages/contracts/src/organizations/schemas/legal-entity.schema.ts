import {
  e164PhoneSchema,
  idempotencyKeySchema,
  iso3166Alpha2CountrySchema,
  registeredAddressSchema,
} from "./organization-input.schema.js";
import { z } from "zod";

const requiredText = (maxLength: number) =>
  z.string().trim().min(1).max(maxLength);

const legalEntityEmailSchema = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email({ message: "Enter a valid manufacturer contact email" }))
  .transform((email) => email.toLowerCase());

/**
 * Canonicalizes optional registration and tax values for organization-local
 * collision checks. The API/database owns the corresponding uniqueness rules.
 */
export const legalEntityRegistrationIdentifierSchema = z
  .string()
  .max(256)
  .transform((value) =>
    value.normalize("NFKC").replace(/\s+/gu, "").toUpperCase(),
  )
  .pipe(z.string().min(1).max(128));

export const legalEntityTaxIdentifierSchema =
  legalEntityRegistrationIdentifierSchema;

/** A canonical, organization-local reference suitable for user-facing selection. */
export const legalEntityIdentifierSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]{0,63}$/, "Use a lowercase legal-entity identifier");

export const legalEntityStatusSchema = z.enum([
  "active",
  "inactive",
  "deleted",
]);

export const legalEntityCompletionStatusSchema = z.enum([
  "complete",
  "needs_completion",
]);

/** Aggregated dependency facts; owner systems retain individual assignments. */
export const legalEntityDependencyKindSchema = z.enum([
  "product",
  "report",
  "obligation",
  "legal_hold",
  "supplier_portal",
  "document_generation",
]);

export const legalEntityDependencyProjectionSchema = z
  .object({
    kind: legalEntityDependencyKindSchema,
    count: z.number().int().nonnegative(),
  })
  .strict();

const legalEntityFieldsSchema = z
  .object({
    identifier: legalEntityIdentifierSchema,
    displayName: requiredText(200),
    legalName: requiredText(200),
    registeredAddress: registeredAddressSchema,
    mainEstablishmentCountry: iso3166Alpha2CountrySchema,
    phone: e164PhoneSchema.optional(),
    registrationIdentifier: legalEntityRegistrationIdentifierSchema.optional(),
    taxIdentifier: legalEntityTaxIdentifierSchema.optional(),
    manufacturerContactName: requiredText(160),
    manufacturerContactEmail: legalEntityEmailSchema,
  })
  .strict();

export const createLegalEntityInputSchema = legalEntityFieldsSchema
  .extend({ idempotencyKey: idempotencyKeySchema })
  .strict();

export const updateLegalEntityInputSchema = legalEntityFieldsSchema
  .extend({ expectedVersion: z.number().int().nonnegative() })
  .strict();

export const legalEntityLifecycleInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    status: legalEntityStatusSchema,
  })
  .strict();

/** Explicit lifecycle routes own their target state; callers send only OCC. */
export const legalEntityVersionInputSchema = z
  .object({ expectedVersion: z.number().int().nonnegative() })
  .strict();

/** Strict path boundary for current-organization legal-entity routes. */
export const legalEntityParamsSchema = z
  .object({ legalEntityId: z.uuid() })
  .strict();

const completeLegalEntityFieldsOutputSchema = legalEntityFieldsSchema.extend({
  phone: e164PhoneSchema.nullable(),
  registrationIdentifier: legalEntityRegistrationIdentifierSchema.nullable(),
  taxIdentifier: legalEntityTaxIdentifierSchema.nullable(),
});

const legalEntityMetadataFields = {
  id: z.uuid(),
  organizationId: z.uuid(),
  isDefault: z.boolean(),
  version: z.number().int().nonnegative(),
  dependencyProjections: z.array(legalEntityDependencyProjectionSchema),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  createdBy: z.uuid(),
  updatedBy: z.uuid(),
};

const completeLegalEntitySchema = completeLegalEntityFieldsOutputSchema
  .extend({
    ...legalEntityMetadataFields,
    status: legalEntityStatusSchema,
    completionStatus: z.literal("complete"),
    deletedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

const incompleteLegalEntitySchema = z
  .object({
    ...legalEntityMetadataFields,
    identifier: legalEntityIdentifierSchema.nullable(),
    displayName: requiredText(200),
    legalName: requiredText(200).nullable(),
    registeredAddress: registeredAddressSchema.nullable(),
    mainEstablishmentCountry: iso3166Alpha2CountrySchema.nullable(),
    phone: e164PhoneSchema.nullable(),
    registrationIdentifier: legalEntityRegistrationIdentifierSchema.nullable(),
    taxIdentifier: legalEntityTaxIdentifierSchema.nullable(),
    manufacturerContactName: requiredText(160).nullable(),
    manufacturerContactEmail: legalEntityEmailSchema.nullable(),
    status: z.literal("inactive"),
    completionStatus: z.literal("needs_completion"),
    deletedAt: z.null(),
  })
  .strict();

export const legalEntitySchema = z
  .discriminatedUnion("completionStatus", [
    completeLegalEntitySchema,
    incompleteLegalEntitySchema,
  ])
  .superRefine((entity, context) => {
    const isDeleted = entity.status === "deleted";
    if (isDeleted !== (entity.deletedAt !== null)) {
      context.addIssue({
        code: "custom",
        message: "Deleted status and deletion timestamp must agree",
        path: ["deletedAt"],
      });
    }
  });

export const legalEntityResponseSchema = z
  .object({ legalEntity: legalEntitySchema })
  .strict();

export const legalEntitiesResponseSchema = z
  .object({ legalEntities: z.array(legalEntitySchema) })
  .strict();
