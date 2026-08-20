import type { ExternalRecord } from "../application/connector-port";

/**
 * Deterministic, in-memory fixture data for the reference conformance
 * adapter. No network, no vendor SDK -- this is what proves the
 * `ConnectorPort` contract end to end. Every array is a self-contained,
 * independently named scenario selected via `scopeFilter.scenario`; the two
 * cross-cutting simulations (`rate_limit`, `malformed`) are selected via
 * `scopeFilter.simulate` in the adapter itself.
 */

function record(
  overrides: Partial<ExternalRecord> &
    Pick<ExternalRecord, "externalId" | "externalUpdatedAt">,
): ExternalRecord {
  return Object.freeze({
    entityType: "product",
    externalDisplayLabel: overrides.externalId,
    changeKind: "upsert",
    tombstoneReliability: "unknown",
    parentExternalId: null,
    fields: {},
    ...overrides,
  });
}

/** 1. create -- a never-seen externalId. */
export const CREATE_SCENARIO_RECORDS: readonly ExternalRecord[] = Object.freeze(
  [
    record({
      externalId: "PLM-CREATE-001",
      externalDisplayLabel: "Sentinel Gateway (PLM)",
      externalUpdatedAt: "2026-01-05T00:00:00.000Z",
      fields: {
        name: "Sentinel Gateway",
        internalCode: "GW-100",
        productType: "hardware_with_software",
        description: "Edge gateway appliance",
      },
    }),
  ],
);

/**
 * 2. update -- differs from the CRA baseline a caller is expected to assume
 * already exists. `UPDATE_SCENARIO_CRA_BASELINE_FIELDS` is that baseline: a
 * test diffs the fixture's `fields.description` against it.
 */
export const UPDATE_SCENARIO_CRA_BASELINE_FIELDS: Readonly<
  Record<string, string | number | boolean | null>
> = Object.freeze({
  name: "Sentinel Gateway",
  description: "Edge gateway appliance, rev A",
});
export const UPDATE_SCENARIO_RECORDS: readonly ExternalRecord[] = Object.freeze(
  [
    record({
      externalId: "PLM-UPDATE-001",
      externalDisplayLabel: "Sentinel Gateway (PLM)",
      externalUpdatedAt: "2026-01-10T00:00:00.000Z",
      fields: {
        name: "Sentinel Gateway",
        description: "Edge gateway appliance, rev B -- adds PoE++ support",
      },
    }),
  ],
);

/** 3. unchanged -- an identical repeat `pull()` from the returned cursor yields nothing new. */
export const UNCHANGED_SCENARIO_RECORDS: readonly ExternalRecord[] =
  Object.freeze([
    record({
      externalId: "PLM-UNCHANGED-001",
      externalDisplayLabel: "Beacon Sensor (PLM)",
      externalUpdatedAt: "2026-01-15T00:00:00.000Z",
      fields: {
        name: "Beacon Sensor",
        internalCode: "BC-200",
        productType: "hardware_with_software",
        description: "Perimeter beacon sensor",
      },
    }),
  ]);

/**
 * 4. tombstone, two variants. `TOMBSTONE_NO_DEPENDENTS_EXTERNAL_ID` has
 * nothing referencing it; `TOMBSTONE_WITH_DEPENDENTS_EXTERNAL_ID` is still
 * the `parentExternalId` of a still-active record in this same array. The
 * adapter only supplies that signal -- whether an active dependent blocks
 * the archive is the consuming worker/policy layer's call, not this file's.
 */
export const TOMBSTONE_NO_DEPENDENTS_EXTERNAL_ID = "PLM-TOMBSTONE-LEAF-001";
export const TOMBSTONE_WITH_DEPENDENTS_EXTERNAL_ID = "PLM-TOMBSTONE-PARENT-001";
export const TOMBSTONE_SCENARIO_RECORDS: readonly ExternalRecord[] =
  Object.freeze([
    record({
      entityType: "release",
      externalId: TOMBSTONE_NO_DEPENDENTS_EXTERNAL_ID,
      externalDisplayLabel: "Beacon Sensor 0.9.0-beta (retired)",
      externalUpdatedAt: "2026-01-20T00:00:00.000Z",
      changeKind: "tombstone",
      tombstoneReliability: "confirmed",
    }),
    record({
      externalId: TOMBSTONE_WITH_DEPENDENTS_EXTERNAL_ID,
      externalDisplayLabel: "Legacy Relay Module (retired)",
      externalUpdatedAt: "2026-01-20T00:00:01.000Z",
      changeKind: "tombstone",
      tombstoneReliability: "confirmed",
    }),
    record({
      externalId: "PLM-TOMBSTONE-PARENT-001-CHILD",
      externalDisplayLabel: "Relay Submodule",
      externalUpdatedAt: "2026-01-20T00:00:02.000Z",
      parentExternalId: TOMBSTONE_WITH_DEPENDENTS_EXTERNAL_ID,
      fields: {
        name: "Relay Submodule",
        internalCode: "RS-050",
        productType: "component",
      },
    }),
  ]);

