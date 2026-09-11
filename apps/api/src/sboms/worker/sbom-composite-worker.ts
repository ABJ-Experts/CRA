import { createHash, randomUUID } from "node:crypto";

import { Logger } from "@nestjs/common";
import { z } from "zod";

import type { SbomIntakeUseCases } from "../application/sbom-intake-use-cases";

const uuidSchema = z.uuid();
const maximumClaimsPerCycle = 1_000;

export type SbomCompositeComponentFact = Readonly<{
  componentRef: string;
  name: string;
  version: string | null;
  canonicalPurl: string | null;
  canonicalCpe: string | null;
  hashes: readonly Readonly<{ algorithm: string; value: string }>[];
}>;

export type SbomCompositeDependencyFact = Readonly<{
  fromRef: string;
  toRef: string;
}>;

export type SbomCompositeClaim =
  | Readonly<{
      outcome: "claimed";
      organizationId: string;
      reviewId: string;
      actorId: string;
      productId: string;
      releaseId: string;
      mergeRulesVersion: string;
      generatedSourceId: string | null;
      components: readonly SbomCompositeComponentFact[];
      dependencies: readonly SbomCompositeDependencyFact[];
    }>
  | Readonly<{ outcome: "none_available" | "conflict" }>;

export interface SbomCompositeQueue {
  dueCompositeOrganizationIds(): Promise<readonly string[]>;
  claimCompositeGeneration(
    organizationId: string,
    input: Readonly<{ workerId: string; leaseSeconds: number }>,
  ): Promise<SbomCompositeClaim>;
  attachGeneratedSource(
    organizationId: string,
    input: Readonly<{ reviewId: string; workerId: string; sourceId: string }>,
  ): Promise<void>;
  reconcileCompositeGeneration(
    organizationId: string,
    input: Readonly<{ reviewId: string; workerId: string }>,
  ): Promise<void>;
  failCompositeGeneration(
    organizationId: string,
    input: Readonly<{
      reviewId: string;
      workerId: string;
      errorCode: "generation_failed" | "provider_unavailable";
      message: string;
    }>,
  ): Promise<void>;
}

export interface SbomCompositeStorage {
  writeImmutable(
    input: Readonly<{
      objectKey: string;
      contentType: string;
      bytes: Buffer;
    }>,
  ): Promise<Readonly<{ outcome: "written" | "already_exists" }>>;
}

/**
 * Produces a deterministic CycloneDX projection after the database has made
 * all conflict/relationship decisions durable. It never alters an input
 * document; output re-enters the ordinary generated-source intake pipeline.
 */
export class SbomCompositeWorker {
  private readonly logger = new Logger(SbomCompositeWorker.name);

  constructor(
    private readonly dependencies: Readonly<{
      workerId: string;
      leaseSeconds: number;
      queue: SbomCompositeQueue;
      intake: Pick<SbomIntakeUseCases, "initialize" | "complete">;
      storage: SbomCompositeStorage;
    }>,
  ) {
    if (!uuidSchema.safeParse(dependencies.workerId).success)
      throw new Error("invalid sbom composite worker id");
    if (
      !Number.isInteger(dependencies.leaseSeconds) ||
      dependencies.leaseSeconds < 15 ||
      dependencies.leaseSeconds > 900
    ) {
      throw new Error("invalid sbom composite worker lease");
    }
  }

  async runOnce(): Promise<void> {
    let due = unique(
      await this.dependencies.queue.dueCompositeOrganizationIds(),
    );
    let remaining = maximumClaimsPerCycle;
    while (due.length > 0 && remaining > 0) {
      const nextRound: string[] = [];
      for (const organizationId of due) {
        if (remaining === 0) break;
        if (await this.processOne(organizationId))
          nextRound.push(organizationId);
        remaining -= 1;
      }
      due = nextRound;
    }
  }

