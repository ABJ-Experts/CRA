import type { z } from "zod";
import type * as schemas from "../schemas/index.js";

export type UpgradeDigest = z.output<typeof schemas.upgradeDigestSchema>;
export type UpgradeTimestamp = z.output<typeof schemas.upgradeTimestampSchema>;
export type UpgradeAction = z.output<typeof schemas.upgradeActionSchema>;
export type UpgradeRunState = z.output<typeof schemas.upgradeRunStateSchema>;
export type UpgradeJwsHeader = z.output<typeof schemas.upgradeJwsHeaderSchema>;
export type UpgradeManifest = z.output<typeof schemas.upgradeManifestSchema>;
export type UpgradeEmptyQuery = z.output<
  typeof schemas.upgradeEmptyQuerySchema
>;
export type UpgradeInstanceParams = z.output<
  typeof schemas.upgradeInstanceParamsSchema
>;
export type UpgradeRunParams = z.output<typeof schemas.upgradeRunParamsSchema>;
export type UpgradeMutation = z.output<typeof schemas.upgradeMutationSchema>;
export type UpgradeStageInput = z.output<
  typeof schemas.upgradeStageInputSchema
>;
export type UpgradePreflightInput = z.output<
  typeof schemas.upgradePreflightInputSchema
>;
export type UpgradeApplyInput = z.output<
  typeof schemas.upgradeApplyInputSchema
>;
export type UpgradeRollbackInput = z.output<
  typeof schemas.upgradeRollbackInputSchema
>;
export type UpgradeHistoryQuery = z.output<
  typeof schemas.upgradeHistoryQuerySchema
>;
export type UpgradeFailureCode = z.output<
  typeof schemas.upgradeFailureCodeSchema
>;
export type UpgradeMedia = z.output<typeof schemas.upgradeMediaSchema>;
export type UpgradeMediaList = z.output<typeof schemas.upgradeMediaListSchema>;
export type UpgradeCapabilities = z.output<
  typeof schemas.upgradeCapabilitiesSchema
>;
export type UpgradePreflightCheck = z.output<
  typeof schemas.upgradePreflightCheckSchema
>;
export type UpgradePreflight = z.output<typeof schemas.upgradePreflightSchema>;
export type UpgradeResult = z.output<typeof schemas.upgradeResultSchema>;
export type UpgradeRun = z.output<typeof schemas.upgradeRunSchema>;
export type UpgradeHistory = z.output<typeof schemas.upgradeHistorySchema>;
export type UpgradeDetail = z.output<typeof schemas.upgradeDetailSchema>;
export type UpgradeControlAction = z.output<
  typeof schemas.upgradeControlActionSchema
>;
export type UpgradeActor = z.output<typeof schemas.upgradeActorSchema>;
export type UpgradeControlRequest = z.output<
  typeof schemas.upgradeControlRequestSchema
>;
export type UpgradeControlResponse = z.output<
  typeof schemas.upgradeControlResponseSchema
>;

export type UpgradeEffectsSummary = z.output<
  typeof schemas.upgradeEffectsSummarySchema
>;
