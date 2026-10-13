import { createHash } from "node:crypto";
import {
  licenseUsageExportResponseSchema,
  licenseUsageOperationInputSchema,
  licenseUsageReconciliationResponseSchema,
  licenseUsageSnapshotSchema,
} from "@repo/contracts/licensing/schemas";
import type {
  LicenseCurrentResponse,
  LicenseUsageExportResponse,
  LicenseUsageReconciliationResponse,
  LicenseUsageOperationInput,
  LicenseUsageSnapshot,
} from "@repo/contracts/licensing/types";
import { evaluateLicensePolicy } from "../domain/license-policy";
import { buildLicenseUsageCounters } from "../domain/usage-diagnostics";
import { usageFailure } from "./license-usage.errors";
import type {
  LicenseUsageContext,
  LicenseUsagePort,
  UsageCommand,
  UsageOperation,
} from "./license-usage.port";

export const LICENSING_USAGE_APPLICATION = Symbol(
  "LICENSING_USAGE_APPLICATION",
);
export interface LicensingUsageApplication {
  getUsage(orgId: string, actorId: string): Promise<LicenseUsageSnapshot>;
  exportUsage(
    orgId: string,
    actorId: string,
    input: LicenseUsageOperationInput,
  ): Promise<LicenseUsageExportResponse>;
  reconcileUsage(
    orgId: string,
    actorId: string,
    input: LicenseUsageOperationInput,
  ): Promise<LicenseUsageReconciliationResponse>;
}
/** Coordinates locally verified limits and transactionally versioned aggregate facts. */
export class LicenseUsageService implements LicensingUsageApplication {
  constructor(
    private readonly port: LicenseUsagePort,
    private readonly context: LicenseUsageContext,
  ) {}
  async getUsage(
    orgId: string,
    actorId: string,
  ): Promise<LicenseUsageSnapshot> {
    const current = this.context.instanceConfigured
      ? await this.context.getCurrent(orgId, actorId)
      : null;
    const projection = await this.port.read(
      orgId,
      actorId,
      current?.version ?? null,
    );
    if (!("organizationId" in projection))
      throw usageFailure(projection.outcome);
    if (
      projection.organizationId !== orgId ||
      (current && projection.licenseVersion !== current.version) ||
      (current?.claims &&
        projection.issuanceSequence !== current.claims.sequence)
    )
      throw usageFailure("conflict");
    const { observedAt, policy, verified } = usagePolicyView(
      current,
      projection.observedAt,
    );
    if (verified && projection.policyRevision !== this.context.policyRevision)
      throw usageFailure("conflict");
    return licenseUsageSnapshotSchema.parse({
      schemaVersion: 1,
      definitionVersion: "m15_02_v1",
      organizationId: orgId,
      observedAt,
      meterVersion: projection.meterVersion,
      reconciledAt: projection.reconciledAt,
      license: {
        version: projection.licenseVersion,
        issuanceSequence: verified
          ? current!.claims!.sequence
          : projection.issuanceSequence,
        policyRevision: verified
          ? this.context.policyRevision
          : (projection.policyRevision ?? 0),
        state: policy?.state ?? null,
        verified,
        reasons: policy?.reasons ?? ["instance_not_configured"],
        startsAt: current?.claims?.startsAt ?? null,
        expiresAt: policy?.expiresAt ?? null,
        graceEndsAt: policy?.graceEndsAt ?? null,
        effectiveCapabilities: verified ? policy!.effectiveCapabilities : [],
      },
      counters: buildLicenseUsageCounters({
        components: projection.components,
        availability: projection.availability,
        reasons: projection.reasons,
        limits: current?.claims?.limits ?? null,
        verified,
      }),
    });
  }
  async exportUsage(
    orgId: string,
    actorId: string,
    raw: LicenseUsageOperationInput,
  ) {
    const command = this.command("export", raw);
    const lookup = await this.port.receipt(orgId, actorId, "export", command);
    if (lookup.outcome === "replayed") {
      if (!("snapshot" in lookup.receipt)) throw usageFailure("conflict");
      assertExportSnapshot(orgId, command, lookup.receipt.snapshot);
      const receipt = publicReceipt(lookup.receipt);
      return licenseUsageExportResponseSchema.parse({
        ...receipt,
        replayed: true,
      });
    }
    if (lookup.outcome !== "absent") throw usageFailure(lookup.outcome);
    const snapshot = await this.getUsage(orgId, actorId);
    if (
      snapshot.license.version !== command.expectedLicenseVersion ||
      snapshot.meterVersion !== command.expectedMeterVersion
    )
      throw usageFailure("conflict");
    const result = await this.port.export(orgId, actorId, command, snapshot);
    if (
      result.outcome === "forbidden" ||
      result.outcome === "conflict" ||
      result.outcome === "busy"
    )
      throw usageFailure(result.outcome);
    if (!("snapshot" in result)) throw usageFailure("conflict");
    assertExportSnapshot(orgId, command, result.snapshot);
    const receipt = publicReceipt(result);
    return licenseUsageExportResponseSchema.parse(receipt);
  }
  async reconcileUsage(
    orgId: string,
    actorId: string,
    raw: LicenseUsageOperationInput,
  ) {
    const command = this.command("reconcile", raw);
    const lookup = await this.port.receipt(
      orgId,
      actorId,
      "reconcile",
      command,
    );
    if (lookup.outcome === "replayed") {
      const receipt = publicReceipt(lookup.receipt);
      return licenseUsageReconciliationResponseSchema.parse({
        ...receipt,
        replayed: true,
      });
    }
    if (lookup.outcome !== "absent") throw usageFailure(lookup.outcome);
    const result = await this.port.reconcile(orgId, actorId, command);
    if (
      result.outcome === "forbidden" ||
      result.outcome === "conflict" ||
      result.outcome === "busy"
    )
      throw usageFailure(result.outcome);
    const receipt = publicReceipt(result);
    return licenseUsageReconciliationResponseSchema.parse(receipt);
  }
  private command(
    operation: UsageOperation,
    raw: LicenseUsageOperationInput,
  ): UsageCommand {
    const input = licenseUsageOperationInputSchema.parse(raw);
    const requestDigest = createHash("sha256")
      .update(
        JSON.stringify({
          operation,
          expectedLicenseVersion: input.expectedLicenseVersion,
          expectedMeterVersion: input.expectedMeterVersion,
        }),
      )
      .digest("hex");
    return { ...input, requestDigest };
  }
}