/**
 * 5. conflict-shaped -- differs from a "last observed" snapshot a test is
 * expected to assume, exported alongside it as
 * `CONFLICT_SCENARIO_LAST_OBSERVED_FIELDS`.
 */
export const CONFLICT_SCENARIO_LAST_OBSERVED_FIELDS: Readonly<
  Record<string, string | number | boolean | null>
> = Object.freeze({
  description: "Certified for EN 303 645 as of Q1 2026",
});
export const CONFLICT_SCENARIO_RECORDS: readonly ExternalRecord[] =
  Object.freeze([
    record({
      entityType: "release",
      externalId: "PLM-CONFLICT-001",
      externalDisplayLabel: "Sentinel Gateway 2.1.0",
      externalUpdatedAt: "2026-01-25T00:00:00.000Z",
      fields: {
        releaseVersion: "2.1.0",
        description: "Certification pending re-assessment after chipset change",
      },
    }),
  ]);

/** 6. invalid -- an empty externalId and a `fields.description` far past 4000 chars. */
export const INVALID_SCENARIO_OVERSIZED_DESCRIPTION = "X".repeat(4_500);
export const INVALID_SCENARIO_RECORDS: readonly ExternalRecord[] =
  Object.freeze([
    record({
      externalId: "",
      externalDisplayLabel: "",
      externalUpdatedAt: "2026-01-30T00:00:00.000Z",
      fields: { description: INVALID_SCENARIO_OVERSIZED_DESCRIPTION },
    }),
  ]);

/** 7. cycle -- three linked records A -> B -> C -> A via parentExternalId. */
export const CYCLE_SCENARIO_RECORDS: readonly ExternalRecord[] = Object.freeze([
  record({
    externalId: "PLM-CYCLE-A",
    externalDisplayLabel: "Cycle Node A",
    externalUpdatedAt: "2026-02-01T00:00:00.000Z",
    parentExternalId: "PLM-CYCLE-B",
    fields: {
      name: "Cycle Node A",
      internalCode: "CY-A",
      productType: "component",
    },
  }),
  record({
    externalId: "PLM-CYCLE-B",
    externalDisplayLabel: "Cycle Node B",
    externalUpdatedAt: "2026-02-01T00:00:01.000Z",
    parentExternalId: "PLM-CYCLE-C",
    fields: {
      name: "Cycle Node B",
      internalCode: "CY-B",
      productType: "component",
    },
  }),
  record({
    externalId: "PLM-CYCLE-C",
    externalDisplayLabel: "Cycle Node C",
    externalUpdatedAt: "2026-02-01T00:00:02.000Z",
    parentExternalId: "PLM-CYCLE-A",
    fields: {
      name: "Cycle Node C",
      internalCode: "CY-C",
      productType: "component",
    },
  }),
]);

/**
 * 8. pagination -- four records, enough to exercise `pull()` with
 * `pageSize=2` across two full pages plus a third call starting from a
 * mid-stream watermark.
 */
export const PAGINATION_SCENARIO_RECORDS: readonly ExternalRecord[] =
  Object.freeze([
    record({
      externalId: "PLM-PAGE-001",
      externalUpdatedAt: "2026-03-01T00:00:00.000Z",
      fields: { name: "Page Record 1" },
    }),
    record({
      externalId: "PLM-PAGE-002",
      externalUpdatedAt: "2026-03-01T00:00:01.000Z",
      fields: { name: "Page Record 2" },
    }),
    record({
      externalId: "PLM-PAGE-003",
      externalUpdatedAt: "2026-03-01T00:00:02.000Z",
      fields: { name: "Page Record 3" },
    }),
    record({
      externalId: "PLM-PAGE-004",
      externalUpdatedAt: "2026-03-01T00:00:03.000Z",
      fields: { name: "Page Record 4" },
    }),
  ]);

export const REFERENCE_ADAPTER_SCENARIO_RECORDS = Object.freeze({
  create: CREATE_SCENARIO_RECORDS,
  update: UPDATE_SCENARIO_RECORDS,
  unchanged: UNCHANGED_SCENARIO_RECORDS,
  tombstone: TOMBSTONE_SCENARIO_RECORDS,
  conflict: CONFLICT_SCENARIO_RECORDS,
  invalid: INVALID_SCENARIO_RECORDS,
  cycle: CYCLE_SCENARIO_RECORDS,
  pagination: PAGINATION_SCENARIO_RECORDS,
});

export type ReferenceAdapterScenario =
  keyof typeof REFERENCE_ADAPTER_SCENARIO_RECORDS;

export function isReferenceAdapterScenario(
  value: string | undefined,
): value is ReferenceAdapterScenario {
  return value !== undefined && value in REFERENCE_ADAPTER_SCENARIO_RECORDS;
}
