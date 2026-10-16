import type { z } from "zod";
import type {
  systemHealthReasonSchema,
  systemHealthStatusSchema,
  systemHealthAvailabilitySchema,
  systemHealthComponentIdSchema,
  systemHealthComponentSchema,
  systemHealthQueueSchema,
  systemHealthStorageSchema,
  systemHealthFeedFreshnessSchema,
  systemHealthVersionSchema,
  systemHealthLicenceLinkSchema,
  systemHealthBackupSchema,
  customerSystemHealthQuerySchema,
  customerSystemHealthResponseSchema,
} from "../schemas/system-health.schema.js";

export type SystemHealthReason = z.output<typeof systemHealthReasonSchema>;
export type SystemHealthStatus = z.output<typeof systemHealthStatusSchema>;
export type SystemHealthAvailability = z.output<
  typeof systemHealthAvailabilitySchema
>;
export type SystemHealthComponentId = z.output<
  typeof systemHealthComponentIdSchema
>;
export type SystemHealthComponent = z.output<
  typeof systemHealthComponentSchema
>;
export type SystemHealthQueue = z.output<typeof systemHealthQueueSchema>;
export type SystemHealthStorage = z.output<typeof systemHealthStorageSchema>;
export type SystemHealthFeedFreshness = z.output<
  typeof systemHealthFeedFreshnessSchema
>;
export type SystemHealthVersion = z.output<typeof systemHealthVersionSchema>;
export type SystemHealthLicenceLink = z.output<
  typeof systemHealthLicenceLinkSchema
>;
export type SystemHealthBackup = z.output<typeof systemHealthBackupSchema>;
export type CustomerSystemHealthQuery = z.output<
  typeof customerSystemHealthQuerySchema
>;
export type CustomerSystemHealthResponse = z.output<
  typeof customerSystemHealthResponseSchema
>;
