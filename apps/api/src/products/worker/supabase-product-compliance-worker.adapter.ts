import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import {
  securityUpdateArtifactResponseSchema,
  type SecurityUpdateArtifact,
} from "@repo/contracts/products";

import { SupabaseService } from "../../supabase/supabase.service";
import { type ProductComplianceInspection } from "../application/product-compliance-use-cases";
import { NodeProductComplianceExternalReferenceValidator } from "../infrastructure/node-product-compliance-external-reference-validator";
import { SupabaseProductComplianceStorageAdapter } from "../infrastructure/supabase-product-compliance-storage.adapter";
import {
  ProductComplianceWorkerFailure,
  type ProductComplianceOutboxEvent,
  type ProductComplianceWorkerDependencies,
} from "./product-compliance-worker";

type ProviderRow = Readonly<Record<string, unknown>>;
type ProviderResult = Readonly<{ data: unknown; error: unknown }>;
type RpcClient = Readonly<{
  rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<ProviderResult>;
}>;

const workTypes = [
  "security_update_artifact.inspect",
  "security_update_artifact.availability_recalculate",
  "security_update_artifact.cleanup",
  "security_update_artifact.external_reference_monitor",
] as const;

type WorkType = (typeof workTypes)[number];

/**
 * Service-role adapter for the focused product-compliance outbox. Claims and
 * completions are organization-first and the artifact JSON is parsed before
 * being passed to the worker. No payload, signed URL, or bytes are logged.
 */
