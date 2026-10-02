import { describe, expect, it } from "vitest";
import {
  connectorFieldMappingSchema,
  saveConnectorFieldMappingInputSchema,
  replaySyncRunInputSchema,
  connectorCapabilitiesSchema,
  syncHistoryQuerySchema,
  syncRunAttemptSchema,
} from "./sync-operations.schema.js";
describe("sync operation boundaries", () => {
  it("accepts completed planning attempts that require manual review", () => {
    const attempt = {
      id: "11111111-1111-4111-8111-111111111111",
      runId: "22222222-2222-4222-8222-222222222222",
      generation: 1,
      phase: "dry_run",
      startedAt: "2026-09-29T00:00:00Z",
      finishedAt: "2026-09-29T00:00:01Z",
      outcome: "review_required",
      errorCategory: null,
      errorCode: null,
      nextAttemptAt: null,
      recordIds: [],
    };
    expect(syncRunAttemptSchema.parse(attempt)).toEqual(attempt);
  });
  it("accepts only constrained identity mappings", () => {
    const value = {
      entityType: "product",
      sourceField: "title",
      targetField: "name",
      transform: "identity",
    };
    expect(connectorFieldMappingSchema.parse(value)).toEqual(value);
    expect(
      connectorFieldMappingSchema.safeParse({ ...value, transform: "eval" })
        .success,
    ).toBe(false);
    expect(
      connectorFieldMappingSchema.safeParse({
        ...value,
        sourceField: "__proto__",
      }).success,
    ).toBe(false);
  });
  it("requires concurrency and idempotency metadata", () => {
    expect(
      saveConnectorFieldMappingInputSchema.safeParse({ fields: [] }).success,
    ).toBe(false);
    expect(
      replaySyncRunInputSchema.safeParse({ expectedVersion: 1 }).success,
    ).toBe(false);
  });
  it("bounds pagination and rejects unused inputs", () => {
    expect(syncHistoryQuerySchema.parse({})).toEqual({ page: 1, pageSize: 15 });
    expect(syncHistoryQuerySchema.safeParse({ pageSize: 101 }).success).toBe(
      false,
    );
    expect(syncHistoryQuerySchema.safeParse({ q: "secret" }).success).toBe(
      false,
    );
  });
  it("requires discovery type and sensitivity rather than assuming them", () => {
    expect(
      connectorCapabilitiesSchema.safeParse({
        adapterVersion: "1",
        mappingVersion: "v1",
        entities: [
          {
            entityType: "product",
            fields: [
              {
                field: "name",
                vendorFieldPath: "name",
                supportsPull: true,
                supportsPush: false,
              },
            ],
            supportsPush: false,
            supportsTombstones: true,
            supportsHierarchy: true,
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("reference recovery fixtures", () => {
  it("allows isolated poison and repair scenarios", async () => {
    const { connectorConfigurationInputSchema } =
      await import("./connector.schema.js");
    for (const scenario of ["poison", "repaired"]) {
      expect(
        connectorConfigurationInputSchema.safeParse({
          scopeFilter: { scenario },
        }).success,
      ).toBe(true);
    }
  });
});
