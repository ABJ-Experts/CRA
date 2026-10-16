import { createHash } from "node:crypto";
import {
  createProductInputSchema,
  createReleaseInputSchema,
  updateProductInputSchema,
  updateReleaseInputSchema,
} from "@repo/contracts/products/schemas";
import { CONNECTOR_MAPPING_MESSAGES } from "@repo/contracts/connectors/schemas";
import type {
  ConnectorFieldMapping,
  ConnectorMappingDiscovery,
  ConnectorMappingIssue,
} from "@repo/contracts/connectors/types";
import type { z } from "zod";
import type { ConnectorCapabilities, ExternalRecord } from "./connector-port";
import { canonicalConnectorRequest } from "./connector-hub-use-cases";

const targets: Readonly<
  Record<"product" | "release", Readonly<Record<string, z.ZodType>>>
> = {
  product: {
    name: createProductInputSchema.shape.name,
    internalCode: createProductInputSchema.shape.internalCode,
    productType: createProductInputSchema.shape.productType,
    description: updateProductInputSchema.shape.description,
  },
  release: {
    label: createReleaseInputSchema.shape.label,
    releaseVersion: createReleaseInputSchema.shape.version,
    description: updateReleaseInputSchema.shape.description,
  },
};
export function mappingIssue(
  code: ConnectorMappingIssue["code"],
  details: Omit<ConnectorMappingIssue, "code" | "message"> = {},
): ConnectorMappingIssue {
  return { code, ...details, message: CONNECTOR_MAPPING_MESSAGES[code] };
}
export function connectorMappingDiscovery(
  capabilities: ConnectorCapabilities,
): ConnectorMappingDiscovery {
  const sources = capabilities.entities.map((entry) => ({
    entityType: entry.entityType,
    fields: entry.fields
      .filter((value) => value.supportsPull)
      .map((value) => ({
        field: value.vendorFieldPath,
        type: value.type,
        nullable: value.nullable,
        required: value.required,
        sensitive: value.sensitive,
      })),
  }));
  const targetList = capabilities.entities.map((entry) => ({
    entityType: entry.entityType,
    fields: Object.keys(targets[entry.entityType]).map((field) => ({
      field,
      type: "string" as const,
      nullable: field === "description",
      required: field !== "description",
      sensitive: false,
    })),
  }));
  const base = {
    adapterVersion: capabilities.adapterVersion,
    mappingVersion: capabilities.mappingVersion,
    sources,
    targets: targetList,
  };
  return {
    ...base,
    schemaDigest: createHash("sha256")
      .update(canonicalConnectorRequest(base))
      .digest("hex"),
  };
}
export function validateConnectorFieldMappings(
  fields: readonly ConnectorFieldMapping[],
  capabilities: ConnectorCapabilities,
): ConnectorMappingIssue[] {
  const seen = new Set<string>();
  return fields.flatMap((mapping) => {
    const details = {
      entityType: mapping.entityType,
      sourceField: mapping.sourceField,
      targetField: mapping.targetField,
    };
    const source = capabilities.entities
      .find((entry) => entry.entityType === mapping.entityType)
      ?.fields.find(
        (value) =>
          value.vendorFieldPath === mapping.sourceField && value.supportsPull,
      );
    const target = targets[mapping.entityType]?.[mapping.targetField];
    const key = `${mapping.entityType}:${mapping.targetField}`;
    const duplicate = seen.has(key);
    seen.add(key);
    if (duplicate) return [mappingIssue("duplicate_target", details)];
    if (!target) return [mappingIssue("protected_target", details)];
    if (!source) return [mappingIssue("unknown_source", details)];
    if (source.sensitive) return [mappingIssue("sensitive_source", details)];
    if (source.type !== "string")
      return [mappingIssue("incompatible_type", details)];
    return [];
  });
}
export function applyConnectorFieldMappings(
  record: ExternalRecord,
  fields: readonly ConnectorFieldMapping[],
  capabilities: ConnectorCapabilities,
): { record: ExternalRecord; issues: ConnectorMappingIssue[] } {
  const selected = fields.length
    ? fields.filter((mapping) => mapping.entityType === record.entityType)
    : (capabilities.entities
        .find((entry) => entry.entityType === record.entityType)
        ?.fields.filter(
          (source) =>
            source.supportsPull &&
            !source.sensitive &&
            targets[record.entityType][source.field],
        )
        .map((source) => ({
          entityType: record.entityType,
          sourceField: source.vendorFieldPath,
          targetField: source.field,
          transform: "identity" as const,
        })) ?? []);
  const issues = validateConnectorFieldMappings(selected, capabilities);
  const values: Record<string, string | number | boolean | null> = {};
  for (const mapping of selected) {
    const source = capabilities.entities
      .find((entry) => entry.entityType === record.entityType)
      ?.fields.find((item) => item.vendorFieldPath === mapping.sourceField);
    const schema = targets[record.entityType][mapping.targetField];
    if (!source || source.sensitive || !schema) continue;
    const details = {
      entityType: record.entityType,
      sourceField: mapping.sourceField,
      targetField: mapping.targetField,
      recordId: record.externalId,
    };
    if (
      !Object.prototype.hasOwnProperty.call(record.fields, mapping.sourceField)
    ) {
      if (fields.length && source.required && record.changeKind === "upsert")
        issues.push(mappingIssue("missing_required", details));
      continue;
    }
    const value = record.fields[mapping.sourceField];
    const parsed = schema.safeParse(value);
    if (!parsed.success || value === undefined) {
      issues.push(mappingIssue("invalid_value", details));
      continue;
    }
    values[mapping.targetField] = parsed.data as string | null;
  }
  const { raw: discardedRaw, ...safeRecord } = record;
  void discardedRaw;
  return { record: { ...safeRecord, fields: values }, issues };
}

/** Exact active credential echoes fail the record instead of rewriting business data. */
export function protectConnectorSourceRecord(
  record: ExternalRecord,
  credential: string,
): { record: ExternalRecord; issues: ConnectorMappingIssue[] } {
  const { raw: discardedRaw, ...approved } = record;
  void discardedRaw;
  const values = [
    record.externalId,
    record.externalDisplayLabel,
    record.parentExternalId,
    ...Object.values(record.fields).filter(
      (value): value is string => typeof value === "string",
    ),
  ];
  if (!hasConnectorCredentialEcho(values, credential))
    return { record: approved, issues: [] };
  const safeId = "redacted-record";
  return {
    record: {
      ...approved,
      externalId: safeId,
      externalDisplayLabel: "Rejected source record",
      parentExternalId: null,
      fields: {},
    },
    issues: [
      mappingIssue("invalid_value", {
        entityType: record.entityType,
        recordId: safeId,
      }),
    ],
  };
}

export function hasConnectorCredentialEcho(
  values: readonly unknown[],
  credential: string,
): boolean {
  return (
    credential.length > 0 &&
    values.some(
      (value) => typeof value === "string" && value.includes(credential),
    )
  );
}
