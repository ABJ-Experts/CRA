import {
  systemHealthComponentSchema,
  systemHealthQueueSchema,
  systemHealthStorageSchema,
  systemHealthFeedFreshnessSchema,
  systemHealthLicenceLinkSchema,
} from "@repo/contracts/system/schemas";
import type {
  SystemHealthComponent,
  SystemHealthQueue,
  SystemHealthStatus,
} from "@repo/contracts/system/types";
import { z } from "zod";
import type { HealthSource, HealthSourceObservation } from "./health-source";
import type { ProbeResult } from "./health-source";

const sourceNames = {
  deadline_monitor: ["Deadline monitor", "m6"],
  licensing: ["Licensing", "licensing"],
  usage_metering: ["Usage metering", "usage_metering"],
  vulnerability_feeds: ["Vulnerability feeds", "vulnerability_feeds"],
} as const;
export const sourceDataSchema = z
  .object({
    lastHeartbeatAt: z.iso.datetime().nullable().optional(),
    critical: z.boolean().optional(),
    queue: systemHealthQueueSchema.nullable().optional(),
    storage: systemHealthStorageSchema.nullable().optional(),
    licence: systemHealthLicenceLinkSchema.nullable().optional(),
    feedFreshness: z.array(systemHealthFeedFreshnessSchema).max(10).optional(),
  })
  .strict();
export type SourceData = z.output<typeof sourceDataSchema>;
export function parseSourceData(
  observation: HealthSourceObservation,
): SourceData | null {
  if (observation.outcome !== "ready") return null;
  const parsed = sourceDataSchema.safeParse(observation.data);
  return parsed.success ? parsed.data : null;
}
export function sourceComponent(
  source: keyof typeof sourceNames,
  result: ProbeResult<HealthSourceObservation>,
  now: string,
): SystemHealthComponent {
  const [label, authority] = sourceNames[source];
  if (result.outcome !== "ready")
    return component(source, label, authority, "unreachable", null, null, [
      result.reason === "probe_timeout"
        ? "source_timeout"
        : "source_unavailable",
    ]);
  const value = result.value;
  const data = parseSourceData(value);
  if (!data)
    return component(
      source,
      label,
      authority,
      "unknown",
      null,
      value.observedAt,
      [
        value.outcome === "withheld"
          ? (value.reasons[0] ?? "source_permission_withheld")
          : "source_unavailable",
      ],
    );
  if (source === "deadline_monitor") {
    if (!data.lastHeartbeatAt || typeof data.critical !== "boolean")
      return component(
        source,
        label,
        authority,
        "unknown",
        null,
        value.observedAt,
        ["worker_heartbeat_unavailable"],
      );
    const stale = Date.parse(now) - Date.parse(data.lastHeartbeatAt) > 120_000;
    return component(
      source,
      label,
      authority,
      data.critical ? "degraded" : stale ? "stale" : "healthy",
      data.lastHeartbeatAt,
      value.observedAt,
      data.critical
        ? ["source_unavailable"]
        : stale
          ? ["worker_heartbeat_stale"]
          : [],
    );
  }
  const valid =
    source === "licensing"
      ? !!data.licence?.state
      : source === "usage_metering"
        ? !!data.storage
        : !!data.feedFreshness?.length;
  if (!valid || !value.sourceAt)
    return component(
      source,
      label,
      authority,
      "unknown",
      null,
      value.observedAt,
      ["no_successful_observation"],
    );
  const diagnostic = sourceDiagnostic(source, data);
  return component(
    source,
    label,
    authority,
    diagnostic.status,
    value.sourceAt,
    value.observedAt,
    diagnostic.reasons,
  );
}
function sourceDiagnostic(
  source: keyof typeof sourceNames,
  data: SourceData,
): { status: SystemHealthStatus; reasons: SystemHealthComponent["reasons"] } {
  if (source === "usage_metering")
    return {
      status: data.storage!.status,
      reasons: data.storage!.status === "healthy" ? [] : data.storage!.reasons,
    };
  if (source === "vulnerability_feeds") {
    const attention = data.feedFreshness!.find(
      (feed) => feed.status !== "healthy",
    );
    return {
      status: attention?.status ?? "healthy",
      reasons: attention?.reasons ?? [],
    };
  }
  switch (data.licence!.state) {
    case "active":
      return { status: "healthy", reasons: [] };
    case "grace":
      return { status: "degraded", reasons: ["licence_grace"] };
    case "expired_read_only":
      return { status: "degraded", reasons: ["licence_expired"] };
    case "clock_untrusted":
      return { status: "degraded", reasons: ["clock_untrusted"] };
    case "invalid":
      return { status: "degraded", reasons: ["licence_invalid"] };
    default:
      return { status: "unknown", reasons: ["licence_unavailable"] };
  }
}
export function component(
  id: SystemHealthComponent["id"],
  label: string,
  source: SystemHealthComponent["source"],
  status: SystemHealthStatus,
  sourceAt: string | null,
  observedAt: string | null,
  reasons: SystemHealthComponent["reasons"],
): SystemHealthComponent {
  return systemHealthComponentSchema.parse({
    id,
    label,
    source,
    status,
    sourceAt,
    observedAt,
    reasons,
    summary:
      status === "healthy"
        ? "Observation available"
        : "Observation needs attention",
  });
}
export function unavailableQueue(
  source: Exclude<
    HealthSource,
    "deadline_monitor" | "licensing" | "usage_metering"
  >,
  result: ProbeResult<HealthSourceObservation>,
): SystemHealthQueue {
  const withheld =
    result.outcome === "ready" && result.value.outcome === "withheld";
  return systemHealthQueueSchema.parse({
    id: source,
    label: source.replaceAll("_", " "),
    availability: withheld ? "withheld" : "unavailable",
    pending: null,
    running: null,
    retrying: null,
    waitingForReview: null,
    uncertainDelivery: null,
    failedTerminal: null,
    oldestPendingAt: null,
    countRelation: null,
    sourceAt: null,
    observedAt: result.outcome === "ready" ? result.value.observedAt : null,
    status: result.outcome === "ready" ? "unknown" : "unreachable",
    reasons: [withheld ? "source_permission_withheld" : "source_unavailable"],
    interpretation: "queue_observation",
  });
}
