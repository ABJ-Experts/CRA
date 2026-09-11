import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { utcZDateTimeSchema } from "../../products/schemas/release-market-lifecycle.schema.js";
import { z } from "zod";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const expectedVersionSchema = z.number().int().nonnegative();

/** Only the reference conformance adapter exists; no vendor SDK is wired in yet. */
export const connectorTypeSchema = z.enum(["reference_conformance"]);
export const connectorAdapterVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, "Use a semantic adapter version");
export const connectorCommitPolicySchema = z.enum(["manual", "auto"]);
export const connectorTestOutcomeSchema = z.enum(["success", "failure"]);
/** Shared with `ConnectorPort#testConnection` in the API layer; keep the two lists identical. */
export const connectorErrorCodeSchema = z.enum([
  "auth_failed",
  "unreachable",
  "rate_limited",
  "malformed_response",
  "unsupported_capability",
  "payload_too_large",
  "unknown",
]);

export const connectorParamsSchema = z
  .object({ connectorId: z.uuid() })
  .strict();

/** Vendor connection metadata only. The DB rejects any password/secret/token-shaped key here. */
export const connectorConnectionConfigSchema = z.record(
  z.string(),
  z.unknown(),
);

/**
 * The connector row minus its secret. `secretRef` never appears here: a
 * caller who needs to know whether a secret is configured reads `hasSecret`.
 */
export const connectorSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    connectorType: connectorTypeSchema,
    displayName: requiredText(200),
    adapterVersion: connectorAdapterVersionSchema,
    mappingVersion: requiredText(100),
    connectionConfig: connectorConnectionConfigSchema,
    hasSecret: z.boolean(),
    commitPolicy: connectorCommitPolicySchema,
    enabled: z.boolean(),
    lastTestedAt: utcZDateTimeSchema.nullable(),
    lastTestOutcome: connectorTestOutcomeSchema.nullable(),
    lastTestErrorCode: connectorErrorCodeSchema.nullable(),
    archivedAt: utcZDateTimeSchema.nullable(),
    version: expectedVersionSchema,
    createdAt: utcZDateTimeSchema,
    createdBy: z.uuid(),
    updatedAt: utcZDateTimeSchema,
    updatedBy: z.uuid(),
  })
  .strict();

export const createConnectorInputSchema = z
  .object({
    connectorType: connectorTypeSchema,
    displayName: requiredText(200),
    adapterVersion: connectorAdapterVersionSchema,
    mappingVersion: requiredText(100),
    connectionConfig: connectorConnectionConfigSchema.optional(),
    commitPolicy: connectorCommitPolicySchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

/** Mirrors `update_connector_atomic`: connectorType and adapterVersion are immutable. */
export const updateConnectorInputSchema = z
  .object({
    displayName: requiredText(200),
    mappingVersion: requiredText(100),
    connectionConfig: connectorConnectionConfigSchema.optional(),
    commitPolicy: connectorCommitPolicySchema,
    expectedVersion: expectedVersionSchema,
  })
  .strict();

export const archiveConnectorInputSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    reason: requiredText(500),
  })
  .strict();

/** Not trimmed: whitespace may be a meaningful part of the secret itself. */
export const setConnectorSecretInputSchema = z
  .object({ secretValue: z.string().min(1).max(20_000) })
  .strict();

/** Every mutation below has a real body; a connectivity test does not. */
export const testConnectorInputSchema = z.object({}).strict();

/** Explicit empty body for a server-generated, redacted diagnostic report. */
export const diagnosticsExportInputSchema = z.object({}).strict();

export const testConnectorResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("success"),
      latencyMs: z.number().int().nonnegative(),
      adapterVersion: connectorAdapterVersionSchema,
    })
    .strict(),
  z
    .object({
      outcome: z.literal("failure"),
      errorCode: connectorErrorCodeSchema,
      message: requiredText(500),
    })
    .strict(),
]);