@Injectable()
export class SupabaseProductComplianceWorkerAdapter {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly storage: SupabaseProductComplianceStorageAdapter,
    private readonly externalReferences: NodeProductComplianceExternalReferenceValidator,
  ) {}

  readonly queue: ProductComplianceWorkerDependencies["queue"] = Object.freeze({
    dueOrganizationIds: async () => {
      const rows = await this.rows(
        "list_due_product_security_update_artifact_organizations",
        {},
      );
      return Object.freeze(
        rows.flatMap((row) =>
          typeof row.organization_id === "string" ? [row.organization_id] : [],
        ),
      );
    },
    claim: async ({ organizationId, workerId, leaseSeconds }) => {
      for (const eventType of workTypes) {
        const row = await this.one(
          "claim_product_security_update_artifact_work_atomic",
          {
            p_organization_id: organizationId,
            p_event_type: eventType,
            p_lease_owner: workerId,
            p_lease_seconds: leaseSeconds,
          },
        );
        const outcome = this.outcome(
          row,
          new Set([
            "claimed",
            "none_available",
            "conflict",
            "not_found",
            "invalid_state",
          ]),
        );
        if (outcome !== "claimed") continue;
        const event = this.eventFor(eventType, row.artifact);
        if (
          typeof row.delivery_id !== "string" ||
          typeof row.lease_owner !== "string" ||
          !Number.isInteger(row.checkpoint_version)
        ) {
          throw new ProductComplianceWorkerFailure("malformed_provider", false);
        }
        return Object.freeze({
          outcome: "claimed" as const,
          deliveryId: row.delivery_id,
          leaseOwner: row.lease_owner,
          checkpointVersion: row.checkpoint_version as number,
          event,
        });
      }
      return Object.freeze({ outcome: "none_available" as const });
    },
    complete: async ({
      organizationId,
      deliveryId,
      leaseOwner,
      checkpointVersion,
    }) => {
      const row = await this.one(
        "complete_product_security_update_artifact_work_atomic",
        {
          p_organization_id: organizationId,
          p_delivery_id: deliveryId,
          p_lease_owner: leaseOwner,
          p_expected_checkpoint_version: checkpointVersion,
        },
      );
      return Object.freeze({
        outcome: this.outcome(
          row,
          new Set<"completed" | "conflict" | "not_found">([
            "completed",
            "conflict",
            "not_found",
          ]),
        ),
      });
    },
    fail: async ({
      organizationId,
      deliveryId,
      leaseOwner,
      checkpointVersion,
      code,
      retryable,
    }) => {
      const row = await this.one(
        "fail_product_security_update_artifact_work_atomic",
        {
          p_organization_id: organizationId,
          p_delivery_id: deliveryId,
          p_lease_owner: leaseOwner,
          p_expected_checkpoint_version: checkpointVersion,
          p_code: safeCode(code),
          p_retryable: retryable,
        },
      );
      return Object.freeze({
        outcome: this.outcome(
          row,
          new Set<"failed" | "conflict" | "not_found">([
            "failed",
            "conflict",
            "not_found",
          ]),
        ),
      });
    },
  });

  readonly processor: ProductComplianceWorkerDependencies["processor"] =
    Object.freeze({
      recalculate: async ({ organizationId, productId, artifactId }) => {
        const row = await this.one(
          "recalc_security_update_artifact_availability_worker_atomic",
          {
            p_organization_id: organizationId,
            p_product_id: productId,
            p_artifact_id: artifactId,
            p_correlation_id: randomUUID(),
          },
        );
        const outcome = this.outcome(
          row,
          new Set([
            "recalculated",
            "blocked",
            "conflict",
            "not_found",
            "retryable_unavailable",
          ]),
        );
        this.throwIfWorkerActorUnavailable(outcome);
        return Object.freeze({
          outcome:
            outcome === "not_found"
              ? ("not_found" as const)
              : outcome === "conflict"
                ? ("conflict" as const)
                : ("recalculated" as const),
        });
      },
      inspect: async ({
        organizationId,
        productId,
        artifactId,
        expectedVersion,
        sha256,
        byteSize,
        contentType,
        objectKey,
        distributionKind,
        externalReferenceCandidates,
      }) => {
        if (
          distributionKind !== "external_reference" &&
          typeof objectKey !== "string"
        ) {
          throw new ProductComplianceWorkerFailure("malformed_provider", false);
        }
        const inspection =
          distributionKind === "external_reference"
            ? externalInspection(
                await this.externalReferences.monitor({
                  candidates: externalReferenceCandidates ?? [],
                  sha256,
                  byteSize,
                  contentType,
                }),
                sha256,
                byteSize,
                contentType,
              )
            : await this.storage.inspect({
                objectKey: objectKey ?? `${organizationId}/${sha256}`,
                sha256,
                byteSize,
                contentType,
              });
        const row = await this.one(
          "finalize_product_security_update_artifact_worker_atomic",
          {
            p_organization_id: organizationId,
            p_product_id: productId,
            p_artifact_id: artifactId,
            p_expected_version: expectedVersion,
            ...inspectionArguments(inspection),
            p_correlation_id: randomUUID(),
          },
        );
        const outcome = this.outcome(
          row,
          new Set([
            "finalized",
            "replayed",
            "conflict",
            "not_found",
            "retryable_unavailable",
          ]),
        );
        this.throwIfWorkerActorUnavailable(outcome);
        return Object.freeze({
          outcome:
            outcome === "finalized" || outcome === "replayed"
              ? ("inspected" as const)
              : outcome === "not_found"
                ? ("not_found" as const)
                : ("conflict" as const),
        });
      },
      cleanup: async ({ organizationId, productId, artifactId }) => {
        const row = await this.one(
          "schedule_security_update_artifact_cleanup_worker_atomic",
          {
            p_organization_id: organizationId,
            p_product_id: productId,
            p_artifact_id: artifactId,
            p_correlation_id: randomUUID(),
          },
        );
        const outcome = this.outcome(
          row,
          new Set([
            "scheduled",
            "blocked",
            "conflict",
            "not_found",
            "retryable_unavailable",
          ]),
        );
        this.throwIfWorkerActorUnavailable(outcome);
        return Object.freeze({
          outcome:
            outcome === "scheduled"
              ? ("cleaned" as const)
              : outcome === "blocked"
                ? ("blocked" as const)
                : outcome === "not_found"
                  ? ("not_found" as const)
                  : ("conflict" as const),
        });
      },
      monitorExternalReference: async ({
        organizationId,
        productId,
        artifactId,
        expectedVersion,
        sha256,
        byteSize,
        externalReferenceCandidates,
      }) => {
        const monitored = await this.externalReferences.monitor({
          candidates: externalReferenceCandidates,
          sha256,
          byteSize,
        });
        const row = await this.one(
          "monitor_security_update_external_reference_worker_atomic",
          {
            p_organization_id: organizationId,
            p_product_id: productId,
            p_artifact_id: artifactId,
            p_expected_version: expectedVersion,
            p_monitor_outcome:
              monitored.outcome === "type_mismatch"
                ? "external_content_changed"
                : monitored.outcome,
            p_correlation_id: randomUUID(),
          },
        );
        const outcome = this.outcome(
          row,
          new Set([
            "monitored",
            "conflict",
            "not_found",
            "invalid_state",
            "invalid_request",
            "retryable_unavailable",
          ]),
        );
        this.throwIfWorkerActorUnavailable(outcome);
        return Object.freeze({
          outcome:
            outcome === "monitored"
              ? ("monitored" as const)
              : outcome === "not_found"
                ? ("not_found" as const)
                : ("conflict" as const),
        });
      },
    });

  private eventFor(
    eventType: WorkType,
    value: unknown,
  ): ProductComplianceOutboxEvent {
    const artifact = this.artifact(value);
    const base = Object.freeze({
      organizationId: artifact.organizationId,
      productId: artifact.productId,
      artifactId: artifact.id,
      actorId: artifact.updatedBy,
      expectedVersion: artifact.version,
      sha256: artifact.sha256,
      byteSize: artifact.byteSize,
      contentType: artifact.contentType,
      objectKey:
        artifact.distributionKind === "authenticated_download"
          ? this.readableObjectKey(
              value,
              artifact.organizationId,
              artifact.sha256,
            )
          : undefined,
      distributionKind: artifact.distributionKind,
      externalReferenceCandidates: externalCandidates(artifact),
    });
    switch (eventType) {
      case "security_update_artifact.availability_recalculate":
        return Object.freeze({
          kind: "availability_recalculate" as const,
          ...base,
          issuedAt: artifact.issuedAt,
          supportEndsAt: artifact.supportEndsAt,
          existingAvailabilityUntil: artifact.availabilityUntil,
        });
      case "security_update_artifact.inspect":
        return Object.freeze({ kind: "inspect" as const, ...base });
      case "security_update_artifact.cleanup":
        return Object.freeze({ kind: "cleanup" as const, ...base });
      case "security_update_artifact.external_reference_monitor":
        return Object.freeze({
          kind: "external_reference_monitor" as const,
          organizationId: artifact.organizationId,
          productId: artifact.productId,
          artifactId: artifact.id,
          actorId: artifact.updatedBy,
          expectedVersion: artifact.version,
          sha256: artifact.sha256,
          byteSize: artifact.byteSize,
          externalReferenceCandidates: externalCandidates(artifact),
        });
    }
  }

  private artifact(value: unknown): SecurityUpdateArtifact {
    const parsed = securityUpdateArtifactResponseSchema.safeParse({
      artifact: withoutObjectKey(value),
    });
    if (!parsed.success)
      throw new ProductComplianceWorkerFailure("malformed_provider", false);
    return parsed.data.artifact;
  }

  private readableObjectKey(
    value: unknown,
    organizationId: string,
    sha256: string,
  ): string {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ProductComplianceWorkerFailure("malformed_provider", false);
    }
    const objectKey = (value as Record<string, unknown>).objectKey;
    if (typeof objectKey !== "string") {
      throw new ProductComplianceWorkerFailure("malformed_provider", false);
    }
    const segments = objectKey.split("/");
    const isShared = segments.length === 2;
    const isLegacy = segments.length === 3 && isUuid(segments[1]);
    if (
      (!isShared && !isLegacy) ||
      segments[0] !== organizationId ||
      segments[segments.length - 1] !== sha256 ||
      !isUuid(segments[0]) ||
      !isSha256(segments[segments.length - 1])
    ) {
      throw new ProductComplianceWorkerFailure("malformed_provider", false);
    }
    return objectKey;
  }

  private async one(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<ProviderRow> {
    const result = await this.query(name, args);
    if (!Array.isArray(result.data) || result.data.length !== 1) {
      throw new ProductComplianceWorkerFailure("malformed_provider", false);
    }
    return this.record(result.data[0]);
  }

  private async rows(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<readonly ProviderRow[]> {
    const result = await this.query(name, args);
    if (!Array.isArray(result.data))
      throw new ProductComplianceWorkerFailure("malformed_provider", false);
    return Object.freeze(result.data.map((value) => this.record(value)));
  }

  private async query(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<ProviderResult> {
    try {
      const result = await (this.supabase.admin() as unknown as RpcClient).rpc(
        name,
        args,
      );
      if (result.error)
        throw new ProductComplianceWorkerFailure("unavailable", true);
      return result;
    } catch (error) {
      if (error instanceof ProductComplianceWorkerFailure) throw error;
      throw new ProductComplianceWorkerFailure("unavailable", true);
    }
  }

  private outcome<T extends string>(
    row: ProviderRow,
    allowed: ReadonlySet<T>,
  ): T {
    const value = row.outcome;
    if (typeof value !== "string" || !allowed.has(value as T)) {
      throw new ProductComplianceWorkerFailure("malformed_provider", false);
    }
    return value as T;
  }

  private throwIfWorkerActorUnavailable(outcome: string): void {
    if (outcome === "retryable_unavailable") {
      throw new ProductComplianceWorkerFailure(
        "worker_actor_unavailable",
        true,
      );
    }
  }

  private record(value: unknown): ProviderRow {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ProductComplianceWorkerFailure("malformed_provider", false);
    }
    return value as ProviderRow;
  }
}

const withoutObjectKey = (value: unknown): unknown => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([key]) => key !== "objectKey",
    ),
  );
};

