import { Injectable, ForbiddenException } from "@nestjs/common";
import { z } from "zod";
import { systemHealthReasonSchema } from "@repo/contracts/system/schemas";
import { LicensingError } from "../../licensing/application/licensing.errors";
import { LicensingService } from "../../licensing/application/licensing.service";
import { SupabaseService } from "../../supabase/supabase.service";
import {
  HEALTH_SOURCES,
  type HealthSource,
  type HealthSourceObservation,
  type SystemHealthSourcePort,
} from "../application/system-health.port";
const observationSchema = z.strictObject({
  outcome: z.enum(["ready", "withheld", "forbidden"]),
  source: z.enum(HEALTH_SOURCES),
  sourceAt: z.iso.datetime().nullable(),
  observedAt: z.iso.datetime().nullable(),
  data: z.unknown(),
  reasons: z.array(systemHealthReasonSchema).max(30),
});
@Injectable()
export class SupabaseHealthSourceAdapter implements SystemHealthSourcePort {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly licensing: LicensingService,
  ) {}
  async readSource(
    orgId: string,
    actorId: string,
    source: HealthSource,
    signal: AbortSignal,
  ): Promise<HealthSourceObservation> {
    try {
      return await this.observe(orgId, actorId, source, signal);
    } catch (error) {
      if (authorizationRejected(error)) return forbiddenObservation(source);
      throw error;
    }
  }
  private async observe(
    orgId: string,
    actorId: string,
    source: HealthSource,
    signal: AbortSignal,
  ): Promise<HealthSourceObservation> {
    const result = await this.supabase
      .admin()
      .rpc("m15_03_read_health_source", {
        p_organization_id: orgId,
        p_actor_user_id: actorId,
        p_source: source,
      })
      .abortSignal(signal);
    if (result.error && authorizationRejected(result.error))
      return forbiddenObservation(source);
    const parsed = observationSchema.safeParse(result.data);
    if (result.error || !parsed.success || parsed.data.source !== source)
      throw new Error("Source observation unavailable");
    if (source === "licensing" && parsed.data.outcome === "ready") {
      signal.throwIfAborted();
      const current = await this.licensing.getCurrent(orgId, actorId, signal);
      signal.throwIfAborted();
      return {
        ...parsed.data,
        sourceAt: current.policy.evaluatedAt,
        observedAt: new Date().toISOString(),
        data: {
          licence: {
            state: current.policy.state,
            expiresAt: current.policy.expiresAt,
            graceEndsAt: current.policy.graceEndsAt,
            managementUrl: "/organization?settings=licence",
            usageUrl: "/organization?settings=licence",
            sourceAt: current.policy.evaluatedAt,
            observedAt: new Date().toISOString(),
          },
        },
      };
    }
    return parsed.data;
  }
}

/** Only incumbent authorization failures cross the diagnostic port as denial. */
function authorizationRejected(error: unknown): boolean {
  return (
    error instanceof ForbiddenException ||
    (error instanceof LicensingError &&
      error.code === "forbidden" &&
      error.status === 403) ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "42501")
  );
}
function forbiddenObservation(source: HealthSource): HealthSourceObservation {
  return observationSchema.parse({
    outcome: "forbidden",
    source,
    sourceAt: null,
    observedAt: null,
    data: null,
    reasons: ["source_permission_withheld"],
  });
}
