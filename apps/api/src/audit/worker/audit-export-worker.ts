import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import type { AuditExportManifest } from "@repo/contracts/audit/types";

import { encodeAuditCsvCell } from "./audit-export-serialization";
import { buildStoredZipFile } from "./audit-export-zip";
import type {
  AuditExportEvent,
  AuditExportFailureCode,
  AuditExportJob,
  AuditExportJobRepository,
  AuditExportStorage,
  JsonValue,
} from "./audit-export-types";

const maximumEvents = 100_000;
const maximumArchiveBytes = 256 * 1024 * 1024;
const batchSize = 250;
const sha256 = (text: string | Buffer): string =>
  createHash("sha256").update(text).digest("hex");
const contentHash = (previousHash: string, canonicalContent: string): string =>
  sha256(
    Buffer.concat([
      Buffer.from(previousHash, "hex"),
      Buffer.from(canonicalContent, "utf8"),
    ]),
  );

export type AuditExportWorkerDependencies = Readonly<{
  workerId?: string;
  repository: AuditExportJobRepository;
  storage: AuditExportStorage;
  now?: () => Date;
}>;

type WrittenFile = Readonly<{
  name: "events.csv" | "events.json" | "proofs.ndjson" | "verify.mjs";
  path: string;
  sha256: string;
  bytes: number;
}>;

export class AuditExportWorker {
  private readonly workerId: string;
  private readonly repository: AuditExportJobRepository;
  private readonly storage: AuditExportStorage;
  private readonly now: () => Date;

  constructor(dependencies: AuditExportWorkerDependencies) {
    this.workerId = dependencies.workerId ?? randomUUID();
    this.repository = dependencies.repository;
    this.storage = dependencies.storage;
    this.now = dependencies.now ?? (() => new Date());
  }

  async runOnce(): Promise<"processed" | "idle"> {
    const job = await this.repository.claim(this.workerId);
    if (!job) return "idle";
    let activeJob = job;
    try {
      const artifact = await this.buildAndStore(job, (updatedJob) => {
        activeJob = updatedJob;
      });
      const completed = await this.repository.complete({
        job: activeJob,
        selectedIds: job.selectedIds,
        artifact,
      });
      if (completed !== "completed")
        throw new WorkerFailure("generation_failed", false);
      return "processed";
    } catch (error) {
      const failure = mapFailure(error);
      await this.repository.fail({
        job: activeJob,
        code: failure.code,
        retryable: failure.retryable,
      });
      return "processed";
    }
  }

  private async buildAndStore(
    job: AuditExportJob,
    onHeartbeat: (job: AuditExportJob) => void,
  ) {
    if (job.selectedIds.length > maximumEvents)
      throw new WorkerFailure("export_limit", false);
    const workDir = join(
      tmpdir(),
      "cra-audit-export-worker",
      job.id,
      randomUUID(),
    );
    await mkdir(workDir, { recursive: true, mode: 0o700 });
    let heartbeat: ReturnType<typeof createLeaseRefresher> | null = null;
    try {
      let activeJob = job;
      heartbeat = createLeaseRefresher(job, this.repository, (updatedJob) => {
        activeJob = updatedJob;
        onHeartbeat(updatedJob);
      });
      const materialized = await this.writeExportParts(
        activeJob,
        workDir,
        heartbeat.beat,
      );
      activeJob = await heartbeat.beat();
      const manifest = this.manifest(
        activeJob,
        materialized.counts,
        materialized.sequenceRange,
        materialized.files,
      );
      const manifestPath = join(workDir, "manifest.json");
      const manifestBytes = Buffer.from(
        `${JSON.stringify(manifest)}\n`,
        "utf8",
      );
      await writePrivateFile(manifestPath, manifestBytes);
      const manifestShaPath = join(workDir, "manifest.sha256");
      await writePrivateFile(
        manifestShaPath,
        Buffer.from(`${sha256(manifestBytes)}\n`, "utf8"),
      );
      const zipPath = join(workDir, "audit-export.zip");
      activeJob = await heartbeat.beat();
      const zip = await buildStoredZipFile({
        outputPath: zipPath,
        maximumBytes: maximumArchiveBytes,
        files: [
          ...materialized.files.map((file) => ({
            name: file.name,
            path: file.path,
          })),
          { name: "manifest.json", path: manifestPath },
          { name: "manifest.sha256", path: manifestShaPath },
        ],
      });
      activeJob = await heartbeat.beat();
      const objectPath = `${activeJob.organizationId}/${activeJob.id}/${zip.sha256}.zip`;
      const stored = await this.storage.upload({
        objectPath,
        contentType: "application/zip",
        stream: createReadStream(zip.path),
      });
      if (stored.outcome === "unavailable")
        throw new WorkerFailure("storage_unavailable", true);
      if (stored.outcome === "already_exists") {
        const verified = await this.storage.verify({
          objectPath,
          sha256: zip.sha256,
          byteSize: zip.byteSize,
        });
        if (verified.outcome !== "verified")
          throw new WorkerFailure("storage_unavailable", true);
      }
      activeJob = await heartbeat.beat();
      onHeartbeat(activeJob);
      await heartbeat.stop();
      heartbeat = null;
      return Object.freeze({
        objectPath,
        sha256: zip.sha256,
        byteSize: zip.byteSize,
        contentType: "application/zip" as const,
        manifest,
      });
    } finally {
      await heartbeat?.stop();
      await rm(workDir, { force: true, recursive: true });
    }
  }

