import { z } from "zod";
import { licenseClaimsSchema } from "@repo/contracts/licensing/schemas";
import type {
  LicenseHistoryQuery,
  LicenseHistoryResponse,
} from "@repo/contracts/licensing/types";

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const licenseStoredStateSchema = z
  .object({
    state: z
      .object({
        organization_id: z.uuid(),
        artifact: z.string().max(32768).nullable(),
        artifact_digest: z.string().nullable(),
        artifact_object_path: z.string().nullable().optional(),
        verified_claims: licenseClaimsSchema.nullable(),
        issuance_sequence: integer,
        version: integer,
        time_high_water_at: z.string().nullable(),
        clock_rollback_detected: z.boolean().optional(),
        protected_regulatory_cutoff: z.string().nullable(),
      })
      .passthrough()
      .nullable(),
    usage: z.object({
      activeMembers: integer,
      reservedInvitations: integer,
      products: integer,
      storageBytes: integer,
      storageReservedBytes: integer.default(0),
      protectedStorageBytes: integer.default(0),
    }),
    storageAccountingReady: z.boolean(),
    lastRejected: z
      .object({ reason: z.string(), occurredAt: z.string() })
      .nullable()
      .optional(),
  })
  .strict();
export type LicenseStoredState = z.output<typeof licenseStoredStateSchema>;
export interface ActivationCommand {
  artifact: string;
  digest: string;
  claims: z.output<typeof licenseClaimsSchema> | null;
  expectedVersion: number;
  idempotencyKey: string;
  requestDigest: string;
  rejectionReason: string | null;
}
export interface ActivationReceipt {
  outcome: "activated" | "replayed" | "rejected" | "conflict" | "forbidden";
  version: number;
  auditId?: string;
  licenseId?: string;
  reason?: string;
}
export interface ActivationReceiptLookup {
  artifact: string;
  digest: string;
  idempotencyKey: string;
  requestDigest: string;
}
export interface LicensingPort {
  activationReceipt(
    orgId: string,
    actorId: string,
    request: ActivationReceiptLookup,
  ): Promise<ActivationReceipt | { outcome: "absent" }>;
  listWorkerCandidateOrganizations(
    capability: string,
    limit: number,
    policyRevision: number,
    configurationDigest: string,
  ): Promise<string[]>;
  publishVerification(
    orgId: string,
    actorId: string | null,
    proof: {
      version: number;
      digest: string;
      verified: boolean;
      capabilities: string[];
      policyRevision: number;
      configurationDigest: string;
      observedAt: string;
    },
    signal?: AbortSignal,
  ): Promise<{ outcome: "updated" | "stale" | "conflict" | "forbidden" }>;
  getWorkerState(
    orgId: string,
    signal?: AbortSignal,
  ): Promise<LicenseStoredState>;
  checkpointWorker(
    orgId: string,
    observedAt: string,
    signal?: AbortSignal,
  ): Promise<{
    timeHighWaterAt: string | null;
    clockRollbackDetected: boolean;
  }>;
  getState(
    orgId: string,
    actorId: string,
    signal?: AbortSignal,
  ): Promise<LicenseStoredState>;
  activate(
    orgId: string,
    actorId: string,
    command: ActivationCommand,
  ): Promise<ActivationReceipt>;
  history(
    orgId: string,
    actorId: string,
    query: LicenseHistoryQuery,
  ): Promise<LicenseHistoryResponse>;
  archive(orgId: string, digest: string, artifact: string): Promise<string>;
  checkpoint(
    orgId: string,
    actorId: string,
    observedAt: string,
    signal?: AbortSignal,
  ): Promise<{
    timeHighWaterAt: string | null;
    clockRollbackDetected: boolean;
  }>;
}

export interface LicenseVerifierPort {
  readonly trustDigest: string;
  verify(
    artifact: string,
    binding: { organizationId: string; instanceId: string },
    now: Date,
    options?: { activation?: boolean },
  ): Promise<{
    claims: z.output<typeof licenseClaimsSchema>;
    digest: string;
    keyId: string;
  }>;
}

/** Bounded keyset enumeration is maintenance authority; no customer grant is implied. */
export interface LicensePolicySynchronizationPort {
  listPolicyTenants(
    limit: number,
    after: string | null,
  ): Promise<{
    organizationIds: string[];
    nextCursor: string | null;
  }>;
}
