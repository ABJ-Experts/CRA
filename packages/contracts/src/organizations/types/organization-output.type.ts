import type { z } from "zod";

import type {
  currentOrganizationResponseSchema,
  integrationAvailabilitySchema,
  legalProfileSchema,
  onboardingBlockReasonSchema,
  onboardingResponseSchema,
  onboardingStageSchema,
  onboardingStageRecordSchema,
  onboardingStageStatusSchema,
  organizationSchema,
  switchOrganizationResponseSchema,
} from "../schemas/index.js";

export type LegalProfile = z.output<typeof legalProfileSchema>;
export type Organization = z.output<typeof organizationSchema>;
export type CurrentOrganizationResponse = z.output<
  typeof currentOrganizationResponseSchema
>;
export type SwitchOrganizationResponse = z.output<
  typeof switchOrganizationResponseSchema
>;
export type OnboardingStage = z.output<typeof onboardingStageSchema>;
export type OnboardingStageStatus = z.output<
  typeof onboardingStageStatusSchema
>;
export type OnboardingBlockReason = z.output<
  typeof onboardingBlockReasonSchema
>;
export type OnboardingStageRecord = z.output<
  typeof onboardingStageRecordSchema
>;
export type IntegrationAvailability = z.output<
  typeof integrationAvailabilitySchema
>;
export type OnboardingResponse = z.output<typeof onboardingResponseSchema>;