  private async processOne(organizationId: string): Promise<boolean> {
    const claim = await this.dependencies.queue.claimCompositeGeneration(
      organizationId,
      {
        workerId: this.dependencies.workerId,
        leaseSeconds: this.dependencies.leaseSeconds,
      },
    );
    if (claim.outcome !== "claimed") return false;

    try {
      // The generated source has already entered ordinary intake. Reconciliation
      // is intentionally separate so a restart never emits a second composite.
      if (claim.generatedSourceId) {
        await this.dependencies.queue.reconcileCompositeGeneration(
          organizationId,
          {
            reviewId: claim.reviewId,
            workerId: this.dependencies.workerId,
          },
        );
        return true;
      }
      const document = renderCompositeCycloneDx(claim);
      const bytes = Buffer.from(JSON.stringify(document), "utf8");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const initialized = resultValue(
        await this.dependencies.intake.initialize({
          organizationId,
          actorId: claim.actorId,
          productId: claim.productId,
          releaseId: claim.releaseId,
          filename: `composite-${claim.reviewId}.cdx.json`,
          byteSize: bytes.byteLength,
          mediaType: "application/vnd.cyclonedx+json",
          sha256,
          source: "generated",
          // The review id makes restart/replay safe while the exact bytes remain
          // bound through the source request digest and immutable object hash.
          idempotencyKey: claim.reviewId,
          correlationId: randomUUID(),
          declaredFormat: "cyclonedx",
          declaredSpecVersion: "1.6",
        }),
      );
      await this.dependencies.storage.writeImmutable({
        objectKey: initialized.reservation.objectKey,
        contentType: initialized.reservation.mediaType,
        bytes,
      });
      resultValue(
        await this.dependencies.intake.complete({
          organizationId,
          actorId: claim.actorId,
          sourceId: initialized.reservation.id,
          idempotencyKey: claim.reviewId,
          correlationId: randomUUID(),
        }),
      );
      await this.dependencies.queue.attachGeneratedSource(organizationId, {
        reviewId: claim.reviewId,
        workerId: this.dependencies.workerId,
        sourceId: initialized.reservation.id,
      });
      await this.dependencies.queue.reconcileCompositeGeneration(
        organizationId,
        {
          reviewId: claim.reviewId,
          workerId: this.dependencies.workerId,
        },
      );
    } catch (error) {
      await this.dependencies.queue.failCompositeGeneration(organizationId, {
        reviewId: claim.reviewId,
        workerId: this.dependencies.workerId,
        errorCode:
          error instanceof CompositeWorkerError
            ? error.code
            : "provider_unavailable",
        message:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "Composite generation failed.",
      });
      this.logger.warn({ message: "sbom composite generation failed" });
    }
    return true;
  }
}

/** Stable canonical JSON shape: ordering is part of generated document identity. */
export function renderCompositeCycloneDx(
  work: Extract<SbomCompositeClaim, { outcome: "claimed" }>,
) {
  const components = [...work.components]
    .sort((left, right) => left.componentRef.localeCompare(right.componentRef))
    .map((component) =>
      Object.freeze({
        type: "library",
        "bom-ref": component.componentRef,
        name: component.name,
        ...(component.version ? { version: component.version } : {}),
        ...(component.canonicalPurl ? { purl: component.canonicalPurl } : {}),
        ...(component.canonicalCpe ? { cpe: component.canonicalCpe } : {}),
        ...(component.hashes.length > 0
          ? {
              hashes: [...component.hashes]
                .sort((left, right) =>
                  `${left.algorithm}:${left.value}`.localeCompare(
                    `${right.algorithm}:${right.value}`,
                  ),
                )
                .map((hash) => ({ alg: hash.algorithm, content: hash.value })),
            }
          : {}),
      }),
    );
  const refs = new Set(components.map((component) => component["bom-ref"]));
  const dependencies = new Map<string, Set<string>>();
  for (const dependency of work.dependencies) {
    if (!refs.has(dependency.fromRef) || !refs.has(dependency.toRef)) continue;
    const children = dependencies.get(dependency.fromRef) ?? new Set<string>();
    children.add(dependency.toRef);
    dependencies.set(dependency.fromRef, children);
  }
  return Object.freeze({
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${work.reviewId}`,
    version: 1,
    metadata: {
      component: {
        type: "application",
        "bom-ref": `urn:cra:composite:${work.reviewId}`,
        name: "CRA composite SBOM",
        version: work.mergeRulesVersion,
      },
    },
    components,
    dependencies: [...dependencies.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([ref, children]) => ({
        ref,
        dependsOn: [...children].sort((left, right) =>
          left.localeCompare(right),
        ),
      })),
  });
}

export class CompositeWorkerError extends Error {
  constructor(readonly code: "generation_failed" | "provider_unavailable") {
    super(code);
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function resultValue<T>(
  result: Readonly<{ ok: true; value: T }> | Readonly<{ ok: false }>,
): T {
  if (result.ok) return result.value;
  throw new CompositeWorkerError("generation_failed");
}
