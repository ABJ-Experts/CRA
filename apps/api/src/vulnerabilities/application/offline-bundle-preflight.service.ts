import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, rm, statfs } from "node:fs/promises";
import { basename, dirname } from "node:path";
import {
  vulnerabilityOfflineBundleManifestSchema,
  vulnerabilityProviderRecordSchema,
  type VulnerabilityOfflineBundleManifest,
  type VulnerabilityProviderRecord,
} from "@repo/contracts/vulnerabilities";

import { OfflineBundleImportUseCases } from "./offline-bundle-import-use-cases";
import {
  BundleVerificationError,
  type OfflineBundleTrustedKeyring,
  verifyOfflineBundle,
} from "./offline-bundle-verifier";

export const offlineBundleManifestMaxBytes = 1_048_576;
export const offlineBundleSignatureMaxBytes = 65_536;
export const offlineBundlePayloadMaxBytes = 67_108_864;
export const offlineBundleTotalMaxBytes = 268_435_456;

export type OfflineBundleUploadFile = Readonly<{
  path: string;
  originalname: string;
  size: number;
}>;

export type OfflineBundleUploadFiles = Readonly<{
  manifest: OfflineBundleUploadFile;
  signature: OfflineBundleUploadFile;
  payloads: readonly OfflineBundleUploadFile[];
}>;

export class OfflineBundlePreflightError extends Error {
  constructor(
    readonly code:
      | "manifest_invalid"
      | "signature_invalid"
      | "untrusted_key"
      | "compatibility_incompatible"
      | "payload_inventory_invalid"
      | "payload_hash_mismatch"
      | "disk_capacity_unavailable"
      | "staging_interrupted",
  ) {
    super(code);
    this.name = "OfflineBundlePreflightError";
  }
}

/**
 * Filesystem boundary for signed multipart uploads. It authenticates every
 * byte before creating a durable staging import, then stages only normalized
 * provider records. All uploaded temporary files are removed on every exit.
 */
export class OfflineBundlePreflightService {
  constructor(
    private readonly imports: OfflineBundleImportUseCases,
    private readonly configuration: Readonly<{
      applicationVersion: string | undefined;
      trustedKeyringJson: string | undefined;
      normalizeCsafDocuments?: (
        input: Readonly<{ document: unknown; sourceUrl: string }>,
      ) => readonly unknown[];
    }>,
  ) {}

  async preflight(
    input: Readonly<{
      files: OfflineBundleUploadFiles;
      actorId: string;
      idempotencyKey: string;
      correlationId: string;
    }>,
  ) {
    try {
      await this.assertCapacity(input.files);
      const manifest = await parseManifest(input.files.manifest);
      const [signature, payloads] = await Promise.all([
        readBoundedFile(input.files.signature, offlineBundleSignatureMaxBytes),
        parsePayloads(
          manifest,
          input.files.payloads,
          this.configuration.normalizeCsafDocuments,
        ),
      ]);
      const verification = verifyOfflineBundle({
        manifest,
        signature,
        payloads: new Map(
          payloads.map((payload) => [
            payload.path,
            { byteLength: payload.byteLength, sha256: payload.sha256 },
          ]),
        ),
        keyring: parseKeyring(this.configuration.trustedKeyringJson),
        applicationVersion: this.configuration.applicationVersion ?? "",
        now: new Date(),
      });
      // Deterministic per signed manifest: a retry after a transport failure
      // can resume the lease-backed staging run without creating another
      // worker identity or a second mirror import.
      const stagingWorkerId = `offline-bundle:${verification.manifestSha256}`;
      const prepared = await this.imports.preflight({
        bundleId: `offline:${verification.manifestSha256}`,
        bundleVersion: manifest.bundleVersion,
        manifestSha256: verification.manifestSha256,
        signingKeyId: verification.signingKeyId,
        manifest,
        verificationReceipt: {
          algorithm: "Ed25519",
          keyId: verification.signingKeyId,
          status: "verified",
          verifiedAt: new Date().toISOString(),
        },
        actorId: input.actorId,
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
        payloads: payloads.map((payload) => ({
          feedKey: payload.feedKey,
          sourceSnapshotAt: payload.sourceSnapshotAt,
          payloadSha256: payload.sha256,
          schemaVersion: payload.schemaVersion,
          expectedRecordCount: payload.records.length,
        })),
        stagingWorkerId,
      });
      // A successful replay may already have been promoted. Never stage a
      // completed mirror again; idempotent stage upserts make interrupted
      // awaiting-confirmation retries safe.
      if (prepared.import.status === "awaiting_confirmation") {
        await this.stagePayloads(prepared.runs, payloads, stagingWorkerId);
        // The durable projection can now calculate an evidence-based change
        // estimate from the complete staged snapshot. Do not present the
        // preliminary, pre-staging receipt as if it were a final estimate.
        return this.imports.get(prepared.import.id);
      }
      return prepared.import;
    } catch (error) {
      if (error instanceof OfflineBundlePreflightError) throw error;
      if (error instanceof BundleVerificationError) {
        throw new OfflineBundlePreflightError(mapVerificationError(error));
      }
      throw new OfflineBundlePreflightError("staging_interrupted");
    } finally {
      await cleanup(input.files);
    }
  }

