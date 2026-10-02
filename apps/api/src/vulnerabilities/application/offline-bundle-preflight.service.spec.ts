import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type {
  VulnerabilityOfflineBundleImport,
  VulnerabilityOfflineBundleManifest,
  VulnerabilityProviderRecord,
} from "@repo/contracts/vulnerabilities";

import { OfflineBundleImportUseCases } from "./offline-bundle-import-use-cases";
import {
  OfflineBundlePreflightService,
  type OfflineBundleUploadFile,
} from "./offline-bundle-preflight.service";
import { canonicalBundleManifest } from "./offline-bundle-verifier";

const instant = "2026-08-27T00:00:00.000Z";

describe("OfflineBundlePreflightService", () => {
  it("stages only verified normalized records and removes temporary upload files", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "cra-vulnerability-bundle-"),
    );
    const keypair = generateKeyPairSync("ed25519");
    const record = providerRecord();
    const payloadBytes = Buffer.from(JSON.stringify([record]));
    const manifest: VulnerabilityOfflineBundleManifest = {
      format: "cra.vulnerability.offline-bundle",
      schemaVersion: "1.0",
      bundleVersion: "1.0.0",
      createdAt: instant,
      signingKeyId: "offline-root",
      compatibility: {
        minimumApplicationVersion: "1.0.0",
        maximumApplicationVersionExclusive: "2.0.0",
      },
      payloads: [
        {
          path: "vendor/nvd.json",
          feedKey: "nvd",
          schemaVersion: "1.0",
          sourceSnapshotAt: instant,
          byteLength: payloadBytes.byteLength,
          sha256: sha256(payloadBytes),
        },
      ],
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    const signature = sign(
      null,
      Buffer.from(
        `CRA-VULNERABILITY-BUNDLE-V1\n${canonicalBundleManifest(manifest)}`,
      ),
      keypair.privateKey,
    );
    const files = {
      manifest: await writeUpload(directory, "manifest", manifestBytes),
      signature: await writeUpload(directory, "signature", signature),
      payloads: [await writeUpload(directory, "vendor/nvd.json", payloadBytes)],
    };
    const stage = jest.fn().mockResolvedValue(undefined);
    const get = jest.fn().mockResolvedValue(bundleImport(manifest));
    const imports = {
      preflight: jest.fn().mockResolvedValue({
        import: bundleImport(manifest),
        runs: [{ id: "c0a80168-0000-4000-8000-000000000010", feedKey: "nvd" }],
      }),
      stage,
      completeStaging: jest.fn().mockResolvedValue(undefined),
      get,
    } as unknown as OfflineBundleImportUseCases;
    const service = new OfflineBundlePreflightService(imports, {
      applicationVersion: "1.1.0",
      trustedKeyringJson: JSON.stringify({
        keys: [
          {
            keyId: "offline-root",
            publicKey: keypair.publicKey
              .export({ format: "pem", type: "spki" })
              .toString(),
            notBefore: "2026-01-01T00:00:00.000Z",
            notAfter: "2027-01-01T00:00:00.000Z",
            revokedAt: null,
          },
        ],
      }),
    });

    await expect(
      service.preflight({
        files,
        actorId: "c0a80168-0000-4000-8000-000000000002",
        idempotencyKey: "c0a80168-0000-4000-8000-000000000003",
        correlationId: "c0a80168-0000-4000-8000-000000000004",
      }),
    ).resolves.toEqual(bundleImport(manifest));

    expect(stage).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "c0a80168-0000-4000-8000-000000000010",
        record,
      }),
    );
    expect(get).toHaveBeenCalledWith(bundleImport(manifest).id);
    await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function writeUpload(
  directory: string,
  name: string,
  bytes: Buffer,
): Promise<OfflineBundleUploadFile> {
  const path = join(directory, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  return { path, originalname: name, size: bytes.byteLength };
}

function providerRecord(): VulnerabilityProviderRecord {
  const rawPayload = { id: "CVE-2026-0001" };
  return {
    feedKey: "nvd",
    sourceRecordId: "CVE-2026-0001",
    canonicalId: "CVE-2026-0001",
    aliases: [],
    title: "Example",
    description: null,
    sourceUrl: "https://example.test/CVE-2026-0001",
    publishedAt: instant,
    upstreamUpdatedAt: instant,
    withdrawnAt: null,
    status: "active",
    affectedRanges: [],
    references: [],
    enrichment: {},
    rawPayload,
    rawPayloadSha256: sha256(Buffer.from(JSON.stringify(rawPayload))),
  };
}

function bundleImport(
  manifest: VulnerabilityOfflineBundleManifest,
): VulnerabilityOfflineBundleImport {
  return {
    id: "c0a80168-0000-4000-8000-000000000001",
    status: "awaiting_confirmation",
    bundleSha256: sha256(Buffer.from(canonicalBundleManifest(manifest))),
    manifest,
    signature: {
      algorithm: "Ed25519",
      keyId: "offline-root",
      status: "verified",
      verifiedAt: instant,
    },
    compatibility: { status: "compatible", reason: null },
    estimatedChanges: {
      recordsToCreate: 0,
      recordsToUpdate: 0,
      recordsToWithdraw: 0,
    },
    sourceSnapshotAt: instant,
    sourceSnapshotAgeSeconds: 0,
    failureCode: null,
    createdAt: instant,
    updatedAt: instant,
    completedAt: null,
  };
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
