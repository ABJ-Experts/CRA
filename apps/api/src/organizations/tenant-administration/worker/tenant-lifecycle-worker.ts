import { createHash } from "node:crypto";

import { buildStoredZip, exportSourceRegistry } from "./export-archive";

const safeErrorCode = (value: unknown): string =>
  value instanceof WorkerFailure ? value.code : "provider_unavailable";

const retryable = (value: unknown): boolean =>
  !(value instanceof WorkerFailure) || value.retryable;

const isLeaseConflict = (outcome: string): boolean =>
  outcome === "conflict" ||
  outcome === "not_found" ||
  outcome === "invalid_state";

export class WorkerFailure extends Error {
  readonly name = "WorkerFailure";

  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

export type ExportPart = Readonly<{
  sourceId: string;
  partNumber: number;
  objectPath: string;
  sha256: string;
  byteSize: number;
}>;

type ExportClaim =
  | Readonly<{
      outcome: "claimed";
      jobId: string;
      leaseOwner: string;
      checkpointVersion: number;
      sourceIds: readonly string[];
    }>
  | Readonly<{ outcome: "none_available" | "invalid_state" | "not_found" }>;

type CleanupClaim =
  | Readonly<{
      outcome: "claimed";
      runId: string;
      leaseOwner: string;
      checkpointVersion: number;
      evidenceClass: string;
      items: readonly Readonly<{ itemId: string; sourceRecordId: string }>[];
    }>
  | Readonly<{
      outcome: "none_available" | "unavailable" | "blocked" | "not_found";
    }>;

type PurgeClaim =
  | Readonly<{
      outcome: "claimed";
      jobId: string;
      leaseOwner: string;
      checkpointVersion: number;
    }>
  | Readonly<{
      outcome: "none_available" | "blocked" | "invalid_state" | "not_found";
    }>;

export interface TenantLifecycleWorkerDependencies {
  workerId: string;
  leaseSeconds: number;
  /**
   * The worker builds deterministic STORE ZIPs in memory. This configured
   * ceiling prevents a single export from exceeding the supported worker and
   * private-bucket object size. Larger tenants are rejected safely until a
   * streaming packager is deployed.
   */
  maximumArchiveBytes: number;
  sources: Readonly<{
    read(
      organizationId: string,
      exportId: string,
      sourceId: string,
    ): Promise<Buffer>;
  }>;
  storage: Readonly<{
    read(path: string): Promise<Buffer | null>;
    write(path: string, bytes: Buffer, contentType?: string): Promise<void>;
  }>;
  export: Readonly<{
    dueOrganizationIds(): Promise<readonly string[]>;
    claim(
      organizationId: string,
      workerId: string,
      leaseSeconds: number,
    ): Promise<ExportClaim>;
    materialize(
      command: Readonly<{
        organizationId: string;
        exportId: string;
        leaseOwner: string;
        checkpointVersion: number;
      }>,
    ): Promise<
      Readonly<{
        outcome:
          | "materialized"
          | "replayed"
          | "conflict"
          | "not_found"
          | "invalid_request";
        checkpointVersion?: number;
      }>
    >;
    parts(
      organizationId: string,
      exportId: string,
    ): Promise<readonly ExportPart[]>;
    context(
      organizationId: string,
      exportId: string,
    ): Promise<Readonly<{ actorId: string; requestedAt: string }> | null>;
    checkpoint(
      command: Readonly<{
        organizationId: string;
        exportId: string;
        leaseOwner: string;
        checkpointVersion: number;
        completedParts: number;
        totalParts: number;
        parts: readonly ExportPart[];
      }>,
    ): Promise<
      Readonly<{
        outcome: "checkpointed" | "conflict" | "not_found" | "invalid_request";
        checkpointVersion?: number;
      }>
    >;
    complete(
      command: Readonly<{
        organizationId: string;
        exportId: string;
        leaseOwner: string;
        checkpointVersion: number;
        manifestFileCount: number;
        manifestSha256: string;
        artifactSha256: string;
        artifactObjectPath: string;
      }>,
    ): Promise<
      Readonly<{
        outcome: "completed" | "conflict" | "verification_failed" | "not_found";
      }>
    >;
    fail(
      command: Readonly<{
        organizationId: string;
        exportId: string;
        leaseOwner: string;
        checkpointVersion: number;
        code: string;
        retryable: boolean;
      }>,
    ): Promise<unknown>;
  }>;
  cleanup: Readonly<{
    dueOrganizationIds(): Promise<readonly string[]>;
    claim(
      organizationId: string,
      workerId: string,
      leaseSeconds: number,
    ): Promise<CleanupClaim>;
    complete(
      command: Readonly<{
        organizationId: string;
        runId: string;
        leaseOwner: string;
        checkpointVersion: number;
        results: readonly Readonly<{
          itemId: string;
          status: "deleted" | "skipped_protected" | "failed";
          safeErrorCode?: string;
        }>[];
      }>,
    ): Promise<
      Readonly<{
        outcome:
          | "completed"
          | "blocked"
          | "conflict"
          | "not_found"
          | "invalid_request";
      }>
    >;
    fail(
      command: Readonly<{
        organizationId: string;
        runId: string;
        leaseOwner: string;
        checkpointVersion: number;
        code: string;
        retryable: boolean;
      }>,
    ): Promise<unknown>;
  }>;
  purge: Readonly<{
    dueOrganizationIds(): Promise<readonly string[]>;
    claim(
      organizationId: string,
      workerId: string,
      leaseSeconds: number,
    ): Promise<PurgeClaim>;
    complete(
      command: Readonly<{
        organizationId: string;
        purgeJobId: string;
        leaseOwner: string;
        checkpointVersion: number;
      }>,
    ): Promise<
      Readonly<{ outcome: "purged" | "blocked" | "conflict" | "not_found" }>
    >;
    fail(
      command: Readonly<{
        organizationId: string;
        purgeJobId: string;
        leaseOwner: string;
        checkpointVersion: number;
        code: string;
        retryable: boolean;
      }>,
    ): Promise<unknown>;
  }>;
  artifactWork: Readonly<{
    claim(
      workerId: string,
      leaseSeconds: number,
    ): Promise<
      | Readonly<{ outcome: "claimed"; workId: string; objectPrefix: string }>
      | Readonly<{ outcome: "none_available" | "not_found" }>
    >;
    complete(
      workId: string,
      leaseOwner: string,
    ): Promise<Readonly<{ outcome: "completed" | "conflict" | "not_found" }>>;
    fail(
      command: Readonly<{
        workId: string;
        leaseOwner: string;
        code: string;
        retryable: boolean;
      }>,
    ): Promise<unknown>;
  }>;
  evidenceCleanup: Readonly<{
    remove(
      input: Readonly<{
        organizationId: string;
        evidenceClass: string;
        sourceRecordId: string;
      }>,
    ): Promise<
      Readonly<{
        status: "deleted" | "skipped_protected" | "failed";
        safeErrorCode?: string;
      }>
    >;
  }>;
  /**
   * The owning artifact capability snapshots original bytes and metadata under
   * the export namespace before it reports success. An absent capability is a
   * safe export failure, never an implicit omission of tenant artifacts.
   */
  artifactSnapshot: Readonly<{
    snapshot(
      input: Readonly<{
        organizationId: string;
        exportId: string;
        leaseOwner: string;
        checkpointVersion: number;
      }>,
    ): Promise<
      Readonly<{
        outcome:
          "snapshotted" | "replayed" | "conflict" | "not_found" | "unavailable";
      }>
    >;
  }>;
  artifacts: Readonly<{
    inventory(organizationId: string): Promise<readonly string[]>;
    deletePrefix?(prefix: string): Promise<void>;
  }>;
}

/**
 * Process-local execution is deliberately stateless. PostgreSQL leases own
 * every decision, so a crash or duplicate delivery simply reclaims a durable
 * row on the next run.
 */
export class TenantLifecycleWorker {
  constructor(
    private readonly dependencies: TenantLifecycleWorkerDependencies,
  ) {
    if (
      !Number.isInteger(dependencies.leaseSeconds) ||
      dependencies.leaseSeconds < 1 ||
      dependencies.leaseSeconds > 3600
    ) {
      throw new Error("invalid tenant lifecycle worker lease");
    }
    if (
      !Number.isSafeInteger(dependencies.maximumArchiveBytes) ||
      dependencies.maximumArchiveBytes < 1
    ) {
      throw new Error("invalid tenant lifecycle worker archive limit");
    }
  }