  private async stagePayloads(
    runs: readonly Readonly<{ id: string; feedKey: string }>[],
    payloads: readonly ParsedPayload[],
    workerId: string,
  ): Promise<void> {
    const runByFeed = new Map(runs.map((run) => [run.feedKey, run]));
    if (runByFeed.size !== payloads.length) {
      throw new OfflineBundlePreflightError("staging_interrupted");
    }
    for (const payload of payloads) {
      const run = runByFeed.get(payload.feedKey);
      if (!run) throw new OfflineBundlePreflightError("staging_interrupted");
      for (const record of payload.records) {
        await this.imports.stage({ runId: run.id, workerId, record });
      }
      await this.imports.completeStaging({
        runId: run.id,
        workerId,
        expectedRecordCount: payload.records.length,
      });
    }
  }

  private async assertCapacity(files: OfflineBundleUploadFiles): Promise<void> {
    const total = [files.manifest, files.signature, ...files.payloads].reduce(
      (sum, file) => sum + file.size,
      0,
    );
    if (
      files.manifest.size <= 0 ||
      files.manifest.size > offlineBundleManifestMaxBytes ||
      files.signature.size <= 0 ||
      files.signature.size > offlineBundleSignatureMaxBytes ||
      files.payloads.some(
        (file) => file.size <= 0 || file.size > offlineBundlePayloadMaxBytes,
      ) ||
      total > offlineBundleTotalMaxBytes
    ) {
      throw new OfflineBundlePreflightError("payload_inventory_invalid");
    }
    try {
      const volume = await statfs(dirname(files.manifest.path));
      const available = Number(volume.bavail) * Number(volume.bsize);
      if (!Number.isSafeInteger(available) || available < total + 8_388_608) {
        throw new OfflineBundlePreflightError("disk_capacity_unavailable");
      }
    } catch (error) {
      if (error instanceof OfflineBundlePreflightError) throw error;
      throw new OfflineBundlePreflightError("disk_capacity_unavailable");
    }
  }
}

type ParsedPayload = Readonly<{
  path: string;
  feedKey: VulnerabilityOfflineBundleManifest["payloads"][number]["feedKey"];
  sourceSnapshotAt: string;
  schemaVersion: string;
  byteLength: number;
  sha256: string;
  records: readonly VulnerabilityProviderRecord[];
}>;

async function parseManifest(
  file: OfflineBundleUploadFile,
): Promise<VulnerabilityOfflineBundleManifest> {
  const bytes = await readBoundedFile(file, offlineBundleManifestMaxBytes);
  try {
    return vulnerabilityOfflineBundleManifestSchema.parse(
      JSON.parse(bytes.toString("utf8")),
    );
  } catch {
    throw new OfflineBundlePreflightError("manifest_invalid");
  }
}

async function parsePayloads(
  manifest: VulnerabilityOfflineBundleManifest,
  files: readonly OfflineBundleUploadFile[],
  normalizeCsafDocuments: OfflineBundlePreflightService["configuration"]["normalizeCsafDocuments"],
): Promise<readonly ParsedPayload[]> {
  if (
    files.length !== manifest.payloads.length ||
    new Set(files.map((file) => file.originalname)).size !== files.length
  ) {
    throw new OfflineBundlePreflightError("payload_inventory_invalid");
  }
  return Promise.all(
    manifest.payloads.map(async (entry) => {
      const file = files.find(
        (candidate) => candidate.originalname === entry.path,
      );
      if (!file)
        throw new OfflineBundlePreflightError("payload_inventory_invalid");
      const [bytes, observed] = await Promise.all([
        readBoundedFile(file, offlineBundlePayloadMaxBytes),
        digestFile(file.path),
      ]);
      if (
        observed.byteLength !== entry.byteLength ||
        observed.sha256 !== entry.sha256
      ) {
        throw new OfflineBundlePreflightError("payload_hash_mismatch");
      }
      let value: unknown;
      try {
        value = JSON.parse(bytes.toString("utf8"));
      } catch {
        throw new OfflineBundlePreflightError("payload_inventory_invalid");
      }
      const records = sourceRecords(
        value,
        entry.feedKey,
        normalizeCsafDocuments,
        entry.path,
      );
      const parsed = records.map((record) =>
        vulnerabilityProviderRecordSchema.safeParse(record),
      );
      if (parsed.some((result) => !result.success)) {
        throw new OfflineBundlePreflightError("payload_inventory_invalid");
      }
      const providerRecords = parsed.map((result) =>
        result.success ? result.data : unreachable(),
      );
      if (providerRecords.some((record) => record.feedKey !== entry.feedKey)) {
        throw new OfflineBundlePreflightError("payload_inventory_invalid");
      }
      return {
        path: entry.path,
        feedKey: entry.feedKey,
        sourceSnapshotAt: entry.sourceSnapshotAt,
        schemaVersion: entry.schemaVersion,
        byteLength: observed.byteLength,
        sha256: observed.sha256,
        records: providerRecords,
      };
    }),
  );
}

