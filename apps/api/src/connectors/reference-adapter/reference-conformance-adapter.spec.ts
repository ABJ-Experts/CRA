import type {
  ConnectorConnectionConfig,
  SyncCursor,
} from "../application/connector-port";
import { ReferenceConformanceAdapter } from "./reference-conformance-adapter";
import {
  CYCLE_SCENARIO_RECORDS,
  INVALID_SCENARIO_RECORDS,
  TOMBSTONE_NO_DEPENDENTS_EXTERNAL_ID,
  TOMBSTONE_SCENARIO_RECORDS,
  TOMBSTONE_WITH_DEPENDENTS_EXTERNAL_ID,
} from "./reference-conformance-fixtures";

function config(
  overrides: Partial<ConnectorConnectionConfig> = {},
): ConnectorConnectionConfig {
  return {
    connectorType: "reference_conformance",
    secretReference: {
      provider: "reference_fixture",
      reference: "fixture-secret",
    },
    ...overrides,
  };
}

describe("ReferenceConformanceAdapter", () => {
  it("reports success on testConnection with a configured secret", async () => {
    const adapter = new ReferenceConformanceAdapter();
    await expect(adapter.testConnection(config())).resolves.toMatchObject({
      outcome: "success",
      adapterVersion: "1.0.0",
    });
  });

  it("reports auth_failed when no secret reference is configured", async () => {
    const adapter = new ReferenceConformanceAdapter();
    await expect(
      adapter.testConnection(
        config({
          secretReference: { provider: "reference_fixture", reference: "" },
        }),
      ),
    ).resolves.toEqual({
      outcome: "failure",
      errorCode: "auth_failed",
      message: "No fixture secret reference is configured.",
    });
  });

  it("returns malformed_response on testConnection when malformed is simulated", async () => {
    const adapter = new ReferenceConformanceAdapter();
    await expect(
      adapter.testConnection(
        config({ scopeFilter: { simulate: "malformed" } }),
      ),
    ).resolves.toMatchObject({
      outcome: "failure",
      errorCode: "malformed_response",
    });
  });

  it("paginates deterministically and resumes from a mid-stream watermark", async () => {
    const adapter = new ReferenceConformanceAdapter();
    const cfg = config({ scopeFilter: { scenario: "pagination" } });

    const first = await adapter.pull(cfg, null, 2);
    expect(first.adapterSignal).toBe("ok");
    expect(first.records.map((r) => r.externalId)).toEqual([
      "PLM-PAGE-001",
      "PLM-PAGE-002",
    ]);
    expect(first.nextCursor).not.toBeNull();

    const second = await adapter.pull(cfg, first.nextCursor, 2);
    expect(second.records.map((r) => r.externalId)).toEqual([
      "PLM-PAGE-003",
      "PLM-PAGE-004",
    ]);
    expect(second.nextCursor).toBeNull();

    const midStreamCursor: SyncCursor = {
      watermark: "2026-03-01T00:00:01.000Z",
      token: "2026-03-01T00:00:01.000Z|PLM-PAGE-002",
    };
    const third = await adapter.pull(cfg, midStreamCursor, 10);
    expect(third.records.map((r) => r.externalId)).toEqual([
      "PLM-PAGE-003",
      "PLM-PAGE-004",
    ]);
    expect(third.nextCursor).toBeNull();
  });

  it("returns nothing new on a later incremental pull resumed from the last-seen watermark", async () => {
    // `nextCursor` is null once a call drains every currently-available
    // record -- it means "no further page in this call", not "resume point
    // for a future run". A future incremental run resumes from the
    // watermark of the last record the caller actually processed, exactly
    // like the mid-stream pagination case above.
    const adapter = new ReferenceConformanceAdapter();
    const cfg = config({ scopeFilter: { scenario: "unchanged" } });
    const first = await adapter.pull(cfg, null, 10);
    expect(first.records).toHaveLength(1);
    expect(first.nextCursor).toBeNull();

    const resumeCursor: SyncCursor = {
      watermark: first.records[0]!.externalUpdatedAt,
      token: `${first.records[0]!.externalUpdatedAt}|${first.records[0]!.externalId}`,
    };
    const second = await adapter.pull(cfg, resumeCursor, 10);
    expect(second.records).toEqual([]);
    expect(second.nextCursor).toBeNull();
  });

  it("rate-limits the first calls then recovers, isolated per connector secret", async () => {
    const adapter = new ReferenceConformanceAdapter();
    const cfg = config({
      scopeFilter: { simulate: "rate_limit", scenario: "create" },
    });
    const first = await adapter.pull(cfg, null, 10);
    expect(first).toMatchObject({ records: [], adapterSignal: "rate_limited" });
    const secondCall = await adapter.pull(cfg, null, 10);
    expect(secondCall.adapterSignal).toBe("rate_limited");
    const third = await adapter.pull(cfg, null, 10);
    expect(third.adapterSignal).toBe("ok");
    expect(third.records).toHaveLength(1);

    const otherConnector = config({
      scopeFilter: { simulate: "rate_limit", scenario: "create" },
      secretReference: {
        provider: "reference_fixture",
        reference: "other-secret",
      },
    });
    const otherFirst = await adapter.pull(otherConnector, null, 10);
    expect(otherFirst.adapterSignal).toBe("rate_limited");
  });

  it("serves the invalid fixture, with an empty externalId and an oversized description, when malformed is simulated", async () => {
    const adapter = new ReferenceConformanceAdapter();
    const page = await adapter.pull(
      config({ scopeFilter: { simulate: "malformed" } }),
      null,
      10,
    );
    expect(page.records).toEqual(INVALID_SCENARIO_RECORDS);
    expect(page.records[0]!.externalId).toBe("");
    expect(
      (page.records[0]!.fields.description as string).length,
    ).toBeGreaterThan(4_000);
  });

  it("exposes a tombstone with no dependents and one whose parentExternalId is still referenced", async () => {
    const adapter = new ReferenceConformanceAdapter();
    const page = await adapter.pull(
      config({ scopeFilter: { scenario: "tombstone" } }),
      null,
      10,
    );
    const leaf = page.records.find(
      (r) => r.externalId === TOMBSTONE_NO_DEPENDENTS_EXTERNAL_ID,
    );
    const parent = page.records.find(
      (r) => r.externalId === TOMBSTONE_WITH_DEPENDENTS_EXTERNAL_ID,
    );
    expect(leaf).toMatchObject({
      changeKind: "tombstone",
      tombstoneReliability: "confirmed",
    });
    expect(parent).toMatchObject({
      changeKind: "tombstone",
      tombstoneReliability: "confirmed",
    });
    expect(
      page.records.some(
        (r) => r.parentExternalId === TOMBSTONE_WITH_DEPENDENTS_EXTERNAL_ID,
      ),
    ).toBe(true);
    expect(
      page.records.some(
        (r) => r.parentExternalId === TOMBSTONE_NO_DEPENDENTS_EXTERNAL_ID,
      ),
    ).toBe(false);
    expect(TOMBSTONE_SCENARIO_RECORDS).toHaveLength(3);
  });

  it("links three cycle records A -> B -> C -> A via parentExternalId", async () => {
    const adapter = new ReferenceConformanceAdapter();
    const page = await adapter.pull(
      config({ scopeFilter: { scenario: "cycle" } }),
      null,
      10,
    );
    const byId = new Map(page.records.map((r) => [r.externalId, r]));
    expect(byId.get("PLM-CYCLE-A")?.parentExternalId).toBe("PLM-CYCLE-B");
    expect(byId.get("PLM-CYCLE-B")?.parentExternalId).toBe("PLM-CYCLE-C");
    expect(byId.get("PLM-CYCLE-C")?.parentExternalId).toBe("PLM-CYCLE-A");
    expect(CYCLE_SCENARIO_RECORDS).toHaveLength(3);
  });

  it("rejects an empty externalId and an oversized field on push, and accepts a valid record", async () => {
    const adapter = new ReferenceConformanceAdapter();
    const [emptyId, oversized, valid] = await adapter.push(config(), [
      { entityType: "product", externalId: "", fields: {} },
      {
        entityType: "product",
        externalId: "PLM-1",
        fields: { description: "X".repeat(4_001) },
      },
      {
        entityType: "product",
        externalId: "PLM-2",
        fields: { name: "Gateway" },
      },
    ]);
    expect(emptyId).toMatchObject({
      outcome: "rejected",
      errorCode: "malformed_response",
    });
    expect(oversized).toMatchObject({
      outcome: "rejected",
      errorCode: "payload_too_large",
    });
    expect(valid?.outcome).toBe("accepted");
  });

  it("advertises product and release field capabilities", async () => {
    const adapter = new ReferenceConformanceAdapter();
    const capabilities = await adapter.discoverCapabilities();
    expect(capabilities.entities.map((e) => e.entityType).sort()).toEqual([
      "product",
      "release",
    ]);
  });
});
