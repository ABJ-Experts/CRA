import {
  customerSystemHealthResponseSchema,
  systemHealthVersionSchema,
} from "@repo/contracts/system/schemas";
import type {
  CustomerSystemHealthResponse,
  SystemHealthVersion,
  SystemHealthComponent,
} from "@repo/contracts/system/types";
import {
  HEALTH_SOURCES,
  type HealthSourceObservation,
  type ProbeResult,
} from "./health-source";
import {
  component,
  parseSourceData,
  sourceComponent,
  unavailableQueue,
} from "./health-projection";
const unknownVersion: SystemHealthVersion = {
  version: null,
  commit: null,
  builtAt: null,
  sourceAt: null,
  observedAt: null,
};
const unknownLicence: CustomerSystemHealthResponse["licence"] = {
  state: null,
  expiresAt: null,
  graceEndsAt: null,
  managementUrl: null,
  usageUrl: null,
  sourceAt: null,
  observedAt: null,
};
const unknownStorage: CustomerSystemHealthResponse["storage"] = {
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
};
const unknownBackup: CustomerSystemHealthResponse["backup"] = {
  lastExecutionAt: null,
  lastVerifiedRestoreAt: null,
  status: "unknown",
  sourceAt: null,
  observedAt: null,
  reasons: ["m15_05_not_available"],
};

/** Fixed source composition is diagnostic only; it creates no operational authority. */
export function assembleHealthSnapshot(
  orgId: string,
  observedAt: string,
  build: SystemHealthVersion | null,
  probes: readonly ProbeResult<HealthSourceObservation>[],
  runtime: readonly ProbeResult<boolean>[],
): CustomerSystemHealthResponse {
  const details = probes.map((result) =>
    result.outcome === "ready" ? parseSourceData(result.value) : null,
  );
  const currentVersion = systemHealthVersionSchema.parse(
    build ?? unknownVersion,
  );
  const reachable = runtime[2]?.outcome === "ready" ? runtime[2].value : null;
  const components = [
    ...runtimeComponents(runtime, observedAt),
    ...(
      [
        "deadline_monitor",
        "licensing",
        "usage_metering",
        "vulnerability_feeds",
      ] as const
    ).map((source, index) =>
      sourceComponent(source, probes[index]!, observedAt),
    ),
    versionComponent(currentVersion),
  ];
  return customerSystemHealthResponseSchema.parse({
    schemaVersion: 1,
    organizationId: orgId,
    observedAt,
    overallStatus: components.some((c) => c.status === "unreachable")
      ? "degraded"
      : components.every((c) => c.status === "healthy")
        ? "healthy"
        : "degraded",
    currentVersion,
    licence: details[1]?.licence ?? unknownLicence,
    components,
    queues: HEALTH_SOURCES.flatMap((source, index) =>
      source === "deadline_monitor" ||
      source === "licensing" ||
      source === "usage_metering"
        ? []
        : [details[index]?.queue ?? unavailableQueue(source, probes[index]!)],
    ),
    storage: {
      ...(details[2]?.storage ?? unknownStorage),
      reachability:
        reachable === true
          ? "healthy"
          : reachable === false
            ? "unreachable"
            : "unknown",
    },
    feedFreshness: details[3]?.feedFreshness ?? [],
    backup: unknownBackup,
    evidenceExportPreserved: true,
  });
}
function runtimeComponents(
  runtime: readonly ProbeResult<boolean>[],
  observedAt: string,
): SystemHealthComponent[] {
  const reachable = runtime[2]?.outcome === "ready" ? runtime[2].value : null;
  return [
    ...(["database", "audit"] as const).map((id, index) => {
      const healthy =
        runtime[index]?.outcome === "ready" && runtime[index].value;
      return component(
        id,
        id,
        id === "database" ? "supabase" : "audit",
        healthy ? "healthy" : "unreachable",
        healthy ? observedAt : null,
        observedAt,
        healthy
          ? []
          : [id === "database" ? "database_unavailable" : "audit_unavailable"],
      );
    }),
    component(
      "storage",
      "Storage",
      "storage",
      reachable ? "healthy" : reachable === false ? "unreachable" : "unknown",
      reachable ? observedAt : null,
      observedAt,
      reachable ? [] : ["storage_unreachable"],
    ),
    component("backups", "Backup assurance", "m15_05", "unknown", null, null, [
      "m15_05_not_available",
    ]),
  ];
}
function versionComponent(version: SystemHealthVersion): SystemHealthComponent {
  const known = version.version && version.sourceAt && version.observedAt;
  return component(
    "version",
    "Build version",
    "build",
    known ? "healthy" : "unknown",
    version.sourceAt,
    version.observedAt,
    known ? [] : ["version_unavailable"],
  );
}
