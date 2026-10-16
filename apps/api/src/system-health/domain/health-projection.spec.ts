import {
  sourceComponent,
  parseSourceData,
  unavailableQueue,
} from "./health-projection";
import type { HealthSourceObservation } from "./health-source";
const stamp = "2026-10-14T00:00:00.000Z";
const observation = (data: unknown): HealthSourceObservation => ({
  outcome: "ready",
  source: "deadline_monitor",
  sourceAt: stamp,
  observedAt: stamp,
  data,
  reasons: [],
});
it.each([
  [{ lastHeartbeatAt: stamp, critical: false }, stamp, "healthy"],
  [{ lastHeartbeatAt: stamp, critical: true }, stamp, "degraded"],
  [
    { lastHeartbeatAt: stamp, critical: false },
    "2026-10-14T00:02:00.001Z",
    "stale",
  ],
  [{ lastHeartbeatAt: null, critical: false }, stamp, "unknown"],
  [{ lastHeartbeatAt: stamp }, stamp, "unknown"],
  [{ unknown: "private" }, stamp, "unknown"],
])("uses only M6 heartbeat and critical authority", (data, now, status) =>
  expect(
    sourceComponent(
      "deadline_monitor",
      { outcome: "ready", value: observation(data) },
      now,
    ).status,
  ).toBe(status),
);
it.each(["probe_timeout", "source_unavailable"] as const)(
  "uses safe failed source reason %s",
  (reason) =>
    expect(
      sourceComponent("licensing", { outcome: "unreachable", reason }, stamp)
        .status,
    ).toBe("unreachable"),
);
it("withholds missing permission and preserves source-specific unavailable reason", () => {
  const value = {
    ...observation(null),
    outcome: "withheld" as const,
    reasons: [],
  };
  expect(
    sourceComponent("licensing", { outcome: "ready", value }, stamp).reasons,
  ).toEqual(["source_permission_withheld"]);
  expect(parseSourceData(value)).toBeNull();
  expect(
    sourceComponent(
      "licensing",
      {
        outcome: "ready",
        value: { ...value, reasons: ["licence_unavailable"] },
      },
      stamp,
    ).reasons,
  ).toEqual(["licence_unavailable"]);
});
it.each(["active", "expired_read_only"] as const)(
  "reflects existing licence state %s",
  (state) => {
    const value = observation({
      licence: {
        state,
        expiresAt: null,
        graceEndsAt: null,
        managementUrl: "/organization?settings=licence",
        usageUrl: "/organization?settings=licence",
        sourceAt: stamp,
        observedAt: stamp,
      },
    });
    expect(
      sourceComponent("licensing", { outcome: "ready", value }, stamp).status,
    ).toBe(state === "active" ? "healthy" : "degraded");
  },
);
it("does not invent successful source times", () => {
  const value = {
    ...observation({
      storage: {
        status: "unknown",
        customerBytes: null,
        customerReservedBytes: null,
        protectedBytes: null,
        unit: "bytes",
        sourceAt: null,
        observedAt: null,
        reasons: ["meter_unavailable"],
        reachability: "unknown",
        integrity: "unknown",
      },
    }),
    sourceAt: null,
  };
  expect(
    sourceComponent("usage_metering", { outcome: "ready", value }, stamp)
      .status,
  ).toBe("unknown");
});
it("preserves unknown counts when ready source omits a queue", () => {
  expect(
    unavailableQueue("exports", { outcome: "ready", value: observation({}) })
      .availability,
  ).toBe("unavailable");
  expect(
    unavailableQueue("exports", {
      outcome: "unreachable",
      reason: "probe_timeout",
    }).pending,
  ).toBeNull();
});
it("uses source feed timestamps rather than a fabricated heartbeat", () => {
  const value = observation({
    feedFreshness: [
      {
        id: "nvd",
        label: "NVD",
        status: "healthy",
        lastSuccessAt: stamp,
        lastSourceSnapshotAt: stamp,
        staleAfterSeconds: 3600,
        sourceAt: stamp,
        observedAt: stamp,
        reasons: [],
      },
    ],
  });
  expect(
    sourceComponent("vulnerability_feeds", { outcome: "ready", value }, stamp)
      .sourceAt,
  ).toBe(stamp);
});
it.each(["stale", "unknown", "degraded"] as const)(
  "retains source-owned feed status %s",
  (status) => {
    const value = observation({
      feedFreshness: [
        {
          id: "nvd",
          label: "NVD",
          status,
          lastSuccessAt: stamp,
          lastSourceSnapshotAt: stamp,
          staleAfterSeconds: 3600,
          sourceAt: stamp,
          observedAt: stamp,
          reasons: ["source_stale"],
        },
      ],
    });
    expect(
      sourceComponent("vulnerability_feeds", { outcome: "ready", value }, stamp)
        .status,
    ).toBe(status);
  },
);
it("does not call a missing meter healthy when the probe succeeds", () => {
  const value = observation({
    storage: {
      status: "unknown",
      customerBytes: null,
      customerReservedBytes: null,
      protectedBytes: null,
      unit: "bytes",
      sourceAt: null,
      observedAt: stamp,
      reasons: ["meter_unavailable"],
      reachability: "unknown",
      integrity: "unknown",
    },
  });
  expect(
    sourceComponent("usage_metering", { outcome: "ready", value }, stamp)
      .status,
  ).toBe("unknown");
});
it.each(["grace", "invalid", "clock_untrusted"] as const)(
  "exposes licence %s as degraded",
  (state) => {
    const value = observation({
      licence: {
        state,
        expiresAt: null,
        graceEndsAt: null,
        managementUrl: null,
        usageUrl: null,
        sourceAt: stamp,
        observedAt: stamp,
      },
    });
    expect(
      sourceComponent("licensing", { outcome: "ready", value }, stamp).status,
    ).toBe("degraded");
  },
);
it("keeps an authoritative missing licence unknown", () => {
  const value = observation({
    licence: {
      state: "missing",
      expiresAt: null,
      graceEndsAt: null,
      managementUrl: null,
      usageUrl: null,
      sourceAt: stamp,
      observedAt: stamp,
    },
  });
  expect(
    sourceComponent("licensing", { outcome: "ready", value }, stamp).status,
  ).toBe("unknown");
});