  private async writeExportParts(
    initialJob: AuditExportJob,
    workDir: string,
    heartbeat: () => Promise<AuditExportJob>,
  ) {
    let job = initialJob;
    const eventsPath = join(workDir, `events.${job.format}`);
    const proofsPath = join(workDir, "proofs.ndjson");
    const verifierPath = join(workDir, "verify.mjs");
    await writePrivateFile(verifierPath, await importVerifier());
    const eventWriter = createMeasuredWriter(eventsPath, maximumArchiveBytes);
    const proofWriter = createMeasuredWriter(proofsPath, maximumArchiveBytes);
    let count = 0;
    let legacyCount = 0;
    let proofCount = 0;
    let minSequence: string | null = null;
    let maxSequence: string | null = null;
    if (job.format === "csv") await eventWriter.write(csvHeader());
    else await eventWriter.write("[");
    for (let offset = 0; offset < job.selectedIds.length; offset += batchSize) {
      const events = await this.repository.events(job, offset, batchSize);
      if (offset > 0) {
        job = await heartbeat();
      }
      for (const event of events) {
        if (event.id !== job.selectedIds[count])
          throw new WorkerFailure("access_changed", false);
        if (count >= maximumEvents)
          throw new WorkerFailure("export_limit", false);
        verifyEventHash(event);
        if (job.format === "csv") await eventWriter.write(csvRow(event));
        else
          await eventWriter.write(
            `${count === 0 ? "" : ","}${JSON.stringify(publicEvent(event))}`,
          );
        const proof = proofLine(event);
        if (proof) {
          proofCount += 1;
          await proofWriter.write(proof);
        }
        if (event.legacy) legacyCount += 1;
        if (event.sequence) {
          minSequence =
            minSequence === null || BigInt(event.sequence) < BigInt(minSequence)
              ? event.sequence
              : minSequence;
          maxSequence =
            maxSequence === null || BigInt(event.sequence) > BigInt(maxSequence)
              ? event.sequence
              : maxSequence;
        }
        count += 1;
      }
    }
    if (count !== job.selectedIds.length)
      throw new WorkerFailure("access_changed", false);
    if (job.format === "json") await eventWriter.write("]\n");
    const eventFile = await eventWriter.close();
    const proofFile = await proofWriter.close();
    const verifier = await statHash(verifierPath);
    return Object.freeze({
      counts: Object.freeze({ rowCount: count, legacyCount, proofCount }),
      sequenceRange: Object.freeze({ from: minSequence, to: maxSequence }),
      files: Object.freeze([
        {
          name: `events.${job.format}`,
          path: eventsPath,
          ...eventFile,
        },
        { name: "proofs.ndjson" as const, path: proofsPath, ...proofFile },
        { name: "verify.mjs" as const, path: verifierPath, ...verifier },
      ] satisfies readonly WrittenFile[]),
    });
  }

  private manifest(
    job: AuditExportJob,
    counts: Readonly<{
      rowCount: number;
      legacyCount: number;
      proofCount: number;
    }>,
    sequenceRange: Readonly<{ from: string | null; to: string | null }>,
    files: readonly WrittenFile[],
  ): AuditExportManifest {
    return Object.freeze({
      schema: "cra.audit-export.v1",
      hashAlgorithm: "sha256",
      organizationId: job.organizationId,
      scopeDigest: job.scopeDigest,
      filters: job.filters,
      format: job.format,
      generatedAt: this.now().toISOString(),
      timezone: "UTC",
      ordering: "sequence_desc_then_legacy_created_at_id_desc",
      sequenceRange,
      rowCount: counts.rowCount,
      legacyCount: counts.legacyCount,
      proofCount: counts.proofCount,
      files: files.map((file) => ({
        name: file.name,
        sha256: file.sha256,
        bytes: file.bytes,
      })),
      completenessProven: false,
      authenticityProven: false,
    });
  }
}

