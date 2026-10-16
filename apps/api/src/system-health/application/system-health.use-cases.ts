import type {
  CustomerSystemHealthResponse,
  SystemHealthVersion,
} from "@repo/contracts/system/types";
import { assembleHealthSnapshot } from "../domain/health-snapshot";
import { collectBounded, type ProbeResult } from "./bounded-probe";
import {
  HEALTH_SOURCES,
  SystemHealthAuthorizationError,
  type HealthSourceObservation,
  type SystemHealthSourcePort,
  type SystemHealthRuntimePort,
} from "./system-health.port";

/** Diagnostic collection never participates in licence decisions or export admission. */
export class SystemHealthUseCases {
  constructor(
    private readonly sources: SystemHealthSourcePort,
    private readonly runtime: SystemHealthRuntimePort,
    private readonly build: SystemHealthVersion | null,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async read(
    orgId: string,
    actorId: string,
  ): Promise<CustomerSystemHealthResponse> {
    const observedAt = this.now().toISOString();
    const collected = await collectBounded<HealthSourceObservation | boolean>([
      ...HEALTH_SOURCES.map(
        (source) => (signal: AbortSignal) =>
          this.sources.readSource(orgId, actorId, source, signal),
      ),
      (signal) => this.runtime.database(signal),
      (signal) => this.runtime.audit(signal),
      (signal) => this.runtime.storage(signal),
    ]);
    // Fixed source ordering is owned here; every external observation is parsed by its adapter.
    const probes = collected.slice(
      0,
      HEALTH_SOURCES.length,
    ) as readonly ProbeResult<HealthSourceObservation>[];
    const runtime = collected.slice(
      HEALTH_SOURCES.length,
    ) as readonly ProbeResult<boolean>[];
    if (
      probes.some(
        (result) =>
          result.outcome === "ready" && result.value.outcome === "forbidden",
      )
    )
      throw new SystemHealthAuthorizationError();

    return assembleHealthSnapshot(
      orgId,
      observedAt,
      this.build,
      probes,
      runtime,
    );
  }
}
