import type { z } from "zod";
import type * as schemas from "../schemas/index.js";

export type BackupEmptyQuery = z.output<typeof schemas.backupEmptyQuerySchema>;

export type BackupAction = z.output<typeof schemas.backupActionSchema>;
export type BackupFailureCode = z.output<
  typeof schemas.backupFailureCodeSchema
>;
export type BackupState = z.output<typeof schemas.backupStateSchema>;
export type BackupStage = z.output<typeof schemas.backupStageSchema>;
export type BackupPolicyConfiguration = z.output<
  typeof schemas.backupPolicyConfigurationSchema
>;
export type BackupPolicy = z.output<typeof schemas.backupPolicySchema>;
export type BackupPolicyResponse = z.output<
  typeof schemas.backupPolicyResponseSchema
>;
export type BackupPolicyInput = z.output<
  typeof schemas.backupPolicyInputSchema
>;
export type BackupPolicyValidationInput = z.output<
  typeof schemas.backupPolicyValidationInputSchema
>;
export type BackupRun = z.output<typeof schemas.backupRunSchema>;
export type BackupRunRequest = z.output<typeof schemas.backupRunRequestSchema>;
export type BackupMutation = z.output<typeof schemas.backupMutationSchema>;
export type BackupVerificationRequest = z.output<
  typeof schemas.backupVerificationRequestSchema
>;
export type BackupHistoryQuery = z.output<
  typeof schemas.backupHistoryQuerySchema
>;
export type BackupHistory = z.output<typeof schemas.backupHistorySchema>;
export type BackupAssurance = z.output<typeof schemas.backupAssuranceSchema>;
export type BackupValidation = z.output<typeof schemas.backupValidationSchema>;
export type BackupCleanupReview = z.output<
  typeof schemas.backupCleanupReviewSchema
>;
export type BackupCleanupInput = z.output<
  typeof schemas.backupCleanupInputSchema
>;
export type BackupCleanupReviewInput = z.output<
  typeof schemas.backupCleanupReviewInputSchema
>;
export type BackupCertificate = z.output<
  typeof schemas.backupCertificateSchema
>;
export type BackupVerificationCheck = z.output<
  typeof schemas.backupVerificationCheckSchema
>;
export type BackupVerificationResult = z.output<
  typeof schemas.backupVerificationResultSchema
>;
export type BackupCustomerRun = z.output<
  typeof schemas.backupCustomerRunSchema
>;
export type BackupCustomerHistory = z.output<
  typeof schemas.backupCustomerHistorySchema
>;
export type BackupInstanceParams = z.output<
  typeof schemas.backupInstanceParamsSchema
>;
export type BackupRunParams = z.output<typeof schemas.backupRunParamsSchema>;
