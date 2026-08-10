import type { z } from "zod";

import type {
  createLegalProfileInputSchema,
  createOrganizationInputSchema,
  e164PhoneSchema,
  idempotencyKeySchema,
  iso3166Alpha2CountrySchema,
  registeredAddressSchema,
  switchOrganizationInputSchema,
  updateLegalProfileInputSchema,
} from "../schemas/index.js";

export type Iso3166Alpha2Country = z.output<typeof iso3166Alpha2CountrySchema>;
export type E164Phone = z.output<typeof e164PhoneSchema>;
export type IdempotencyKey = z.output<typeof idempotencyKeySchema>;
export type RegisteredAddress = z.output<typeof registeredAddressSchema>;
export type CreateLegalProfileInput = z.output<
  typeof createLegalProfileInputSchema
>;
export type UpdateLegalProfileInput = z.output<
  typeof updateLegalProfileInputSchema
>;
export type CreateOrganizationInput = z.output<
  typeof createOrganizationInputSchema
>;
export type SwitchOrganizationInput = z.output<
  typeof switchOrganizationInputSchema
>;