function sourceRecords(
  value: unknown,
  feedKey: VulnerabilityOfflineBundleManifest["payloads"][number]["feedKey"],
  normalizeCsafDocuments: OfflineBundlePreflightService["configuration"]["normalizeCsafDocuments"],
  payloadPath: string,
): readonly unknown[] {
  if (feedKey === "vendor_csaf") {
    if (!normalizeCsafDocuments) {
      throw new OfflineBundlePreflightError("payload_inventory_invalid");
    }
    const documents = Array.isArray(value)
      ? value
      : value &&
          typeof value === "object" &&
          Array.isArray((value as { documents?: unknown }).documents)
        ? (value as { documents: unknown[] }).documents
        : [value];
    if (documents.length === 0) {
      throw new OfflineBundlePreflightError("payload_inventory_invalid");
    }
    return documents.flatMap((document) =>
      normalizeCsafDocuments({
        document,
        sourceUrl: `https://offline-bundle.invalid/${encodeURIComponent(payloadPath)}`,
      }),
    );
  }
  if (Array.isArray(value)) return value;
  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as { records?: unknown }).records)
  ) {
    return (value as { records: unknown[] }).records;
  }
  throw new OfflineBundlePreflightError("payload_inventory_invalid");
}

async function readBoundedFile(
  file: OfflineBundleUploadFile,
  maximum: number,
): Promise<Buffer> {
  if (file.size > maximum)
    throw new OfflineBundlePreflightError("payload_inventory_invalid");
  const bytes = await readFile(file.path);
  if (bytes.byteLength !== file.size || bytes.byteLength > maximum) {
    throw new OfflineBundlePreflightError("payload_inventory_invalid");
  }
  return bytes;
}

async function digestFile(
  path: string,
): Promise<Readonly<{ byteLength: number; sha256: string }>> {
  const hash = createHash("sha256");
  let byteLength = 0;
  for await (const chunk of createReadStream(path)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += bytes.byteLength;
    hash.update(bytes);
  }
  return { byteLength, sha256: hash.digest("hex") };
}

function parseKeyring(value: string | undefined): OfflineBundleTrustedKeyring {
  if (!value) throw new OfflineBundlePreflightError("untrusted_key");
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as { keys?: unknown }).keys)
    ) {
      throw new Error("invalid keyring");
    }
    const keys = (parsed as { keys: unknown[] }).keys;
    if (
      keys.some(
        (key) =>
          !key ||
          typeof key !== "object" ||
          typeof (key as { keyId?: unknown }).keyId !== "string" ||
          typeof (key as { publicKey?: unknown }).publicKey !== "string" ||
          !nullableText((key as { notBefore?: unknown }).notBefore) ||
          !nullableText((key as { notAfter?: unknown }).notAfter) ||
          !nullableText((key as { revokedAt?: unknown }).revokedAt),
      )
    ) {
      throw new Error("invalid keyring");
    }
    return parsed as OfflineBundleTrustedKeyring;
  } catch {
    throw new OfflineBundlePreflightError("untrusted_key");
  }
}

function mapVerificationError(
  error: BundleVerificationError,
): OfflineBundlePreflightError["code"] {
  switch (error.code) {
    case "bundle_key_untrusted":
    case "bundle_key_not_active":
      return "untrusted_key";
    case "bundle_incompatible":
      return "compatibility_incompatible";
    case "payload_hash_invalid":
    case "payload_size_invalid":
      return "payload_hash_mismatch";
    case "payload_inventory_invalid":
      return "payload_inventory_invalid";
    default:
      return "signature_invalid";
  }
}

async function cleanup(files: OfflineBundleUploadFiles): Promise<void> {
  const directories = new Set(
    [files.manifest, files.signature, ...files.payloads].map((file) =>
      dirname(file.path),
    ),
  );
  await Promise.all(
    [...directories]
      .filter((directory) =>
        basename(directory).startsWith("cra-vulnerability-bundle-"),
      )
      .map(async (directory) => {
        try {
          await rm(directory, { force: true, recursive: true });
        } catch {
          // Cleanup cannot reveal a host path or override a verification result.
        }
      }),
  );
}

function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function unreachable(): never {
  throw new OfflineBundlePreflightError("payload_inventory_invalid");
}
