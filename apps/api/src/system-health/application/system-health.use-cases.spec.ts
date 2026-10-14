import { SystemHealthUseCases } from "./system-health.use-cases";
import type { SystemHealthSourcePort } from "./system-health.port";
import { SystemHealthAuthorizationError } from "./system-health.port";
const org = "00000000-0000-4000-8000-000000000001";
const actor = "00000000-0000-4000-8000-000000000002";
const now = "2026-10-14T00:05:00.000Z";
const sourceAt = "2026-10-14T00:00:00.000Z";
const runtime = {
  database: () => Promise.resolve(true),
  audit: () => Promise.resolve(true),
  storage: () => Promise.resolve(true),
};
const readSource = jest.fn<
  ReturnType<SystemHealthSourcePort["readSource"]>,
  Parameters<SystemHealthSourcePort["readSource"]>
>();
function app() {
  return new SystemHealthUseCases(
    { readSource },
    runtime,
    null,
    () => new Date(now),
  );
}
beforeEach(() =>
  readSource.mockImplementation((_org, _actor, source) =>
    Promise.resolve({
      outcome: "withheld",
      source,
      sourceAt: null,
      observedAt: now,
      data: null,
      reasons: ["source_permission_withheld"],
    }),
  ),
);
it("retains null unknown observations and independent runtime success", async () => {
  const result = await app().read(org, actor);
  expect(result.currentVersion.version).toBeNull();
  expect(result.storage.customerBytes).toBeNull();
  expect(result.storage.integrity).toBe("unknown");
  expect(result.backup.lastExecutionAt).toBeNull();
  expect(result.evidenceExportPreserved).toBe(true);
  expect(result.licence.managementUrl).toBeNull();
  expect(result.queues.every((q) => q.pending === null)).toBe(true);
  expect(result.components.find((c) => c.id === "database")?.status).toBe(
    "healthy",
  );
  expect(
    readSource.mock.calls.every(
      (args) =>
        args[0] === org && args[1] === actor && args[3] instanceof AbortSignal,
    ),
  ).toBe(true);
});
it("does not treat an empty queue as a worker heartbeat", async () => {
  readSource.mockImplementation((_org, _actor, source) =>
    Promise.resolve({
      outcome: "ready",
      source,
      sourceAt,
      observedAt: now,
      data:
        source === "deadline_monitor"
          ? { lastHeartbeatAt: sourceAt, critical: false }
          : null,
      reasons: [],
    }),
  );
  const result = await app().read(org, actor);
  expect(
    result.components.find((c) => c.id === "deadline_monitor")?.status,
  ).toBe("stale");
});
it("rechecks live source authority and denies revoked diagnostic access", async () => {
  readSource.mockResolvedValue({
    outcome: "forbidden",
    source: "licensing",
    sourceAt: null,
    observedAt: null,
    data: null,
    reasons: [],
  });
  await expect(app().read(org, actor)).rejects.toBeInstanceOf(
    SystemHealthAuthorizationError,
  );
});
it("isolates provider failures using safe reasons", async () => {
  readSource.mockRejectedValue(new Error("token private-host"));
  const result = await app().read(org, actor);
  expect(JSON.stringify(result)).not.toContain("private-host");
  expect(result.components.find((c) => c.id === "licensing")?.status).toBe(
    "unreachable",
  );
});
it.each([false, "reject"])(
  "isolates unavailable runtime probes %s",
  async (failure) => {
    const down = () =>
      failure === "reject"
        ? Promise.reject(new Error("private"))
        : Promise.resolve(false);
    const result = await new SystemHealthUseCases(
      { readSource },
      { database: down, audit: down, storage: down },
      null,
      () => new Date(now),
    ).read(org, actor);
    expect(result.components.find((c) => c.id === "database")?.status).toBe(
      "unreachable",
    );
    expect(result.storage.reachability).toBe(
      failure === "reject" ? "unknown" : "unreachable",
    );
  },
);
it("preserves granted source observations and explicit build provenance", async () => {
  const storage = {
    status: "degraded",
    customerBytes: 5,
    customerReservedBytes: 0,
    protectedBytes: 1,
    unit: "bytes",
    sourceAt,
    observedAt: now,
    reasons: ["storage_integrity_unknown"],
    reachability: "unknown",
    integrity: "unknown",
  };
  const licence = {
    state: "expired_read_only",
    expiresAt: sourceAt,
    graceEndsAt: sourceAt,
    managementUrl: "/organization?settings=licence",
    usageUrl: "/organization?settings=licence",
    sourceAt,
    observedAt: now,
  };
  const queue = {
    id: "exports",
    label: "Exports",
    availability: "ready",
    pending: 0,
    running: 0,
    retrying: 0,
    waitingForReview: 0,
    uncertainDelivery: 0,
    failedTerminal: 0,
    oldestPendingAt: null,
    countRelation: "exact",
    sourceAt,
    observedAt: now,
    status: "healthy",
    reasons: [],
    interpretation: "queue_observation",
  };
  readSource.mockImplementation((_o, _a, source) =>
    Promise.resolve({
      outcome: "ready",
      source,
      sourceAt,
      observedAt: now,
      data:
        source === "usage_metering"
          ? { storage }
          : source === "licensing"
            ? { licence }
            : source === "exports"
              ? { queue }
              : {},
      reasons: [],
    }),
  );
  const result = await new SystemHealthUseCases(
    { readSource },
    runtime,
    {
      version: "1.0",
      commit: "1234567",
      builtAt: sourceAt,
      sourceAt,
      observedAt: now,
    },
    () => new Date(now),
  ).read(org, actor);
  expect(result.licence.state).toBe("expired_read_only");
  expect(result.storage.customerBytes).toBe(5);
  expect(result.evidenceExportPreserved).toBe(true);
  expect(result.queues.find((q) => q.id === "exports")?.pending).toBe(0);
  expect(result.currentVersion.sourceAt).not.toBe(result.observedAt);
});
it("bounds the complete collection and shares at most four transports", async () => {
  let active = 0;
  let maximum = 0;
  let cancelled = 0;
  const hang = (signal: AbortSignal) =>
    new Promise<never>((_resolve, reject) => {
      active++;
      maximum = Math.max(maximum, active);
      signal.addEventListener(
        "abort",
        () => {
          active--;
          cancelled++;
          reject(new Error("aborted"));
        },
        { once: true },
      );
    });
  const sources = {
    readSource: (
      _org: string,
      _actor: string,
      _source: unknown,
      signal: AbortSignal,
    ) => hang(signal),
  };
  const result = await new SystemHealthUseCases(
    sources,
    { database: hang, audit: hang, storage: hang },
    null,
    () => new Date(now),
  ).read(org, actor);
  expect(maximum).toBe(4);
  expect(active).toBe(0);
  expect(cancelled).toBe(13);
  expect(result.queues.every((queue) => queue.pending === null)).toBe(true);
  expect(result.evidenceExportPreserved).toBe(true);
});
