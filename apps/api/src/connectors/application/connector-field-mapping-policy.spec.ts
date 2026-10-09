import {
  applyConnectorFieldMappings,
  validateConnectorFieldMappings,
  connectorMappingDiscovery,
  protectConnectorSourceRecord,
} from "./connector-field-mapping-policy";
import type { ConnectorCapabilities } from "./connector-port";
const capabilities = {
  adapterVersion: "1",
  mappingVersion: "v1",
  entities: [
    {
      entityType: "product",
      supportsPush: false,
      supportsTombstones: false,
      supportsHierarchy: false,
      fields: [
        {
          field: "title",
          vendorFieldPath: "title",
          supportsPull: true,
          supportsPush: false,
          type: "string",
          nullable: false,
          required: true,
          sensitive: false,
        },
        {
          field: "description",
          vendorFieldPath: "description",
          supportsPull: true,
          supportsPush: false,
          type: "string",
          nullable: true,
          required: false,
          sensitive: false,
        },
      ],
    },
  ],
} as unknown as ConnectorCapabilities;
const record = {
  entityType: "product" as const,
  externalId: "one",
  externalDisplayLabel: "One",
  externalUpdatedAt: "2026-09-29T00:00:00Z",
  changeKind: "upsert" as const,
  tombstoneReliability: "unknown" as const,
  parentExternalId: null,
  fields: {},
};
const mapping = {
  entityType: "product" as const,
  sourceField: "title",
  targetField: "name",
  transform: "identity" as const,
};
describe("safe identity field mapping", () => {
  it("does not turn missing fields into null", () => {
    const result = applyConnectorFieldMappings(record, [mapping], capabilities);
    expect(result.record.fields).toEqual({});
    expect(result.issues[0]!.code).toBe("missing_required");
  });
  it("keeps explicit nullable description but rejects null name", () => {
    expect(
      applyConnectorFieldMappings(
        { ...record, fields: { description: null } },
        [
          {
            ...mapping,
            sourceField: "description",
            targetField: "description",
          },
        ],
        capabilities,
      ).record.fields,
    ).toEqual({ description: null });
    expect(
      applyConnectorFieldMappings(
        { ...record, fields: { title: null } },
        [mapping],
        capabilities,
      ).issues[0]!.code,
    ).toBe("invalid_value");
  });
  it("validates actual product field constraints", () => {
    expect(
      applyConnectorFieldMappings(
        { ...record, fields: { title: "Valid" } },
        [mapping],
        capabilities,
      ).record.fields,
    ).toEqual({ name: "Valid" });
    expect(
      applyConnectorFieldMappings(
        { ...record, fields: { title: "" } },
        [mapping],
        capabilities,
      ).issues[0]!.code,
    ).toBe("invalid_value");
  });
  it("rejects unknown, protected, duplicate and sensitive mappings", () => {
    expect(
      validateConnectorFieldMappings(
        [{ ...mapping, targetField: "organizationId" }],
        capabilities,
      )[0]!.code,
    ).toBe("protected_target");
    expect(
      validateConnectorFieldMappings(
        [{ ...mapping, sourceField: "missing" }],
        capabilities,
      )[0]!.code,
    ).toBe("unknown_source");
    expect(
      validateConnectorFieldMappings([mapping, mapping], capabilities)[0]!.code,
    ).toBe("duplicate_target");
  });
  it("drops raw payloads and unknown unmapped fields", () => {
    expect(
      applyConnectorFieldMappings(
        {
          ...record,
          raw: { secret: "canary" },
          fields: { organizationId: "canary" },
        },
        [],
        capabilities,
      ).record,
    ).not.toHaveProperty("raw");
  });
});

describe("discovered metadata and source protections", () => {
  it("versions discovery metadata deterministically without credential values", () => {
    const first = connectorMappingDiscovery(capabilities);
    expect(first.schemaDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(connectorMappingDiscovery(capabilities)).toEqual(first);
    expect(
      first.targets[0]?.fields.find((value) => value.field === "description")
        ?.nullable,
    ).toBe(true);
  });
  it("rejects sensitive and nonstring sources", () => {
    const entity = capabilities.entities[0]!;
    const source = entity.fields[0]!;
    expect(
      validateConnectorFieldMappings([mapping], {
        ...capabilities,
        entities: [{ ...entity, fields: [{ ...source, sensitive: true }] }],
      })[0]?.code,
    ).toBe("sensitive_source");
    expect(
      validateConnectorFieldMappings([mapping], {
        ...capabilities,
        entities: [{ ...entity, fields: [{ ...source, type: "number" }] }],
      })[0]?.code,
    ).toBe("incompatible_type");
  });
  it("tombstones do not require business values", () => {
    expect(
      applyConnectorFieldMappings(
        { ...record, changeKind: "tombstone" },
        [mapping],
        capabilities,
      ).issues,
    ).toEqual([]);
  });
});

describe("active credential echo boundary", () => {
  it("rejects credential echoes without retaining source fields or identity", () => {
    const result = protectConnectorSourceRecord(
      {
        ...record,
        externalId: "id-active-canary",
        fields: { title: "active-canary" },
      },
      "active-canary",
    );
    expect(result.issues[0]?.code).toBe("invalid_value");
    expect(JSON.stringify(result)).not.toContain("active-canary");
    expect(result.record.fields).toEqual({});
  });
  it("discards raw secret payloads without blocking safe business data", () => {
    const result = protectConnectorSourceRecord(
      {
        ...record,
        raw: { secret: "active-canary" },
        fields: { title: "Safe" },
      },
      "active-canary",
    );
    expect(result.issues).toEqual([]);
    expect(result.record).not.toHaveProperty("raw");
  });
});
