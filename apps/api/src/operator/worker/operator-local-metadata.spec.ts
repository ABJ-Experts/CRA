import { OperatorLocalMetadataEnricher } from "./operator-local-metadata";
import {
  operatorInstanceMetadataResponseSchema,
  licenseCurrentResponseSchema,
} from "@repo/contracts";
const stamp = "2026-01-01T00:00:00.000Z";
const id = "20000000-0000-4000-8000-000000000001";
const tenantId = "30000000-0000-4000-8000-000000000001";
const metadata = () =>
  operatorInstanceMetadataResponseSchema.parse({
    schemaVersion: 1,
    instanceId: id,
    revision: 1,
    sourceAt: stamp,
    observedAt: stamp,
    instance: { instanceId: id, label: "Local" },
    tenants: [{ tenantId, label: "Tenant" }],
    nextCursor: null,
  });
function current(
  state:
    | "active"
    | "grace"
    | "expired_read_only"
    | "missing"
    | "invalid"
    | "clock_untrusted",
) {
  return licenseCurrentResponseSchema.parse({
    instanceId: id,
    version: 2,
    claims: null,
    keyId: null,
    digest: null,
    usage: {
      activeMembers: 0,
      products: 0,
      storageBytes: 0,
      storageReservedBytes: 0,
      protectedStorageBytes: 0,
      availability: "ready",
    },
    lastRejected: null,
    policy: {
      state,
      reasons: [],
      warnings: [],
      effectiveCapabilities: [],
      disabledCapabilities: [],
      customerWritesAllowed: state === "active" || state === "grace",
      evidenceExportAllowed: true,
      evaluatedAt: stamp,
      expiresAt:
        state === "active"
          ? "2026-01-02T00:00:00.000Z"
          : state === "grace"
            ? "2025-12-31T00:00:00.000Z"
            : state === "expired_read_only"
              ? "2025-12-01T00:00:00.000Z"
              : null,
      graceEndsAt:
        state === "active"
          ? "2026-02-01T00:00:00.000Z"
          : state === "grace"
            ? "2026-01-30T00:00:00.000Z"
            : state === "expired_read_only"
              ? "2025-12-31T00:00:00.000Z"
              : null,
    },
  });
}
describe("local approved source enrichment", () => {
  it("uses verified local licensing per bounded tenant and real build metadata", async () => {
    let state: "active" | "grace" = "active";
    const licensing = {
      getCurrent: jest
        .fn()
        .mockImplementation(() => Promise.resolve(current(state))),
    };
    const enricher = new OperatorLocalMetadataEnricher(
      licensing,
      { version: "1.0", commit: "abcdef0", builtAt: stamp },
      "1.1",
    );
    const first = await enricher.enrich(metadata(), AbortSignal.timeout(1000));
    expect(first.tenants[0]!.licenceState).toBe("active");
    expect(first.instance.versionDrift).toBe("different");
    expect(licensing.getCurrent).toHaveBeenCalledWith(
      tenantId,
      "",
      expect.any(AbortSignal),
    );
    state = "grace";
    const renewed = await enricher.enrich(
      metadata(),
      AbortSignal.timeout(1000),
    );
    expect(renewed.tenants[0]!.licenceState).toBe("grace");
    expect(
      (
        await new OperatorLocalMetadataEnricher(
          licensing,
          { version: "1.1", commit: "abcdef1", builtAt: stamp },
          "1.1",
        ).enrich(metadata(), AbortSignal.timeout(1000))
      ).instance.versionDrift,
    ).toBe("matched");
  });
  it("reports unknown without mounted trust/build and isolates licensing failure", async () => {
    const absent = await new OperatorLocalMetadataEnricher(
      null,
      null,
      null,
    ).enrich(metadata(), AbortSignal.timeout(1000));
    expect(absent.tenants[0]!.licenceState).toBeNull();
    expect(absent.instance.version).toBeNull();
    const failed = await new OperatorLocalMetadataEnricher(
      {
        getCurrent: () => {
          return Promise.reject(new Error("secret"));
        },
      },
      null,
      null,
    ).enrich(metadata(), AbortSignal.timeout(1000));
    expect(failed.tenants[0]!.licenceState).toBeNull();
    expect(JSON.stringify(failed)).not.toContain("secret");
  });
});

it("represents verified expiry, invalidity, missing licence and untrusted clocks without content", async () => {
  for (const state of [
    "expired_read_only",
    "invalid",
    "missing",
    "clock_untrusted",
  ] as const) {
    const input = metadata();
    input.tenants[0]!.sources = [
      {
        source: "licensing",
        status: "unknown",
        sourceAt: null,
        observedAt: null,
        attemptedAt: null,
        succeededAt: null,
        receivedAt: null,
        reasons: ["licence_unavailable"],
      },
    ];
    input.instance.sources = [
      {
        source: "version",
        status: "unknown",
        sourceAt: null,
        observedAt: null,
        attemptedAt: null,
        succeededAt: null,
        receivedAt: null,
        reasons: ["version_unavailable"],
      },
    ];
    const data = await new OperatorLocalMetadataEnricher(
      { getCurrent: () => Promise.resolve(current(state)) },
      { version: "1", commit: null, builtAt: stamp },
      null,
    ).enrich(input, AbortSignal.timeout(1000));
    expect(data.tenants[0]!.licenceState).toBe(state);
    expect(
      data.tenants[0]!.sources.filter((item) => item.source === "licensing"),
    ).toHaveLength(1);
  }
  const unavailable = {
    ...current("invalid"),
    policy: { ...current("invalid").policy, reasons: ["trust_unavailable"] },
  };
  expect(
    (
      await new OperatorLocalMetadataEnricher(
        { getCurrent: () => Promise.resolve(unavailable) },
        null,
        null,
      ).enrich(metadata(), AbortSignal.timeout(1000))
    ).tenants[0]!.licenceState,
  ).toBeNull();
});
