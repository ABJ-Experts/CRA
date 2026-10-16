import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { LicensingError } from "./licensing.errors";
import {
  licenseClaimsSchema,
  licenseActivationInputSchema,
  licenseActivationResponseSchema,
  licenseCurrentResponseSchema,
  licenseHistoryQuerySchema,
  licenseHistoryResponseSchema,
} from "@repo/contracts/licensing/schemas";
import type {
  LicenseActivationInput,
  LicenseCapability,
  LicenseCurrentResponse,
  LicenseHistoryQuery,
} from "@repo/contracts/licensing/types";
import {
  calculateTrustedTime,
  evaluateLicensePolicy,
} from "../domain/license-policy";
import { LicenseVerificationError } from "../domain/license-errors";
import type {
  ActivationReceipt,
  LicensingPort,
  LicenseVerifierPort,
} from "./licensing.port";
export interface LicenseOperation {
  kind:
    | "customer"
    | "evidence"
    | "security"
    | "protective"
    | "renewal"
    | "regulatory"
    | "mixed"
    | "source"
    | "admission-finalization";
  capability?: LicenseCapability;
  mutation?: boolean;
}
export interface LicensingConfiguration {
  instanceId?: string;
  configuration: Partial<Record<LicenseCapability, boolean>>;
  policyRevision?: number;
}
/** Orchestrates tenant authority, local verification and durable evidence; never grants user authority. */
export class LicensingService {
  private readonly startedWall: number;
  private readonly startedMonotonic: number;
  constructor(
    private readonly port: LicensingPort,
    private readonly verifier: () => Promise<LicenseVerifierPort>,
    private readonly config: LicensingConfiguration,
    private readonly now: () => Date = () => new Date(),
    private readonly monotonic: () => number = () => performance.now(),
  ) {
    this.startedWall = this.now().getTime();
    this.startedMonotonic = this.monotonic();
  }
  async getPolicy(orgId: string, actorId: string) {
    return (await this.getCurrent(orgId, actorId)).policy;
  }
  async getCurrent(
    orgId: string,
    actorId: string,
    signal?: AbortSignal,
  ): Promise<LicenseCurrentResponse> {
    signal?.throwIfAborted();
    const cancellation = signal ? ([signal] as const) : [];
    const instanceId = this.binding();
    const stored = actorId
      ? await this.port.getState(orgId, actorId, ...cancellation)
      : await this.port.getWorkerState(orgId, ...cancellation);
    signal?.throwIfAborted();
    const trusted = calculateTrustedTime({
      wallTimeMs: this.now().getTime(),
      persistedHighWaterMs: stored.state?.time_high_water_at
        ? Date.parse(stored.state.time_high_water_at)
        : 0,
      processStartedWallMs: this.startedWall,
      monotonicElapsedMs: Math.max(0, this.monotonic() - this.startedMonotonic),
    });
    const checkpoint = actorId
      ? await this.port.checkpoint(
          orgId,
          actorId,
          this.now().toISOString(),
          ...cancellation,
        )
      : await this.port.checkpointWorker(
          orgId,
          this.now().toISOString(),
          ...cancellation,
        );
    signal?.throwIfAborted();
    const now = new Date(
      Math.max(
        trusted.effectiveTimeMs,
        checkpoint.timeHighWaterAt ? Date.parse(checkpoint.timeHighWaterAt) : 0,
      ),
    );
    let verified: Awaited<ReturnType<LicenseVerifierPort["verify"]>> | null =
      null;
    let invalidReason: string | undefined;
    if (stored.state?.artifact) {
      try {
        verified = await (
          await this.verifier()
        ).verify(
          stored.state.artifact,
          { organizationId: orgId, instanceId },
          now,
          { activation: false },
        );
        if (
          verified.digest !== stored.state.artifact_digest ||
          JSON.stringify(licenseClaimsSchema.parse(verified.claims)) !==
            JSON.stringify(
              licenseClaimsSchema.parse(stored.state.verified_claims),
            )
        ) {
          verified = null;
          invalidReason = "stored_artifact_mismatch";
        }
      } catch (error) {
        invalidReason =
          error instanceof LicenseVerificationError
            ? error.reason
            : "trust_unavailable";
      }
    }
    signal?.throwIfAborted();
    const usage = {
      activeMembers:
        stored.usage.activeMembers + stored.usage.reservedInvitations,
      products: stored.usage.products,
      storageBytes: stored.usage.storageBytes,
      storageReservedBytes: stored.usage.storageReservedBytes,
      protectedStorageBytes: stored.usage.protectedStorageBytes,
      availability: stored.storageAccountingReady
        ? ("ready" as const)
        : ("unavailable" as const),
    };
    const current = licenseCurrentResponseSchema.parse({
      policy: evaluateLicensePolicy({
        claims: verified?.claims ?? null,
        now,
        clockTrusted: trusted.clockTrusted && !checkpoint.clockRollbackDetected,
        invalidReason,
        usage,
        configuration: this.config.configuration,
      }),
      version: stored.state?.version ?? 0,
      instanceId,
      claims: verified?.claims ?? null,
      keyId: verified?.keyId ?? null,
      digest: verified?.digest ?? null,
      usage,
      lastRejected: stored.lastRejected
        ? {
            ...stored.lastRejected,
            occurredAt: new Date(stored.lastRejected.occurredAt).toISOString(),
          }
        : null,
    });
    if (stored.state?.artifact_digest) {
      const configurationDigest = await this.configurationDigest();
      signal?.throwIfAborted();
      const proof = await this.port.publishVerification(
        orgId,
        actorId || null,
        {
          version: current.version,
          digest: stored.state.artifact_digest,
          verified:
            verified !== null &&
            trusted.clockTrusted &&
            !checkpoint.clockRollbackDetected,
          capabilities: current.policy.effectiveCapabilities,
          policyRevision: this.config.policyRevision ?? 1,
          configurationDigest,
          observedAt: this.now().toISOString(),
        },
        ...cancellation,
      );
      signal?.throwIfAborted();
      if (proof.outcome === "stale" || proof.outcome === "conflict")
        throw new LicensingError(
          "license_conflict",
          409,
          "Licence or trust policy changed; reload and try again",
        );
      if (proof.outcome === "forbidden")
        throw new LicensingError(
          "forbidden",
          403,
          "Licence access is not permitted",
        );
    }
    return current;
  }
  async getHistory(orgId: string, actorId: string, query: LicenseHistoryQuery) {
    return licenseHistoryResponseSchema.parse(
      await this.port.history(
        orgId,
        actorId,
        licenseHistoryQuerySchema.parse(query),
      ),
    );
  }
  async activate(orgId: string, actorId: string, raw: LicenseActivationInput) {
    const input = licenseActivationInputSchema.parse(raw);
    const digest = createHash("sha256").update(input.artifact).digest("hex");
    const requestDigest = createHash("sha256")
      .update(
        JSON.stringify({
          artifactDigest: digest,
          expectedVersion: input.expectedVersion,
        }),
      )
      .digest("hex");
    // A replay is an immutable activation receipt, not a fresh entitlement grant.
    // Recheck current actor authority in SQL before time/trust verification or archive writes.
    const receipt = await this.port.activationReceipt(orgId, actorId, {
      artifact: input.artifact,
      digest,
      idempotencyKey: input.idempotencyKey,
      requestDigest,
    });
    if (receipt.outcome !== "absent")
      return this.activationResponse(receipt, digest, null);
    const current = await this.getCurrent(orgId, actorId);
    let verified: Awaited<ReturnType<LicenseVerifierPort["verify"]>> | null =
      null;
    let rejectionReason: string | null = null;
    try {
      verified = await (
        await this.verifier()
      ).verify(
        input.artifact,
        { organizationId: orgId, instanceId: this.binding() },
        new Date(current.policy.evaluatedAt),
      );
    } catch (error) {
      rejectionReason =
        error instanceof LicenseVerificationError
          ? error.reason
          : "trust_unavailable";
    }
    if (current.policy.state === "clock_untrusted")
      rejectionReason = "clock_untrusted";
    const result = await this.port.activate(orgId, actorId, {
      artifact: input.artifact,
      digest,
      claims: rejectionReason ? null : verified!.claims,
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      requestDigest,
      rejectionReason,
    });
    return this.activationResponse(result, digest, rejectionReason);
  }
  private activationResponse(
    result: ActivationReceipt,
    digest: string,
    rejectionReason: string | null,
  ) {
    if (result.outcome === "forbidden")
      throw new LicensingError(
        "forbidden",
        403,
        "Licence management is not permitted",
      );
    if (result.outcome === "conflict")
      throw new LicensingError(
        "license_conflict",
        409,
        "Licence state changed; reload and try again",
      );
    if (
      result.outcome === "rejected" ||
      (result.outcome !== "replayed" && rejectionReason)
    )
      throw new LicensingError(
        "license_invalid_artifact",
        400,
        "Licence replacement was rejected",
        result.reason ?? rejectionReason ?? "invalid_artifact",
      );
    return licenseActivationResponseSchema.parse({
      version: result.version,
      digest,
      licenseId: result.licenseId,
      replayed: result.outcome === "replayed",
    });
  }
  async assertOperation(
    orgId: string,
    actorId: string,
    operation: LicenseOperation,
  ): Promise<void> {
    if (
      ["evidence", "security", "protective", "renewal"].includes(operation.kind)
    )
      return;
    const current = await this.getCurrent(orgId, actorId);
    if (
      ["invalid", "clock_untrusted", "missing"].includes(current.policy.state)
    )
      throw new LicensingError(
        "license_capability_disabled",
        403,
        "This capability is not enabled by the verified licence and deployment configuration",
      );
    if (operation.mutation === false && current.claims) return;
    if (operation.mutation && !current.policy.customerWritesAllowed)
      throw new LicensingError(
        "license_read_only",
        403,
        "Licence policy permits retained evidence access and renewal; customer writes are paused",
      );
    if (
      !operation.capability ||
      !current.policy.effectiveCapabilities.includes(operation.capability)
    )
      throw new LicensingError(
        "license_capability_disabled",
        403,
        "This capability is not enabled by the verified licence and deployment configuration",
      );
  }
  async getWorkerPolicy(orgId: string) {
    return (await this.getCurrent(orgId, "")).policy;
  }
  async prepareClaims(capability: LicenseCapability): Promise<void> {
    const organizations = await this.port.listWorkerCandidateOrganizations(
      capability,
      100,
      this.config.policyRevision ?? 1,
      await this.configurationDigest(),
    );
    for (const orgId of organizations) await this.canClaim(orgId, capability);
  }
  async canClaim(
    orgId: string,
    capability: LicenseCapability,
  ): Promise<boolean> {
    const current = await this.getCurrent(orgId, "");
    if (current.policy.reasons.includes("trust_unavailable"))
      throw new LicensingError(
        "unavailable",
        503,
        "Licence trust authority is unavailable",
      );
    return (
      current.policy.customerWritesAllowed &&
      current.policy.effectiveCapabilities.includes(capability)
    );
  }
  private async configurationDigest(): Promise<string> {
    const trustDigest = await this.verifier()
      .then((verifier) => verifier.trustDigest)
      .catch(() => "unavailable");
    return createHash("sha256")
      .update(
        JSON.stringify({
          trustDigest,
          configuration: Object.fromEntries(
            Object.entries(this.config.configuration).sort(([a], [b]) =>
              a < b ? -1 : a > b ? 1 : 0,
            ),
          ),
          instanceId: this.binding(),
        }),
      )
      .digest("hex");
  }
  private binding(): string {
    if (!this.config.instanceId)
      throw new LicensingError(
        "unavailable",
        503,
        "Licence instance identity is not provisioned",
      );
    return this.config.instanceId;
  }
}
