import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { utcZDateTimeSchema } from "../../products/schemas/release-market-lifecycle.schema.js";
import { z } from "zod";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const expectedVersionSchema = z.number().int().nonnegative();

export const connectorTypeSchema = z.enum([
  "reference_conformance",
  "github_actions",
  "gitlab_ci",
  "azure_devops",
]);
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
  "missing_scope",
  "unsupported_version",
  "vault_unavailable",
  "interrupted",
  "timeout",
]);

export const connectorParamsSchema = z
  .object({ connectorId: z.uuid() })
  .strict();

/** Syntax validation only: the server additionally applies host/DNS/egress policy. */
const connectorEndpointSchema = requiredText(2_048)
  .regex(
    /^https:\/\/[a-zA-Z0-9.-]+(?:\/[^?#\\]*)?$/,
    "Use an HTTPS endpoint without credentials, query, fragment, IP address or custom port",
  )
  .pipe(
    z.url({
      protocol: /^https$/,
      hostname:
        /^(?!localhost(?:\.localdomain)?$)(?!\d+(?:\.\d+){3}$)[a-zA-Z0-9.-]+$/,
    }),
  );

/** Only reference metadata is supported; arbitrary provider payloads and secrets are rejected. */
export const connectorConfigurationInputSchema = z
  .object({
    baseUrl: connectorEndpointSchema.optional(),
    tenantOrSiteId: requiredText(200).optional(),
    scopeFilter: z
      .object({
        scenario: z
          .enum([
            "create",
            "update",
            "unchanged",
            "tombstone",
            "conflict",
            "invalid",
            "cycle",
            "pagination",
            "poison",
            "repaired",
          ])
          .optional(),
        simulate: z.enum(["rate_limit", "malformed"]).optional(),
      })
      .strict()
      .optional(),
    defaultOwnerBinding: z
      .object({
        responsibleOwnerId: z.uuid(),
        legalEntityId: z.uuid(),
      })
      .strict()
      .optional(),
  })
  .strict();

const providerHostSchema = z
  .string()
  .min(4)
  .max(253)
  .regex(/^(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/)
  .refine((host) => !host.endsWith(".local") && !host.endsWith(".internal"));
const providerIdSchema = z.string().regex(/^[1-9][0-9]{0,19}$/);
const organizationSlugSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/);

export const githubActionsConnectorConfigurationSchema = z
  .object({
    providerHost: z.literal("github.com"),
    appId: providerIdSchema,
    installationId: providerIdSchema,
  })
  .strict();
export const gitlabCiConnectorConfigurationSchema = z
  .object({
    providerHost: providerHostSchema,
    projectId: providerIdSchema,
  })
  .strict();
export const azureDevopsConnectorConfigurationSchema = z
  .object({
    providerHost: z.literal("dev.azure.com"),
    organization: organizationSlugSchema,
    projectId: z.uuid(),
    serviceConnectionId: z.uuid(),
  })
  .strict();
export const ciConnectorConfigurationSchema = z.union([
  githubActionsConnectorConfigurationSchema,
  gitlabCiConnectorConfigurationSchema,
  azureDevopsConnectorConfigurationSchema,
]);
const connectorConfigurationSchema = z.union([
  connectorConfigurationInputSchema,
  ciConnectorConfigurationSchema,
]);

export function parseConnectorConfigurationForType(
  type: z.output<typeof connectorTypeSchema>,
  configuration: unknown,
) {
  switch (type) {
    case "reference_conformance":
      return connectorConfigurationInputSchema.parse(configuration);
    case "github_actions":
      return githubActionsConnectorConfigurationSchema.parse(configuration);
    case "gitlab_ci":
      return gitlabCiConnectorConfigurationSchema.parse(configuration);
    case "azure_devops":
      return azureDevopsConnectorConfigurationSchema.parse(configuration);
  }
}

/** Historical response metadata is preserved; new writes use the strict input whitelist. */
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
    connectionConfig: connectorConfigurationSchema.optional(),
    commitPolicy: connectorCommitPolicySchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine((input, ctx) => {
    if (
      input.connectorType !== "reference_conformance" &&
      input.commitPolicy !== "manual"
    )
      ctx.addIssue({
        code: "custom",
        path: ["commitPolicy"],
        message: "CI connectors do not support product/release auto-commit",
      });
    if (
      !(
        input.connectorType === "reference_conformance"
          ? connectorConfigurationInputSchema
          : input.connectorType === "github_actions"
            ? githubActionsConnectorConfigurationSchema
            : input.connectorType === "gitlab_ci"
              ? gitlabCiConnectorConfigurationSchema
              : azureDevopsConnectorConfigurationSchema
      ).safeParse(input.connectionConfig ?? {}).success
    )
      ctx.addIssue({
        code: "custom",
        path: ["connectionConfig"],
        message: "Connector configuration does not match its provider",
      });
  });

/** Mirrors `update_connector_atomic`: connectorType and adapterVersion are immutable. */
export const updateConnectorInputSchema = z
  .object({
    displayName: requiredText(200),
    mappingVersion: requiredText(100),
    connectionConfig: connectorConfigurationSchema.optional(),
    commitPolicy: connectorCommitPolicySchema,
    expectedVersion: expectedVersionSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const archiveConnectorInputSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    reason: requiredText(500),
  })
  .strict();

const connectorCommandShape = {
  expectedVersion: expectedVersionSchema,
  idempotencyKey: idempotencyKeySchema,
};

/** Not trimmed: whitespace may be a meaningful part of the secret itself. */
export const setConnectorSecretInputSchema = z
  .object({
    ...connectorCommandShape,
    secretValue: z.string().min(1).max(20_000),
  })
  .strict();
export const testConnectorInputSchema = z
  .object(connectorCommandShape)
  .strict();
export const revokeConnectorSecretInputSchema = z
  .object({
    ...connectorCommandShape,
    reason: requiredText(500),
  })
  .strict();
export const disconnectConnectorInputSchema = z
  .object({
    ...connectorCommandShape,
    reason: requiredText(500),
  })
  .strict();
export const reconnectConnectorInputSchema = z
  .object(connectorCommandShape)
  .strict();

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
