import { ISO_3166_ALPHA_2_CODES } from "./iso-3166-alpha-2.js";
import { z } from "zod";

const requiredText = (maxLength: number) =>
  z.string().trim().min(1).max(maxLength);

const optionalText = (maxLength: number) => requiredText(maxLength).optional();
const emailSchema = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email({ message: "Enter a valid manufacturer contact email" }))
  .transform((email) => email.toLowerCase());

export const iso3166Alpha2CountrySchema = z.enum(ISO_3166_ALPHA_2_CODES);

export const e164PhoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{1,14}$/, "Enter an E.164 phone number");

export const idempotencyKeySchema = z.uuid();

export const registeredAddressSchema = z
  .object({
    addressLine1: requiredText(200),
    addressLine2: optionalText(200),
    locality: requiredText(120),
    administrativeArea: optionalText(120),
    postalCode: requiredText(32),
    country: iso3166Alpha2CountrySchema,
  })
  .strict();

const legalProfileFieldsSchema = z
  .object({
    legalName: requiredText(200),
    registeredAddress: registeredAddressSchema,
    mainEstablishmentCountry: iso3166Alpha2CountrySchema,
    phone: e164PhoneSchema.optional(),
    manufacturerContactName: requiredText(160),
    manufacturerContactEmail: emailSchema,
  })
  .strict();

export const createLegalProfileInputSchema = legalProfileFieldsSchema
  .extend({ idempotencyKey: idempotencyKeySchema })
  .strict();

export const updateLegalProfileInputSchema = legalProfileFieldsSchema
  .extend({ expectedVersion: z.number().int().nonnegative() })
  .strict();

/** An organization is created from its legal profile; its name and slug are server-owned. */
export const createOrganizationInputSchema = createLegalProfileInputSchema;

export const switchOrganizationInputSchema = z
  .object({ organizationId: z.uuid() })
  .strict();