  async runOnce(): Promise<void> {
    await this.processExports();
    await this.processCleanup();
    await this.processPurge();
    await this.processPostDeleteArtifactWork();
  }

  private async processExports(): Promise<void> {
    const organizationIds = await this.dependencies.export.dueOrganizationIds();
    for (const organizationId of this.uniqueIds(organizationIds)) {
      await this.processExport(organizationId);
    }
  }

  private async processExport(organizationId: string): Promise<void> {
    const claim = await this.dependencies.export.claim(
      organizationId,
      this.dependencies.workerId,
      this.dependencies.leaseSeconds,
    );
    if (claim.outcome !== "claimed") return;
    let checkpointVersion = claim.checkpointVersion;
    try {
      const sourceIds = this.validateSources(claim.sourceIds);
      const materialized = await this.dependencies.export.materialize({
        organizationId,
        exportId: claim.jobId,
        leaseOwner: claim.leaseOwner,
        checkpointVersion,
      });
      if (
        materialized.outcome !== "materialized" &&
        materialized.outcome !== "replayed"
      ) {
        if (isLeaseConflict(materialized.outcome)) return;
        throw new WorkerFailure("snapshot_rejected", false);
      }
      if (materialized.checkpointVersion !== undefined) {
        checkpointVersion = materialized.checkpointVersion;
      }
      const artifacts = await this.dependencies.artifactSnapshot.snapshot({
        organizationId,
        exportId: claim.jobId,
        leaseOwner: claim.leaseOwner,
        checkpointVersion,
      });
      if (
        artifacts.outcome !== "snapshotted" &&
        artifacts.outcome !== "replayed"
      ) {
        if (isLeaseConflict(artifacts.outcome)) return;
        throw new WorkerFailure("artifact_snapshot_unavailable", true);
      }
      const context = await this.dependencies.export.context(
        organizationId,
        claim.jobId,
      );
      if (!context) throw new WorkerFailure("not_found", false);
      let parts = [
        ...(await this.dependencies.export.parts(organizationId, claim.jobId)),
      ];
      const knownParts = new Map(parts.map((part) => [part.sourceId, part]));

      for (const sourceId of sourceIds) {
        const sourceBytes = await this.dependencies.sources.read(
          organizationId,
          claim.jobId,
          sourceId,
        );
        const expectedHash = createHash("sha256")
          .update(sourceBytes)
          .digest("hex");
        const existing = knownParts.get(sourceId);
        const reusable = existing
          ? await this.readMatchingPart(
              existing,
              expectedHash,
              sourceBytes.length,
            )
          : false;
        if (reusable) continue;

        const part: ExportPart = Object.freeze({
          sourceId,
          partNumber: 1,
          objectPath: `${organizationId}/${claim.jobId}/parts/${sourceId}.ndjson`,
          sha256: expectedHash,
          byteSize: sourceBytes.length,
        });
        await this.dependencies.storage.write(
          part.objectPath,
          sourceBytes,
          "application/x-ndjson",
        );
        const ledger = existing
          ? parts.map((candidate) =>
              candidate.sourceId === sourceId ? part : candidate,
            )
          : [...parts, part];
        const checkpoint = await this.dependencies.export.checkpoint({
          organizationId,
          exportId: claim.jobId,
          leaseOwner: claim.leaseOwner,
          checkpointVersion,
          completedParts: ledger.length,
          totalParts: sourceIds.length,
          parts: [part],
        });
        if (
          checkpoint.outcome !== "checkpointed" ||
          checkpoint.checkpointVersion === undefined
        ) {
          if (isLeaseConflict(checkpoint.outcome)) return;
          throw new WorkerFailure("checkpoint_rejected", false);
        }
        checkpointVersion = checkpoint.checkpointVersion;
        parts = ledger;
        knownParts.set(sourceId, part);
      }

      if (parts.length !== sourceIds.length)
        throw new WorkerFailure("export_ledger_mismatch", false);
      this.assertArchivePartBytes(parts);
      const archive = await this.archive(
        organizationId,
        claim.jobId,
        context,
        sourceIds,
        parts,
      );
      const completion = await this.dependencies.export.complete({
        organizationId,
        exportId: claim.jobId,
        leaseOwner: claim.leaseOwner,
        checkpointVersion,
        manifestFileCount: parts.length,
        manifestSha256: archive.manifestSha256,
        artifactSha256: archive.artifactSha256,
        artifactObjectPath: archive.objectPath,
      });
      if (
        completion.outcome === "conflict" ||
        completion.outcome === "not_found"
      )
        return;
      if (completion.outcome !== "completed")
        throw new WorkerFailure("verification_failed", false);
    } catch (error) {
      if (
        error instanceof WorkerFailure &&
        !error.retryable &&
        error.code === "not_found"
      )
        return;
      await this.dependencies.export.fail({
        organizationId,
        exportId: claim.jobId,
        leaseOwner: claim.leaseOwner,
        checkpointVersion,
        code: safeErrorCode(error),
        retryable: retryable(error),
      });
    }
  }

