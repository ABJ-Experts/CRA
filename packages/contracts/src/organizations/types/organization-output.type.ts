import type { z } from "zod";

import type {
  currentOrganizationResponseSchema,
  destructiveReauthenticationResponseSchema,
  exportAttachmentDownloadResponseSchema,
  exportManifestSchema,
  exportProgressSchema,
  exportRequestResponseSchema,
  integrationAvailabilitySchema,
  legalProfileSchema,
  latestOrganizationExportResponseSchema,
  mfaRolloutReadinessSchema,
  organizationAdministrationErrorCodeSchema,
  organizationAdministrationErrorSchema,
  organizationExportSchema,
  organizationExportResponseSchema,
  organizationExportStatusSchema,
  organizationLifecycleResponseSchema,
  organizationLifecycleBlockerSchema,
  organizationLifecycleControllingBlockerSchema,
  organizationLifecycleFailureBlockerCodeSchema,
  organizationLifecycleFailureBlockerSchema,
  organizationLifecycleSchema,
  organizationLifecycleStatusSchema,
  onboardingBlockReasonSchema,
  onboardingResponseSchema,
  onboardingStageSchema,
  onboardingStageRecordSchema,
  onboardingStageStatusSchema,
  organizationSchema,
  organizationSettingsCatalogResponseSchema,
  organizationSettingsCatalogSchema,
  organizationSettingsResponseSchema,
  organizationSettingsSchema,
  organizationSettingsValuesSchema,
  retentionFloorReasonKindSchema,
  retentionFloorReasonSchema,
  retentionPolicyResponseSchema,
  retentionPolicySchema,
  retentionPolicySetSchema,
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
export type OrganizationSettingsValues = z.output<
  typeof organizationSettingsValuesSchema
>;
export type OrganizationSettings = z.output<typeof organizationSettingsSchema>;
export type OrganizationSettingsResponse = z.output<
  typeof organizationSettingsResponseSchema
>;
export type MfaRolloutReadiness = z.output<typeof mfaRolloutReadinessSchema>;
export type OrganizationSettingsCatalog = z.output<
  typeof organizationSettingsCatalogSchema
>;
export type OrganizationSettingsCatalogResponse = z.output<
  typeof organizationSettingsCatalogResponseSchema
>;
export type RetentionFloorReasonKind = z.output<
  typeof retentionFloorReasonKindSchema
>;
export type RetentionFloorReason = z.output<typeof retentionFloorReasonSchema>;
export type RetentionPolicy = z.output<typeof retentionPolicySchema>;
export type RetentionPolicySet = z.output<typeof retentionPolicySetSchema>;
export type RetentionPolicyResponse = z.output<
  typeof retentionPolicyResponseSchema
>;
export type OrganizationAdministrationErrorCode = z.output<
  typeof organizationAdministrationErrorCodeSchema
>;
export type OrganizationAdministrationError = z.output<
  typeof organizationAdministrationErrorSchema
>;
export type OrganizationExportStatus = z.output<
  typeof organizationExportStatusSchema
>;
export type ExportProgress = z.output<typeof exportProgressSchema>;
export type ExportManifest = z.output<typeof exportManifestSchema>;
export type OrganizationExport = z.output<typeof organizationExportSchema>;
export type OrganizationExportResponse = z.output<
  typeof organizationExportResponseSchema
>;
export type LatestOrganizationExportResponse = z.output<
  typeof latestOrganizationExportResponseSchema
>;
export type ExportRequestResponse = z.output<
  typeof exportRequestResponseSchema
>;
export type ExportAttachmentDownloadResponse = z.output<
  typeof exportAttachmentDownloadResponseSchema
>;
export type OrganizationLifecycleStatus = z.output<
  typeof organizationLifecycleStatusSchema
>;
export type OrganizationLifecycleBlocker = z.output<
  typeof organizationLifecycleBlockerSchema
>;
export type OrganizationLifecycleControllingBlocker = z.output<
  typeof organizationLifecycleControllingBlockerSchema
>;
export type OrganizationLifecycleFailureBlockerCode = z.output<
  typeof organizationLifecycleFailureBlockerCodeSchema
>;
export type OrganizationLifecycleFailureBlocker = z.output<
  typeof organizationLifecycleFailureBlockerSchema
>;
export type OrganizationLifecycle = z.output<
  typeof organizationLifecycleSchema
>;
export type OrganizationLifecycleResponse = z.output<
  typeof organizationLifecycleResponseSchema
>;
export type DestructiveReauthenticationResponse = z.output<
  typeof destructiveReauthenticationResponseSchema
>;
