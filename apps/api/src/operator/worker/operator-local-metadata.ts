import {
  operatorInstanceMetadataResponseSchema,
  operatorTenantSummarySchema,
  systemHealthVersionSchema,
} from "@repo/contracts";
import type {
  OperatorInstanceMetadataResponse,
  OperatorTenantSummary,
  LicenseCurrentResponse,
} from "@repo/contracts";
import type { z } from "zod";
const buildSchema = systemHealthVersionSchema
  .pick({ version: true, commit: true, builtAt: true })
  .strict();
export type OperatorBuildMetadata = z.output<typeof buildSchema>;
export interface LocalLicenseObservationPort {
  getCurrent(
    orgId: string,
    actorId: string,
    signal?: AbortSignal,
  ): Promise<LicenseCurrentResponse>;
}
/** Worker-only composition of measured metadata; none of these observations grant authority. */
export class OperatorLocalMetadataEnricher {
  constructor(
    private readonly licensing: LocalLicenseObservationPort | null,
    private readonly build: OperatorBuildMetadata | null,
    private readonly expectedVersion: string | null,
  ) {}
  async enrich(
    metadata: OperatorInstanceMetadataResponse,
    signal: AbortSignal,
  ): Promise<OperatorInstanceMetadataResponse> {
    const tenants: OperatorTenantSummary[] = [];
    for (let offset = 0; offset < metadata.tenants.length; offset += 4)
      tenants.push(
        ...(await Promise.all(
          metadata.tenants
            .slice(offset, offset + 4)
            .map((tenant) => this.licence(metadata.instanceId, tenant, signal)),
        )),
      );
    const build = this.build ? buildSchema.parse(this.build) : null;
    const known =
      build?.version !== null &&
      build?.version !== undefined &&
      build.builtAt !== null;
    const versionDrift =
      known && this.expectedVersion
        ? build.version === this.expectedVersion
          ? "matched"
          : "different"
        : "unknown";
    const version = known
      ? {
          ...metadata.instance,
          version: build.version,
          commit: build.commit,
          versionSourceAt: build.builtAt,
          expectedVersion: this.expectedVersion,
          versionDrift,
          sources: [
            ...metadata.instance.sources.filter(
              (item) => item.source !== "version",
            ),
            {
              source: "version",
              status: versionDrift === "different" ? "degraded" : "healthy",
              sourceAt: build.builtAt,
              observedAt: metadata.observedAt,
              attemptedAt: metadata.observedAt,
              succeededAt: metadata.observedAt,
              receivedAt: metadata.observedAt,
              reasons: versionDrift === "different" ? ["version_drift"] : [],
            },
          ],
        }
      : metadata.instance;
    return operatorInstanceMetadataResponseSchema.parse({
      ...metadata,
      instance: version,
      tenants,
    });
  }
  private async licence(
    instanceId: string,
    tenant: OperatorTenantSummary,
    signal: AbortSignal,
  ): Promise<OperatorTenantSummary> {
    if (!this.licensing) return tenant;
    try {
      signal.throwIfAborted();
      const current = await this.licensing.getCurrent(
        tenant.tenantId,
        "",
        AbortSignal.any([signal, AbortSignal.timeout(250)]),
      );
      if (
        current.instanceId !== instanceId ||
        current.policy.reasons.includes("trust_unavailable")
      )
        throw new Error("Licence source unavailable");
      const state = current.policy.state;
      const status =
        state === "active"
          ? "healthy"
          : state === "missing"
            ? "unknown"
            : "degraded";
      const reasons =
        state === "active"
          ? []
          : state === "grace"
            ? ["licence_grace"]
            : state === "expired_read_only"
              ? ["licence_expired"]
              : state === "invalid"
                ? ["licence_invalid"]
                : state === "clock_untrusted"
                  ? ["clock_untrusted"]
                  : ["licence_unavailable"];
      const stamp = current.policy.evaluatedAt;
      return operatorTenantSummarySchema.parse({
        ...tenant,
        licenceState: state,
        licenceExpiresAt: current.policy.expiresAt,
        graceEndsAt: current.policy.graceEndsAt,
        licenceSourceAt: stamp,
        sources: [
          ...tenant.sources.filter((item) => item.source !== "licensing"),
          {
            source: "licensing",
            status,
            sourceAt: stamp,
            observedAt: stamp,
            attemptedAt: stamp,
            succeededAt: stamp,
            receivedAt: stamp,
            reasons,
          },
        ],
      });
    } catch {
      return {
        ...tenant,
        licenceState: null,
        licenceExpiresAt: null,
        graceEndsAt: null,
        licenceSourceAt: null,
        sources: [
          ...tenant.sources.filter((item) => item.source !== "licensing"),
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
        ],
      };
    }
  }
}
