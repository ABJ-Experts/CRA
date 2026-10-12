import { projectFrozenSourceRow } from "./export-source-projection";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderReadinessReport } from "./readiness-renderer";
import { exportManifestSchema } from "@repo/contracts/exports";
import { renderExportPart, type FrozenRow } from "./export-renderer";
import type {
  ExportPartCheckpoint,
  ExportWorkerRepository,
  ExportWorkerStorage,
  FrozenExportJob,
} from "./export-worker.types";

const maximumRows = 100000;
const maximumParts = 512;
const maximumTotalBytes = 1024 ** 3;

export class ExportWorker {
  private readonly workerId: string;
  constructor(
    private readonly dependencies: Readonly<{
      repository: ExportWorkerRepository;
      storage: ExportWorkerStorage;
      workerId?: string;
      now?: () => number;
    }>,
  ) {
    this.workerId = dependencies.workerId ?? randomUUID();
  }
  async runOnce(): Promise<"idle" | "processed"> {
    const { repository, storage } = this.dependencies;
    let job = await repository.claim(this.workerId);
    if (!job) return "idle";
    let directory: string | undefined;
    let leaseTimer: ReturnType<typeof setInterval> | undefined;
    let pulse: Promise<void> = Promise.resolve();
    let pulseFailure: unknown;
    let transitioning = false;
    const assertPulse = () => {
      if (pulseFailure)
        throw pulseFailure instanceof Error
          ? pulseFailure
          : new Error("generation_failed");
    };
    const transition = async <T>(operation: () => Promise<T>): Promise<T> => {
      transitioning = true;
      try {
        await pulse;
        assertPulse();
        transitioning = true;
        return await operation();
      } finally {
        transitioning = false;
      }
    };
    try {
      const authorize = async () => {
        assertPulse();
        if (!(await repository.authorize(job!)))
          throw new Error("access_changed");
      };
      await authorize();
      if (job.captureState === "pending") job = await repository.capture(job);
      if (job.captureState === "captured")
        job = await repository.publishCapture(job);
      if (
        job.captureState !== "published" ||
        !job.snapshotAsOf ||
        job.totalRows > maximumRows
      )
        throw new Error("export_limit");
      await mkdir(join(tmpdir(), "cra-list-exports"), {
        mode: 0o700,
        recursive: true,
      });
      leaseTimer = setInterval(() => {
        if (transitioning || pulseFailure) return;
        transitioning = true;
        pulse = (async () => {
          try {
            await repository.heartbeat(job!);
            if (!(await repository.authorize(job!)))
              throw new Error("access_changed");
          } catch (error) {
            pulseFailure = error;
          } finally {
            transitioning = false;
          }
        })();
      }, 15000);
      leaseTimer.unref();
      directory = await mkdtemp(join(tmpdir(), "cra-list-exports", "job-"));
      const parts: ExportPartCheckpoint[] = [...job.parts];
      let cursor = 0;
      let totalBytes = 0;
      for (const part of parts) {
        if (
          part.startOrdinal !== (job.format === "report" ? 1 : cursor + 1) ||
          part.endOrdinal < cursor ||
          !(await storage.verify({
            objectPath: part.objectPath,
            sha256: part.sha256,
            bytes: part.byteLength,
          }))
        )
          throw new Error("checkpoint_integrity_failed");
        cursor = part.endOrdinal;
        totalBytes += part.byteLength;
      }
      if (job.format === "report") {
        const reportRows = await repository.rows(job, 0, 1);
        if (
          reportRows.length !== 1 ||
          typeof reportRows[0]!.values.report !== "string"
        )
          throw new Error("snapshot_integrity_failed");
        if (parts.length < 2) {
          const rendered = await renderReadinessReport(
            directory,
            JSON.parse(reportRows[0]!.values.report),
          );
          for (const file of rendered) {
            if (parts.some((part) => part.name === file.name)) continue;
            await authorize();
            job = await repository.heartbeat(job);
            const objectPath = `${job.organizationId}/${job.id}/${file.name}-${file.sha256}`;
            const mediaType = file.name.endsWith("pdf")
              ? "application/pdf"
              : "application/json";
            await storage.upload({
              objectPath,
              contentType: mediaType,
              stream: createReadStream(file.path),
            });
            if (
              !(await storage.verify({
                objectPath,
                sha256: file.sha256,
                bytes: file.bytes,
              }))
            )
              throw new Error("storage_integrity_failed");
            parts.push({
              id: randomUUID(),
              name: file.name,
              objectPath,
              sha256: file.sha256,
              byteLength: file.bytes,
              startOrdinal: 1,
              endOrdinal: 1,
              rowCount: 1,
              mediaType,
            });
            job = await transition(() =>
              repository.checkpoint(job!, [...parts]),
            );
          }
        }
        cursor = 1;
      }
      let lastHeartbeat = (this.dependencies.now ?? Date.now)();
      const beat = async () => {
        const now = (this.dependencies.now ?? Date.now)();
        if (now - lastHeartbeat >= 15000) {
          job = await repository.heartbeat(job!);
          await authorize();
          lastHeartbeat = now;
        }
      };
      while (
        job.format !== "report" &&
        (cursor < job.totalRows || parts.length === 0)
      ) {
        if (parts.length >= maximumParts) throw new Error("export_limit");
        await authorize();
        job = await repository.heartbeat(job);
        const firstOrdinal = cursor + 1;
        const rows = this.partRows(() => job!, cursor, beat);
        const name = `part-${String(parts.length + 1).padStart(4, "0")}.${job.format}`;
        const part = await renderExportPart({
          directory,
          name,
          format: job.format as "csv" | "xlsx",
          columns: job.columns,
          rows,
          onRow: beat,
        });
        cursor += part.rowCount;
        if (part.rowCount === 0 && job.totalRows > cursor)
          throw new Error("snapshot_integrity_failed");
        totalBytes += part.bytes;
        if (totalBytes > maximumTotalBytes) throw new Error("export_limit");
        const objectPath = `${job.organizationId}/${job.id}/${name}-${part.sha256}`;
        await authorize();
        await storage.upload({
          objectPath,
          contentType:
            job.format === "csv"
              ? "text/csv"
              : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          stream: createReadStream(part.path),
        });
        const checkpoint: ExportPartCheckpoint = {
          id: randomUUID(),
          name,
          objectPath,
          sha256: part.sha256,
          byteLength: part.bytes,
          startOrdinal: firstOrdinal,
          endOrdinal: cursor,
          rowCount: part.rowCount,
          mediaType:
            job.format === "csv"
              ? "text/csv"
              : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        };
        if (
          !(await storage.verify({
            objectPath,
            sha256: checkpoint.sha256,
            bytes: checkpoint.byteLength,
          }))
        )
          throw new Error("storage_integrity_failed");
        parts.push(checkpoint);
        job = await transition(() => repository.checkpoint(job!, [...parts]));
        await rm(part.path, { force: true });
      }
      await authorize();
      if (cursor !== job.totalRows)
        throw new Error("snapshot_integrity_failed");
      const sourceHash = createHash("sha256");
      let versionCursor = 0;
      while (versionCursor < job.totalRows) {
        await beat();
        const rows = await repository.rows(job, versionCursor, 250);
        if (!rows.length) throw new Error("snapshot_integrity_failed");
        for (const row of rows) {
          sourceHash.update(JSON.stringify(row) + "\n");
          versionCursor = row.ordinal;
        }
      }
      if (leaseTimer) clearInterval(leaseTimer);
      await pulse;
      assertPulse();
      await repository.complete(
        job,
        exportManifestSchema.parse({
          version: "m14_03_v1",
          jobId: job.id,
          source: job.source,
          requestedAt: job.requestedAt,
          snapshotAsOf: job.snapshotAsOf,
          scope: job.scope,
          requestDigest: job.requestDigest,
          rowCount: cursor,
          columns: job.columns,
          artifacts: parts.map((part) => ({
            id: part.id,
            name: part.name,
            mediaType: part.mediaType,
            byteLength: part.byteLength,
            sha256: part.sha256,
            rowCount: part.rowCount,
          })),
          sourceVersionsDigest:
            job.sourceVersionsDigest ?? sourceHash.digest("hex"),
          documentationReadinessOnly: job.format === "report",
        }),
      );
    } catch (error) {
      if (leaseTimer) clearInterval(leaseTimer);
      await pulse;
      const code = safeExportWorkerFailure(error);
      if (code !== "lease_conflict") {
        try {
          await repository.fail(
            job,
            code,
            [
              "storage_unavailable",
              "generation_failed",
              "provider_unavailable",
              "capture_timeout",
            ].includes(code),
          );
        } catch (failure) {
          // A newer host owns this job now. Its fencing token is authoritative.
          if (safeExportWorkerFailure(failure) !== "lease_conflict")
            throw failure;
        }
      }
    } finally {
      if (leaseTimer) clearInterval(leaseTimer);
      await pulse;
      if (directory) await rm(directory, { recursive: true, force: true });
    }
    return "processed";
  }
  private async *partRows(
    job: () => FrozenExportJob,
    after: number,
    beat: () => Promise<void>,
  ): AsyncGenerator<FrozenRow> {
    let cursor = after;
    let count = 0;
    let bytes = 0;
    while (cursor < job().totalRows && count < 25000) {
      await beat();
      const rows = await this.dependencies.repository.rows(
        job(),
        cursor,
        Math.min(250, 25000 - count),
      );
      if (!rows.length || rows.length > 250)
        throw new Error("snapshot_integrity_failed");
      for (const row of rows) {
        if (row.ordinal !== cursor + 1)
          throw new Error("snapshot_integrity_failed");
        const rowBytes = Buffer.byteLength(JSON.stringify(row.values));
        if (bytes + rowBytes > 8 * 1024 * 1024 && count > 0) return;
        if (rowBytes > 8 * 1024 * 1024) throw new Error("export_limit");
        yield projectFrozenSourceRow(job().source, row);
        cursor = row.ordinal;
        count += 1;
        bytes += rowBytes;
      }
    }
  }
}
const safeCodes = new Set([
  "access_changed",
  "capture_timeout",
  "lease_conflict",
  "export_limit",
  "xlsx_cell_limit_use_csv",
  "invalid_frozen_cell",
  "artifact_limit",
  "checkpoint_integrity_failed",
  "snapshot_integrity_failed",
  "storage_integrity_failed",
  "storage_unavailable",
  "provider_unavailable",
  "readiness_renderer_unavailable",
]);
export function safeExportWorkerFailure(error: unknown): string {
  return error instanceof Error && safeCodes.has(error.message)
    ? error.message
    : "generation_failed";
}
