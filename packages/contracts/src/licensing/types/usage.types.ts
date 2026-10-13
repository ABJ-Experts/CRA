import type { z } from "zod";
import type {
  licenseUsageCounterIdSchema,
  licenseUsageQuerySchema,
  licenseUsageComponentsSchema,
  licenseUsageCounterSchema,
  licenseUsageLimitSchema,
  licenseUsageSnapshotSchema,
  licenseUsageOperationInputSchema,
  licenseUsageExportResponseSchema,
  licenseUsageReconciliationResponseSchema,
} from "../schemas/usage.schemas.js";

export type LicenseUsageCounterId = z.output<
  typeof licenseUsageCounterIdSchema
>;
export type LicenseUsageComponents = z.output<
  typeof licenseUsageComponentsSchema
>;
export type LicenseUsageCounter = z.output<typeof licenseUsageCounterSchema>;
export type LicenseUsageLimit = z.output<typeof licenseUsageLimitSchema>;
export type LicenseUsageSnapshot = z.output<typeof licenseUsageSnapshotSchema>;
export type LicenseUsageOperationInput = z.output<
  typeof licenseUsageOperationInputSchema
>;
export type LicenseUsageExportResponse = z.output<
  typeof licenseUsageExportResponseSchema
>;
export type LicenseUsageReconciliationResponse = z.output<
  typeof licenseUsageReconciliationResponseSchema
>;

export type LicenseUsageQuery = z.output<typeof licenseUsageQuerySchema>;