/** Database outcomes are transport discriminators, never part of public receipts. */
function publicReceipt(value: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "outcome"),
  );
}

/** The snapshot uses one trusted view time for current gauges; it creates no calendar window. */
function usagePolicyView(
  current: LicenseCurrentResponse | null,
  sourceObservedAt: string,
) {
  if (
    !current?.claims ||
    ["invalid", "clock_untrusted", "missing"].includes(current.policy.state)
  ) {
    return {
      observedAt: sourceObservedAt,
      policy: current?.policy ?? null,
      verified: false,
    };
  }
  const observedAt = new Date(
    Math.max(
      Date.parse(sourceObservedAt),
      Date.parse(current.policy.evaluatedAt),
    ),
  ).toISOString();
  const policy = evaluateLicensePolicy({
    claims: current.claims,
    now: new Date(observedAt),
    configuration: Object.fromEntries(
      current.policy.disabledCapabilities.map((capability) => [
        capability,
        false,
      ]),
    ),
  });
  return {
    observedAt,
    policy,
    verified: !["invalid", "clock_untrusted", "missing"].includes(policy.state),
  };
}

function assertExportSnapshot(
  orgId: string,
  command: UsageCommand,
  snapshot: LicenseUsageSnapshot,
): void {
  if (
    snapshot.organizationId !== orgId ||
    snapshot.license.version !== command.expectedLicenseVersion ||
    snapshot.meterVersion !== command.expectedMeterVersion
  )
    throw usageFailure("conflict");
}
