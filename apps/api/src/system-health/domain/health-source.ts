import type { SystemHealthComponent } from "@repo/contracts/system/types";

export const HEALTH_SOURCES = [
  "deadline_monitor",
  "licensing",
  "usage_metering",
  "vulnerability_feeds",
  "exports",
  "reports",
  "evidence_processing",
  "notifications",
  "connectors",
  "sboms",
] as const;
export type HealthSource = (typeof HEALTH_SOURCES)[number];
export interface HealthSourceObservation {
  outcome: "ready" | "withheld" | "forbidden";
  source: HealthSource;
  sourceAt: string | null;
  observedAt: string | null;
  data: unknown;
  reasons: SystemHealthComponent["reasons"];
}

export type ProbeResult<T> =
  | { outcome: "ready"; value: T }
  | { outcome: "unreachable"; reason: "probe_timeout" | "source_unavailable" };
