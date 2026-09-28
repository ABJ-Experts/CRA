import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";

import { SupabaseService } from "../../../supabase/supabase.service";
import { type ExportArtifact, WorkerFailure } from "./tenant-lifecycle-worker";

type ProviderResult = Readonly<{ data: unknown; error: unknown }>;
type StorageBucket = Readonly<{
  download(path: string): PromiseLike<ProviderResult>;
  info(path: string): PromiseLike<ProviderResult>;
  upload(
    path: string,
    bytes: Buffer,
    options: Readonly<{ contentType: string; upsert: boolean }>,
  ): PromiseLike<Readonly<{ error: unknown }>>;
}>;

const tenantExportBucket = "tenant-exports";
const pageSize = 1000;
const maximumArtifactSnapshotBytes = 50 * 1024 * 1024;
const uuidSchema = z.uuid();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const artifactRowSchema = z
  .object({
    artifact_key: z.string().min(1),
    snapshot_object_path: z.string().min(1),
    sha256: sha256Schema,
    byte_size: z.number().int().nonnegative(),
    content_type: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();
const artifactInventoryItemSchema = z
  .object({
    bucketId: z.string().min(1),
    sourcePath: z.string().min(1),
    contentType: z.string().min(1),
    objectId: z.string().min(1),
    version: z.string().min(1),
    updatedAt: z.string().min(1),
    byteSize: z.number().int().nonnegative().nullable(),
  })
  .strict();
const artifactInventorySnapshotSchema = z
  .object({
    artifact_inventory: z.array(artifactInventoryItemSchema),
  })
  .strict();
const rpcOutcomeSchema = z
  .object({
    outcome: z.enum([
      "recorded",
      "replayed",
      "conflict",
      "not_found",
      "invalid_request",
    ]),
  })
  .strict();

type SnapshotInput = Readonly<{
  organizationId: string;
  exportId: string;
  leaseOwner: string;
  checkpointVersion: number;
}>;

type SnapshotOutcome = Readonly<{
  outcome:
    "snapshotted" | "replayed" | "conflict" | "not_found" | "unavailable";
}>;

type SourceArtifact = Readonly<{
  bucketId: string;
  sourcePath: string;
  contentType: string;
  objectId: string;
  version: string;
  updatedAt: string;
  byteSize: number | null;
}>;

@Injectable()
export class SupabaseTenantExportArtifactSnapshotAdapter {
  private readonly maximumArtifactBytes: number;

  constructor(
    private readonly supabase: SupabaseService,
    config: ConfigService,
  ) {
    const configuredMaximum = config.getOrThrow<number>(
      "TENANT_EXPORT_MAX_ARCHIVE_BYTES",
    );
    if (!Number.isSafeInteger(configuredMaximum) || configuredMaximum < 1) {
      throw new Error("invalid tenant export artifact snapshot limit");
    }
    this.maximumArtifactBytes = Math.min(
      configuredMaximum,
      maximumArtifactSnapshotBytes,
    );
  }

  async snapshot(input: SnapshotInput): Promise<SnapshotOutcome> {
    this.parseSnapshotInput(input);
    try {
      const existingSnapshots = new Map(
        (await this.list(input.organizationId, input.exportId)).map(
          (artifact) => [artifact.artifactKey, artifact],
        ),
      );
      const verifiedExistingKeys = new Set<string>();
      const sources = await this.sourceArtifacts(
        input.organizationId,
        input.exportId,
      );
      const expectedArtifactKeys = new Set(
        sources.map((source) => this.artifactKey(source)),
      );
      const expectedArtifacts = new Map(
        sources.map((source) => [this.artifactKey(source), source]),
      );
      for (const artifact of existingSnapshots.values()) {
        const expectedArtifact = expectedArtifacts.get(artifact.artifactKey);
        if (
          !expectedArtifactKeys.has(artifact.artifactKey) ||
          !expectedArtifact ||
          !this.metadataMatches(expectedArtifact, artifact.metadata)
        ) {
          throw new WorkerFailure("artifact_inventory_mismatch", false);
        }
      }
      let totalBytes = 0;
      let recordedCount = 0;
      let replayedCount = 0;
      for (const source of sources) {
        const artifactKey = this.artifactKey(source);
        const existingSnapshot = existingSnapshots.get(artifactKey);
        if (existingSnapshot) {
          await this.verifyExistingSnapshot(input, existingSnapshot);
          verifiedExistingKeys.add(artifactKey);
          replayedCount += 1;
          continue;
        }
        const sourceBytes = await this.downloadSource(source);
        totalBytes += sourceBytes.length;
        if (totalBytes > this.maximumArtifactBytes) {
          throw new WorkerFailure("export_size_limit", false);
        }
        const snapshotObjectPath = `${input.organizationId}/${input.exportId}/artifacts/${artifactKey}`;
        const sha256 = this.sha256(sourceBytes);
        await this.copyAndVerify({
          objectPath: snapshotObjectPath,
          bytes: sourceBytes,
          expectedSha256: sha256,
          expectedByteSize: sourceBytes.length,
          contentType: source.contentType,
        });
        const outcome = await this.recordSnapshot({
          input,
          source,
          artifactKey,
          snapshotObjectPath,
          sha256,
          byteSize: sourceBytes.length,
        });
        if (
          outcome === "conflict" ||
          outcome === "not_found" ||
          outcome === "invalid_request"
        ) {
          return Object.freeze({
            outcome: outcome === "invalid_request" ? "unavailable" : outcome,
          });
        }
        if (outcome === "recorded") recordedCount += 1;
        if (outcome === "replayed") replayedCount += 1;
      }
      for (const artifact of existingSnapshots.values()) {
        if (verifiedExistingKeys.has(artifact.artifactKey)) continue;
        await this.verifyExistingSnapshot(input, artifact);
        replayedCount += 1;
      }
      return Object.freeze({
        outcome:
          recordedCount === 0 && replayedCount > 0 ? "replayed" : "snapshotted",
      });
    } catch (error) {
      if (error instanceof WorkerFailure && error.code === "not_found") {
        return Object.freeze({ outcome: "not_found" as const });
      }
      if (error instanceof WorkerFailure) throw error;
      throw new WorkerFailure("provider_unavailable", true);
    }
  }

  async list(
    orgId: string,
    exportId: string,
  ): Promise<readonly ExportArtifact[]> {
    uuidSchema.parse(orgId);
    uuidSchema.parse(exportId);
    try {
      const query = this.admin()
        .from("organization_export_artifact_snapshots")
        .select(
          "artifact_key, snapshot_object_path, sha256, byte_size, content_type, metadata",
        )
        .eq("organization_id", orgId)
        .eq("export_job_id", exportId)
        .order("artifact_key", { ascending: true });
      const artifacts: ExportArtifact[] = [];
      let offset = 0;
      for (;;) {
        const result = await query.range(offset, offset + pageSize - 1);
        if (result.error) throw new WorkerFailure("provider_unavailable", true);
        if (!Array.isArray(result.data))
          throw new WorkerFailure("malformed_provider", false);
        for (const value of result.data) {
          const parsed = artifactRowSchema.safeParse(value);
          if (!parsed.success) {
            throw new WorkerFailure("malformed_provider", false);
          }
          artifacts.push(
            Object.freeze({
              artifactKey: parsed.data.artifact_key,
              snapshotObjectPath: parsed.data.snapshot_object_path,
              sha256: parsed.data.sha256,
              byteSize: parsed.data.byte_size,
              contentType: parsed.data.content_type,
              metadata: Object.freeze(parsed.data.metadata),
            }),
          );
        }
        if (result.data.length < pageSize) break;
        offset += result.data.length;
      }
      return Object.freeze(artifacts);
    } catch (error) {
      if (error instanceof WorkerFailure) throw error;
      throw new WorkerFailure("provider_unavailable", true);
    }
  }

  private parseSnapshotInput(input: SnapshotInput): void {
    uuidSchema.parse(input.organizationId);
    uuidSchema.parse(input.exportId);
    uuidSchema.parse(input.leaseOwner);
    if (
      !Number.isInteger(input.checkpointVersion) ||
      input.checkpointVersion < 0
    ) {
      throw new WorkerFailure("invalid_checkpoint", false);
    }
  }

  private async sourceArtifacts(
    organizationId: string,
    exportId: string,
  ): Promise<readonly SourceArtifact[]> {
    const result = await this.admin()
      .from("organization_export_snapshots")
      .select("artifact_inventory")
      .eq("organization_id", organizationId)
      .eq("export_job_id", exportId)
      .order("snapshot_version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (result.error) throw new WorkerFailure("provider_unavailable", true);
    if (!result.data) throw new WorkerFailure("not_found", false);
    const parsed = artifactInventorySnapshotSchema.safeParse(result.data);
    if (!parsed.success) throw new WorkerFailure("malformed_provider", false);
    return Object.freeze(
      parsed.data.artifact_inventory
        .map((item) => this.sourceArtifact(organizationId, item))
        .sort((left, right) =>
          `${left.bucketId}/${left.sourcePath}`.localeCompare(
            `${right.bucketId}/${right.sourcePath}`,
          ),
        ),
    );
  }

  private sourceArtifact(
    organizationId: string,
    item: z.output<typeof artifactInventoryItemSchema>,
  ): SourceArtifact {
    if (
      item.bucketId === tenantExportBucket ||
      !item.sourcePath.startsWith(`${organizationId}/`) ||
      /(^|\/)[.][.]?(\/|$)/.test(item.sourcePath) ||
      item.sourcePath.includes("//")
    ) {
      throw new WorkerFailure("malformed_provider", false);
    }
    return Object.freeze({
      bucketId: item.bucketId,
      sourcePath: item.sourcePath,
      contentType: item.contentType,
      objectId: item.objectId,
      version: item.version,
      updatedAt: item.updatedAt,
      byteSize: item.byteSize,
    });
  }

  private async downloadSource(source: SourceArtifact): Promise<Buffer> {
    await this.verifySourceInfo(source);
    const result = await this.storage(source.bucketId).download(
      source.sourcePath,
    );
    if (result.error) throw new WorkerFailure("provider_unavailable", true);
    if (!result.data || typeof result.data !== "object") {
      throw new WorkerFailure("malformed_provider", false);
    }
    const blobLike = result.data as Readonly<{
      arrayBuffer?: () => Promise<ArrayBuffer>;
    }>;
    if (typeof blobLike.arrayBuffer !== "function") {
      throw new WorkerFailure("malformed_provider", false);
    }
    const bytes = Buffer.from(await blobLike.arrayBuffer());
    if (source.byteSize !== null && bytes.length !== source.byteSize) {
      throw new WorkerFailure("artifact_source_changed", false);
    }
    await this.verifySourceInfo(source);
    return bytes;
  }

  private async verifySourceInfo(source: SourceArtifact): Promise<void> {
    const result = await this.storage(source.bucketId).info(source.sourcePath);
    if (result.error) throw new WorkerFailure("provider_unavailable", true);
    const parsed = z
      .object({
        id: z.string().min(1),
        version: z.string().min(1),
        lastModified: z.string().min(1),
      })
      .passthrough()
      .safeParse(result.data);
    if (
      !parsed.success ||
      parsed.data.id !== source.objectId ||
      parsed.data.version !== source.version ||
      !this.sameTimestamp(parsed.data.lastModified, source.updatedAt)
    ) {
      throw new WorkerFailure("artifact_source_changed", false);
    }
  }

  private async copyAndVerify(
    input: Readonly<{
      objectPath: string;
      bytes: Buffer;
      expectedSha256: string;
      expectedByteSize: number;
      contentType: string;
    }>,
  ): Promise<void> {
    const bucket = this.storage(tenantExportBucket);
    const upload = await bucket.upload(input.objectPath, input.bytes, {
      contentType: input.contentType,
      upsert: true,
    });
    if (upload.error) throw new WorkerFailure("provider_unavailable", true);
    const readBack = await bucket.download(input.objectPath);
    if (readBack.error) throw new WorkerFailure("provider_unavailable", true);
    if (!readBack.data || typeof readBack.data !== "object") {
      throw new WorkerFailure("malformed_provider", false);
    }
    const blobLike = readBack.data as Readonly<{
      arrayBuffer?: () => Promise<ArrayBuffer>;
    }>;
    if (typeof blobLike.arrayBuffer !== "function") {
      throw new WorkerFailure("malformed_provider", false);
    }
    const copied = Buffer.from(await blobLike.arrayBuffer());
    if (
      copied.length !== input.expectedByteSize ||
      this.sha256(copied) !== input.expectedSha256
    ) {
      throw new WorkerFailure("artifact_snapshot_integrity_failed", true);
    }
  }

  private async verifyExistingSnapshot(
    input: SnapshotInput,
    artifact: ExportArtifact,
  ): Promise<void> {
    const expectedPrefix = `${input.organizationId}/${input.exportId}/artifacts/`;
    if (!artifact.snapshotObjectPath.startsWith(expectedPrefix)) {
      throw new WorkerFailure("malformed_provider", false);
    }
    const readBack = await this.storage(tenantExportBucket).download(
      artifact.snapshotObjectPath,
    );
    if (readBack.error) throw new WorkerFailure("provider_unavailable", true);
    if (!readBack.data || typeof readBack.data !== "object") {
      throw new WorkerFailure("malformed_provider", false);
    }
    const blobLike = readBack.data as Readonly<{
      arrayBuffer?: () => Promise<ArrayBuffer>;
    }>;
    if (typeof blobLike.arrayBuffer !== "function") {
      throw new WorkerFailure("malformed_provider", false);
    }
    const copied = Buffer.from(await blobLike.arrayBuffer());
    if (
      copied.length !== artifact.byteSize ||
      this.sha256(copied) !== artifact.sha256
    ) {
      throw new WorkerFailure("artifact_snapshot_integrity_failed", true);
    }
  }

  private async recordSnapshot(
    input: Readonly<{
      input: SnapshotInput;
      source: SourceArtifact;
      artifactKey: string;
      snapshotObjectPath: string;
      sha256: string;
      byteSize: number;
    }>,
  ): Promise<
    "recorded" | "replayed" | "conflict" | "not_found" | "invalid_request"
  > {
    const result = await this.admin().rpc(
      "record_organization_export_artifact_snapshot_atomic",
      {
        p_organization_id: input.input.organizationId,
        p_export_job_id: input.input.exportId,
        p_lease_owner: input.input.leaseOwner,
        p_expected_checkpoint_version: input.input.checkpointVersion,
        p_artifact_key: input.artifactKey,
        p_snapshot_object_path: input.snapshotObjectPath,
        p_sha256: input.sha256,
        p_byte_size: input.byteSize,
        p_content_type: input.source.contentType,
        p_metadata: {
          bucket: input.source.bucketId,
          sourcePath: input.source.sourcePath,
          objectId: input.source.objectId,
          version: input.source.version,
          updatedAt: input.source.updatedAt,
        },
      },
    );
    if (result.error) throw new WorkerFailure("provider_unavailable", true);
    if (!Array.isArray(result.data) || result.data.length !== 1) {
      throw new WorkerFailure("malformed_provider", false);
    }
    const parsed = rpcOutcomeSchema.safeParse(result.data[0]);
    if (!parsed.success) throw new WorkerFailure("malformed_provider", false);
    return parsed.data.outcome;
  }

  private artifactKey(source: SourceArtifact): string {
    return `${source.bucketId}/${this.sha256(
      Buffer.from(`${source.bucketId}/${source.sourcePath}`, "utf8"),
    )}`;
  }

  private metadataMatches(
    source: SourceArtifact,
    metadata: Readonly<Record<string, unknown>>,
  ): boolean {
    return (
      metadata.bucket === source.bucketId &&
      metadata.sourcePath === source.sourcePath &&
      metadata.objectId === source.objectId &&
      metadata.version === source.version &&
      typeof metadata.updatedAt === "string" &&
      this.sameTimestamp(metadata.updatedAt, source.updatedAt)
    );
  }

  private sameTimestamp(left: string, right: string): boolean {
    const leftTime = Date.parse(left);
    const rightTime = Date.parse(right);
    return (
      Number.isFinite(leftTime) &&
      Number.isFinite(rightTime) &&
      leftTime === rightTime
    );
  }

  private sha256(bytes: Buffer): string {
    return createHash("sha256").update(bytes).digest("hex");
  }

  private storage(bucket: string): StorageBucket {
    return this.admin().storage.from(bucket);
  }

  private admin() {
    return this.supabase.admin() as unknown as {
      from(tableName: string): {
        select(columns: string): {
          eq(column: string, value: string | boolean): unknown;
        };
      };
      rpc(
        functionName: string,
        args: Readonly<Record<string, unknown>>,
      ): PromiseLike<ProviderResult>;
      storage: {
        from(bucket: string): StorageBucket;
      };
    } & {
      from(tableName: "organization_export_snapshots"): {
        select(columns: string): {
          eq(
            column: string,
            value: string,
          ): {
            eq(
              column: string,
              value: string,
            ): {
              order(
                column: string,
                options: Readonly<{ ascending: boolean }>,
              ): {
                limit(limit: number): {
                  maybeSingle(): PromiseLike<ProviderResult>;
                };
              };
            };
          };
        };
      };
      from(tableName: "organization_export_artifact_snapshots"): {
        select(columns: string): {
          eq(
            column: string,
            value: string,
          ): {
            eq(
              column: string,
              value: string,
            ): {
              order(
                column: string,
                options: Readonly<{ ascending: boolean }>,
              ): {
                range(from: number, to: number): PromiseLike<ProviderResult>;
              };
            };
          };
        };
      };
    };
  }
}
