import type { z } from "zod";

import type {
  createLegalProfileInputSchema,
  createOrganizationInputSchema,
  e164PhoneSchema,
  evidenceClassIdentifierSchema,
  idempotencyKeySchema,
  iso3166Alpha2CountrySchema,
  registeredAddressSchema,
  deactivateOrganizationInputSchema,
  destructiveReauthenticationInputSchema,
  destructiveMfaCodeSchema,
  exportRequestInputSchema,
  organizationExportParamsSchema,
  recoverOrganizationInputSchema,
  retentionPolicyUpdateInputSchema,
  scheduleOrganizationPurgeInputSchema,
  switchOrganizationInputSchema,
  updateOrganizationSettingsInputSchema,
  updateLegalProfileInputSchema,
} from "../schemas/index.js";

export type Iso3166Alpha2Country = z.output<typeof iso3166Alpha2CountrySchema>;
export type E164Phone = z.output<typeof e164PhoneSchema>;
export type IdempotencyKey = z.output<typeof idempotencyKeySchema>;
export type EvidenceClassIdentifier = z.output<
  typeof evidenceClassIdentifierSchema
>;
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
export type UpdateOrganizationSettingsInput = z.output<
  typeof updateOrganizationSettingsInputSchema
>;
export type RetentionPolicyUpdateInput = z.output<
  typeof retentionPolicyUpdateInputSchema
>;
export type ExportRequestInput = z.output<typeof exportRequestInputSchema>;
export type OrganizationExportParams = z.output<
  typeof organizationExportParamsSchema
>;
export type DestructiveMfaCode = z.output<typeof destructiveMfaCodeSchema>;
export type DestructiveReauthenticationInput = z.output<
  typeof destructiveReauthenticationInputSchema
>;
export type DeactivateOrganizationInput = z.output<
  typeof deactivateOrganizationInputSchema
>;
export type ScheduleOrganizationPurgeInput = z.output<
  typeof scheduleOrganizationPurgeInputSchema
>;
export type RecoverOrganizationInput = z.output<
  typeof recoverOrganizationInputSchema
>;