  private async archive(
    organizationId: string,
    exportId: string,
    context: Readonly<{ actorId: string; requestedAt: string }>,
    sourceIds: readonly string[],
    parts: readonly ExportPart[],
  ): Promise<
    Readonly<{
      manifestSha256: string;
      artifactSha256: string;
      objectPath: string;
    }>
  > {
    const files: { path: string; bytes: Buffer }[] = [];
    const manifestFiles: Record<string, unknown>[] = [];
    for (const sourceId of sourceIds) {
      const part = parts.find((candidate) => candidate.sourceId === sourceId);
      if (!part) throw new WorkerFailure("export_ledger_mismatch", false);
      const bytes = await this.dependencies.storage.read(part.objectPath);
      if (
        !bytes ||
        createHash("sha256").update(bytes).digest("hex") !== part.sha256
      ) {
        throw new WorkerFailure("artifact_corrupt", true);
      }
      const path = `records/${sourceId}.ndjson`;
      files.push({ path, bytes });
      manifestFiles.push({
        path,
        sourceId,
        recordCount: this.ndjsonRecordCount(bytes),
        byteSize: bytes.length,
        sha256: part.sha256,
      });
    }
    const manifest = Buffer.from(
      `${JSON.stringify({
        schemaVersion: 1,
        exportFormatVersion: 1,
        organizationId,
        exportId,
        requestedBy: context.actorId,
        startedAt: context.requestedAt,
        completedAt: new Date().toISOString(),
        files: manifestFiles,
        verification: { status: "verified", algorithm: "sha256" },
      })}\n`,
      "utf8",
    );
    this.assertArchiveFits(
      files.reduce((total, file) => total + file.bytes.length, 0),
      manifest.length,
      files.length + 1,
    );
    const manifestSha256 = createHash("sha256").update(manifest).digest("hex");
    const zip = buildStoredZip([
      ...files,
      { path: "manifest.json", bytes: manifest },
    ]);
    const objectPath = `${organizationId}/${exportId}/organization-export-v1.zip`;
    await this.dependencies.storage.write(
      objectPath,
      zip.bytes,
      "application/zip",
    );
    const storedArchive = await this.dependencies.storage.read(objectPath);
    if (
      !storedArchive ||
      createHash("sha256").update(storedArchive).digest("hex") !== zip.sha256
    ) {
      throw new WorkerFailure("artifact_corrupt", true);
    }
    return Object.freeze({
      manifestSha256,
      artifactSha256: zip.sha256,
      objectPath,
    });
  }