const inspectionArguments = (inspection: ProductComplianceInspection) =>
  inspection.outcome === "verified"
    ? Object.freeze({
        p_integrity_status: "verified",
        p_verified_sha256: inspection.sha256,
        p_verified_byte_size: inspection.byteSize,
        p_verified_content_type: inspection.contentType,
      })
    : Object.freeze({
        p_integrity_status:
          inspection.outcome === "unavailable"
            ? "provider_unavailable"
            : inspection.outcome,
        p_verified_sha256: null,
        p_verified_byte_size: null,
        p_verified_content_type: null,
      });

const externalInspection = (
  monitored: Readonly<{
    outcome:
      | "verified"
      | "external_content_changed"
      | "type_mismatch"
      | "unavailable"
      | "provider_unavailable";
  }>,
  sha256: string,
  byteSize: number,
  contentType: string,
): ProductComplianceInspection => {
  switch (monitored.outcome) {
    case "verified":
      return Object.freeze({
        outcome: "verified" as const,
        sha256,
        byteSize,
        contentType,
      });
    case "type_mismatch":
      return Object.freeze({ outcome: "type_mismatch" as const });
    case "external_content_changed":
      return Object.freeze({ outcome: "hash_mismatch" as const });
    case "unavailable":
    case "provider_unavailable":
      return Object.freeze({ outcome: "unavailable" as const });
  }
};

const externalCandidates = (
  artifact: SecurityUpdateArtifact,
): readonly Pick<
  SecurityUpdateArtifact["publishedExternalReferences"][number],
  "id" | "title" | "uri"
>[] => {
  const references =
    artifact.publishedExternalReferences.length > 0
      ? artifact.publishedExternalReferences
      : artifact.distributionReference === null
        ? []
        : [artifact.distributionReference];
  return Object.freeze(
    references.map(({ id, title, uri }) => Object.freeze({ id, title, uri })),
  );
};

const safeCode = (value: string): string =>
  /^[a-z0-9_]{1,80}$/.test(value) ? value : "worker_failure";

const isUuid = (value: string | undefined): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value);

const isSha256 = (value: string | undefined): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