class WorkerFailure extends Error {
  constructor(
    readonly code: AuditExportFailureCode,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

function mapFailure(
  error: unknown,
): Readonly<{ code: AuditExportFailureCode; retryable: boolean }> {
  if (error instanceof WorkerFailure) return error;
  if (error instanceof Error && error.message === "integrity_break")
    return { code: "integrity_break", retryable: false };
  if (error instanceof Error && error.message === "export_limit")
    return { code: "export_limit", retryable: false };
  return { code: "generation_failed", retryable: true };
}

function verifyEventHash(event: AuditExportEvent): void {
  const canonical = event.recomputedCanonicalContent ?? event.canonicalContent;
  if (event.legacy || canonical === null || !event.contentHash) return;
  if (
    !event.previousHash ||
    contentHash(event.previousHash, canonical) !== event.contentHash ||
    (event.canonicalDisclosable &&
      event.canonicalContent !== null &&
      event.canonicalContent !== canonical)
  )
    throw new Error("integrity_break");
}

function proofLine(event: AuditExportEvent): string | null {
  if (
    event.legacy ||
    !event.sequence ||
    !event.previousHash ||
    !event.contentHash ||
    !event.canonicalDisclosable ||
    event.canonicalContent === null
  )
    return null;
  return `${JSON.stringify({ eventId: event.id, sequence: event.sequence, previousHash: event.previousHash, contentHash: event.contentHash, canonicalContent: event.canonicalContent })}\n`;
}

function createLeaseRefresher(
  initialJob: AuditExportJob,
  repository: AuditExportJobRepository,
  onHeartbeat: (job: AuditExportJob) => void,
) {
  let current = initialJob;
  let pending: Promise<AuditExportJob> = Promise.resolve(initialJob);
  const beat = async (): Promise<AuditExportJob> => {
    pending = pending.then(() => repository.heartbeat(current));
    current = await pending;
    onHeartbeat(current);
    return current;
  };
  const interval = setInterval(() => {
    void beat().catch(() => undefined);
  }, 60_000);
  interval.unref?.();
  return Object.freeze({
    beat,
    stop: async () => {
      clearInterval(interval);
      await pending.catch(() => current);
    },
  });
}

const columns = [
  "sequence",
  "event_id",
  "created_at",
  "legacy",
  "actor_type",
  "actor_id",
  "actor_label",
  "action",
  "resource_type",
  "resource_id",
  "correlation_id",
  "outcome",
  "before",
  "after",
  "reason",
];
const csvHeader = () => `${columns.join(",")}\n`;
function csvRow(event: AuditExportEvent): string {
  const row = publicEvent(event) as Record<string, unknown>;
  return `${columns.map((column) => encodeAuditCsvCell(column === "event_id" ? event.id : valueForCsv(row[column]))).join(",")}\n`;
}
function valueForCsv(value: unknown): string {
  return typeof value === "string"
    ? value
    : value === null || value === undefined
      ? ""
      : JSON.stringify(value);
}
function publicEvent(event: AuditExportEvent): Record<string, JsonValue> {
  return {
    sequence: event.sequence,
    event_id: event.id,
    created_at: event.createdAt,
    legacy: event.legacy,
    actor_type: event.actorType,
    actor_id: event.actorId,
    actor_label: event.actorLabel,
    action: event.action,
    resource_type: event.resourceType,
    resource_id: event.resourceId,
    correlation_id: event.correlationId,
    outcome: event.outcome,
    before: event.before,
    after: event.after,
    reason: event.reason,
  };
}
async function writePrivateFile(path: string, bytes: Buffer): Promise<void> {
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  await chmod(path, 0o600);
}
function createMeasuredWriter(path: string, maximumBytes: number) {
  const stream = createWriteStream(path, { flags: "wx", mode: 0o600 });
  const hash = createHash("sha256");
  let bytes = 0;
  return {
    write: async (value: string | Buffer) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
      bytes += chunk.byteLength;
      if (bytes > maximumBytes) throw new WorkerFailure("export_limit", false);
      hash.update(chunk);
      if (!stream.write(chunk))
        await new Promise<void>((resolve) =>
          stream.once("drain", () => resolve()),
        );
    },
    close: async () => {
      stream.end();
      await finished(stream);
      await chmod(path, 0o600);
      return Object.freeze({ sha256: hash.digest("hex"), bytes });
    },
  };
}
async function statHash(
  path: string,
): Promise<Readonly<{ sha256: string; bytes: number }>> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunkValue of createReadStream(path)) {
    const chunk = Buffer.isBuffer(chunkValue)
      ? chunkValue
      : Buffer.from(chunkValue);
    bytes += chunk.byteLength;
    hash.update(chunk);
  }
  return Object.freeze({ sha256: hash.digest("hex"), bytes });
}
async function importVerifier(): Promise<Buffer> {
  try {
    return await readFile(join(__dirname, "verify.mjs"));
  } catch {
    return readFile(
      join(process.cwd(), "apps/api/src/audit/worker/verify.mjs"),
    );
  }
}

export const auditExportWorkerLimits = Object.freeze({
  maximumEvents,
  maximumArchiveBytes,
  batchSize,
  maximumConcurrentWorkers: 2,
  maximumConcurrentTenantJobs: 1,
  maximumAttempts: 3,
});
export const auditExportContentHash = contentHash;