  private async readMatchingPart(
    part: ExportPart,
    sha256: string,
    byteSize: number,
  ): Promise<boolean> {
    if (part.sha256 !== sha256 || part.byteSize !== byteSize) return false;
    const bytes = await this.dependencies.storage.read(part.objectPath);
    return Boolean(
      bytes && createHash("sha256").update(bytes).digest("hex") === sha256,
    );
  }

  private assertArchivePartBytes(parts: readonly ExportPart[]): void {
    const partBytes = parts.reduce((total, part) => total + part.byteSize, 0);
    if (
      !Number.isSafeInteger(partBytes) ||
      partBytes > this.dependencies.maximumArchiveBytes
    ) {
      throw new WorkerFailure("export_size_limit", false);
    }
  }

  private assertArchiveFits(
    sourceBytes: number,
    manifestBytes: number,
    fileCount: number,
  ): void {
    // STORE ZIP local headers, central-directory records, file names and EOCD
    // are bounded above by 1 KiB per registered part. The exact ZIP writer is
    // still authoritative; this preflight makes its in-memory allocation safe.
    const conservativeZipBytes = sourceBytes + manifestBytes + fileCount * 1024;
    if (
      !Number.isSafeInteger(conservativeZipBytes) ||
      conservativeZipBytes > this.dependencies.maximumArchiveBytes
    ) {
      throw new WorkerFailure("export_size_limit", false);
    }
  }

