import { z } from "zod";
import type {
  uploadPathSchema,
  licenseClaimsSchema,
  licenseCapabilitySchema,
  licenseLimitsSchema,
  licenseUsageSchema,
  licenseActivationInputSchema,
  licensePolicyResponseSchema,
  licenseCurrentResponseSchema,
  licenseHistoryQuerySchema,
  licenseHistoryResponseSchema,
  licenseActivationResponseSchema,
} from "../schemas/index.js";
export type LicenseClaims = z.output<typeof licenseClaimsSchema>;
export type LicenseCapability = z.output<typeof licenseCapabilitySchema>;
export type LicenseLimits = z.output<typeof licenseLimitsSchema>;
export type LicenseUsage = z.output<typeof licenseUsageSchema>;
export type LicenseActivationInput = z.output<
  typeof licenseActivationInputSchema
>;
export type LicensePolicyResponse = z.output<
  typeof licensePolicyResponseSchema
>;
export type LicenseCurrentResponse = z.output<
  typeof licenseCurrentResponseSchema
>;
export type LicenseHistoryQuery = z.output<typeof licenseHistoryQuerySchema>;
export type LicenseHistoryResponse = z.output<
  typeof licenseHistoryResponseSchema
>;
export type LicenseActivationResponse = z.output<
  typeof licenseActivationResponseSchema
>;

export type UploadPath = z.output<typeof uploadPathSchema>;