  private async processCleanup(): Promise<void> {
    const organizationIds =
      await this.dependencies.cleanup.dueOrganizationIds();
    for (const organizationId of this.uniqueIds(organizationIds)) {
      const claim = await this.dependencies.cleanup.claim(
        organizationId,
        this.dependencies.workerId,
        this.dependencies.leaseSeconds,
      );
      if (claim.outcome !== "claimed") continue;
      try {
        const results = await Promise.all(
          claim.items.map(async (item) => {
            const result = await this.dependencies.evidenceCleanup.remove({
              organizationId,
              evidenceClass: claim.evidenceClass,
              sourceRecordId: item.sourceRecordId,
            });
            return Object.freeze({ itemId: item.itemId, ...result });
          }),
        );
        const completed = await this.dependencies.cleanup.complete({
          organizationId,
          runId: claim.runId,
          leaseOwner: claim.leaseOwner,
          checkpointVersion: claim.checkpointVersion,
          results,
        });
        if (
          !isLeaseConflict(completed.outcome) &&
          completed.outcome !== "completed" &&
          completed.outcome !== "blocked"
        ) {
          throw new WorkerFailure("cleanup_rejected", false);
        }
      } catch (error) {
        await this.dependencies.cleanup.fail({
          organizationId,
          runId: claim.runId,
          leaseOwner: claim.leaseOwner,
          checkpointVersion: claim.checkpointVersion,
          code: safeErrorCode(error),
          retryable: retryable(error),
        });
      }
    }
  }

  private async processPurge(): Promise<void> {
    const organizationIds = await this.dependencies.purge.dueOrganizationIds();
    for (const organizationId of this.uniqueIds(organizationIds)) {
      const claim = await this.dependencies.purge.claim(
        organizationId,
        this.dependencies.workerId,
        this.dependencies.leaseSeconds,
      );
      if (claim.outcome !== "claimed") continue;
      try {
        // Inventory must be reachable before deleting database state. The
        // durable post-delete artifact-work queue performs deletion/retry.
        await this.dependencies.artifacts.inventory(organizationId);
        const completed = await this.dependencies.purge.complete({
          organizationId,
          purgeJobId: claim.jobId,
          leaseOwner: claim.leaseOwner,
          checkpointVersion: claim.checkpointVersion,
        });
        if (
          !isLeaseConflict(completed.outcome) &&
          completed.outcome !== "purged" &&
          completed.outcome !== "blocked"
        ) {
          throw new WorkerFailure("purge_rejected", false);
        }
      } catch (error) {
        await this.dependencies.purge.fail({
          organizationId,
          purgeJobId: claim.jobId,
          leaseOwner: claim.leaseOwner,
          checkpointVersion: claim.checkpointVersion,
          code: safeErrorCode(error),
          retryable: retryable(error),
        });
      }
    }
  }

  private async processPostDeleteArtifactWork(): Promise<void> {
    const claim = await this.dependencies.artifactWork.claim(
      this.dependencies.workerId,
      this.dependencies.leaseSeconds,
    );
    if (claim.outcome !== "claimed") return;
    try {
      if (!this.dependencies.artifacts.deletePrefix) {
        throw new WorkerFailure("dependency_unavailable", true);
      }
      await this.dependencies.artifacts.deletePrefix(claim.objectPrefix);
      const completed = await this.dependencies.artifactWork.complete(
        claim.workId,
        this.dependencies.workerId,
      );
      if (
        !isLeaseConflict(completed.outcome) &&
        completed.outcome !== "completed"
      ) {
        throw new WorkerFailure("artifact_work_rejected", false);
      }
    } catch (error) {
      await this.dependencies.artifactWork.fail({
        workId: claim.workId,
        leaseOwner: this.dependencies.workerId,
        code: safeErrorCode(error),
        retryable: retryable(error),
      });
    }
  }

  private validateSources(sourceIds: readonly string[]): string[] {
    const registered = new Set(
      exportSourceRegistry.map((entry) => entry.sourceId),
    );
    const unique = [...new Set(sourceIds)];
    if (
      unique.length === 0 ||
      unique.length !== sourceIds.length ||
      unique.some((sourceId) => !registered.has(sourceId))
    ) {
      throw new WorkerFailure("invalid_export_source", false);
    }
    return unique;
  }

  private uniqueIds(values: readonly string[]): string[] {
    return [
      ...new Set(
        values.filter((value) =>
          /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value),
        ),
      ),
    ];
  }

  private ndjsonRecordCount(bytes: Buffer): number {
    const text = bytes.toString("utf8");
    if (text.length === 0) return 0;
    return text.trimEnd().length === 0 ? 0 : text.trimEnd().split("\n").length;
  }
}
