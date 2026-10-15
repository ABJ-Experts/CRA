import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  mkdir,
  symlink,
  readdir,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { EncryptedBackupRepository } from "./encrypted-backup.repository";
import {
  backupDigest,
  canonicalBackupJson,
} from "./encrypted-backup.repository";
import type {
  BackupCertificate,
  BackupInventory,
} from "../../application/backup-execution.port";
import { createHash } from "node:crypto";

jest.setTimeout(30_000);

describe("encrypted backup repository", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "m15-05-repo-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const signal = () => new AbortController().signal;
  async function setup() {
    const repository = join(root, "repository");
    const key = join(root, "key");
    await mkdir(repository, { mode: 0o700 });
    await writeFile(key, "synthetic-test-only-backup-key\n", { mode: 0o600 });
    return new EncryptedBackupRepository({
      repository,
      keyFile: key,
      keyId: "fixture-key",
      gpgBinary: "gpg",
      maximumPartBytes: 1024 * 1024,
    });
  }
  it("publishes authenticated ciphertext and verifies full plaintext before returning", async () => {
    const repository = await setup();
    const part = await repository.sealPart(
      "11111111-1111-4111-8111-111111111111",
      "inventory",
      "inventory.json",
      Readable.from(['{"secret":"fixture-canary"}']),
      signal(),
    );
    expect(part.bytes).toBe(27);
    const bytes = await readFile(repository.partPath(part));
    expect(bytes.includes(Buffer.from("fixture-canary"))).toBe(false);
    const output = join(root, "decrypted");
    await repository.openPart(part, output, signal());
    expect(await readFile(output, "utf8")).toContain("fixture-canary");
  });
  it("rejects path traversal before touching disk", async () => {
    const repository = await setup();
    await expect(
      repository.sealPart(
        "../../bad",
        "base",
        "base.tar",
        Readable.from(["x"]),
        signal(),
      ),
    ).rejects.toThrow("unsafe_identifier");
  });
  it("rejects a historical key inside ciphertext custody through an aliased parent directory", async () => {
    const repository = await setup();
    const part = await repository.sealPart(
      "11111111-1111-4111-8111-111111111111",
      "wal",
      "wal",
      Readable.from(["historical"]),
      signal(),
    );
    await writeFile(
      join(root, "repository", "in-repository-key"),
      "synthetic-test-only-backup-key\n",
      { mode: 0o600 },
    );
    await symlink(join(root, "repository"), join(root, "alias"));
    const rotated = new EncryptedBackupRepository({
      repository: join(root, "repository"),
      keyFile: join(root, "key"),
      keyId: "current",
      keyFilesById: { "fixture-key": join(root, "alias", "in-repository-key") },
      gpgBinary: "gpg",
      maximumPartBytes: 1024 * 1024,
    });
    await expect(
      rotated.openPart(part, join(root, "out"), signal()),
    ).rejects.toThrow("unsafe_key_mount");
    await expect(readFile(join(root, "out"))).rejects.toThrow();
  });
  it("rejects corrupt ciphertext without publishing plaintext", async () => {
    const repository = await setup();
    const part = await repository.sealPart(
      "11111111-1111-4111-8111-111111111111",
      "base",
      "base.tar",
      Readable.from(["fixture"]),
      signal(),
    );
    await writeFile(repository.partPath(part), "corrupt");
    await expect(
      repository.openPart(part, join(root, "out"), signal()),
    ).rejects.toThrow("ciphertext_integrity");
  });
  it("bounds parts, rejects cancelled work and rejects permissive key mounts", async () => {
    const repository = await setup();
    await expect(
      repository.sealPart(
        "11111111-1111-4111-8111-111111111111",
        "base",
        "base.tar",
        Readable.from([Buffer.alloc(1024 * 1024 + 1)]),
        signal(),
      ),
    ).rejects.toThrow("part_limit");
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      repository.sealPart(
        "11111111-1111-4111-8111-111111111111",
        "base",
        "base.tar",
        Readable.from(["x"]),
        aborted.signal,
      ),
    ).rejects.toThrow();
    const unsafe = join(root, "unsafe-key");
    await writeFile(unsafe, "x", { mode: 0o644 });
    const invalid = new EncryptedBackupRepository({
      repository: join(root, "repository"),
      keyFile: unsafe,
      keyId: "bad",
      gpgBinary: "gpg",
      maximumPartBytes: 1e6,
    });
    await expect(
      invalid.sealPart(
        "11111111-1111-4111-8111-111111111111",
        "base",
        "base.tar",
        Readable.from(["x"]),
        signal(),
      ),
    ).rejects.toThrow("unsafe_key_mount");
  });
  it("seals immutable external certificates and authenticates reload against the selected capture", async () => {
    const repository = await setup();
    const inventory: BackupInventory = {
      catalog: { schema: "fixture" },
      auditHeads: [],
      objects: [],
      externalKeyChecks: [],
    };
    const unsigned = {
      formatVersion: 1 as const,
      instanceId: "22222222-2222-4222-8222-222222222222",
      runId: "11111111-1111-4111-8111-111111111111",
      repositoryGeneration: "generation-1",
      configurationRevision: 1,
      keyId: "fixture-key",
      capturedAt: "2026-10-14T00:00:00.000Z",
      checkpoint: {
        systemIdentifier: "123",
        timeline: 1,
        lsn: "0/1000000",
        postgresVersion: "17.6" as const,
        restorePoint: "fixture",
      },
      parts: [],
      inventoryDigest: backupDigest(inventory),
      auditHeadsDigest: backupDigest([]),
    };
    const certificate: BackupCertificate = {
      ...unsigned,
      certificateDigest: backupDigest(unsigned),
    };
    expect(
      await repository.latestCertificate(
        certificate.instanceId,
        root,
        signal(),
      ),
    ).toBeNull();
    await repository.sealCertificate(certificate, inventory, signal());
    expect(
      await repository.latestCertificate(
        certificate.instanceId,
        root,
        signal(),
      ),
    ).toEqual(certificate);
    expect(
      await repository.latestCertificate(
        certificate.instanceId,
        null,
        signal(),
      ),
    ).toEqual(certificate);
    expect(
      await repository.loadCertificate(certificate.runId, root, signal()),
    ).toEqual(certificate);
    const opened = await repository.openCertificate(
      { certificate, parentRunId: certificate.runId },
      root,
      signal(),
    );
    expect(opened.inventory).toEqual(inventory);
    await expect(
      repository.openCertificate(
        {
          certificate: { ...certificate, certificateDigest: "a".repeat(64) },
          parentRunId: certificate.runId,
        },
        root,
        signal(),
      ),
    ).rejects.toThrow("certificate_integrity");
    await expect(
      repository.sealCertificate(
        { ...certificate, inventoryDigest: "b".repeat(64) },
        inventory,
        signal(),
      ),
    ).rejects.toThrow("certificate_integrity");
    expect(canonicalBackupJson({ z: 1, a: [true, null] })).toBe(
      '{"a":[true,null],"z":1}',
    );
  });
  it("rejects an unreadable multi-byte manifest before any ciphertext or authority publication", async () => {
    const repository = await setup();
    const inventory: BackupInventory = {
      catalog: { schema: "é".repeat(17 * 1024 * 1024) },
      auditHeads: [],
      objects: [],
      externalKeyChecks: [],
    };
    const unsigned = {
      formatVersion: 1 as const,
      instanceId: "22222222-2222-4222-8222-222222222222",
      runId: "11111111-1111-4111-8111-111111111111",
      repositoryGeneration: "generation-1",
      configurationRevision: 1,
      keyId: "fixture-key",
      capturedAt: "2026-10-14T00:00:00.000Z",
      checkpoint: {
        systemIdentifier: "123",
        timeline: 1,
        lsn: "0/1000000",
        postgresVersion: "17.6" as const,
        restorePoint: "fixture",
      },
      parts: [],
      inventoryDigest: backupDigest(inventory),
      auditHeadsDigest: backupDigest([]),
    };
    const certificate: BackupCertificate = {
      ...unsigned,
      certificateDigest: backupDigest(unsigned),
    };
    const canonical = canonicalBackupJson({ certificate, inventory });
    expect(canonical.length).toBeLessThan(32 * 1024 * 1024);
    expect(Buffer.byteLength(canonical, "utf8")).toBeGreaterThan(
      32 * 1024 * 1024,
    );
    const seal = jest
      .spyOn(repository, "sealPart")
      .mockRejectedValue(Error("ciphertext_must_not_be_started"));
    await expect(
      repository.sealCertificate(certificate, inventory, signal()),
    ).rejects.toThrow("insufficient_capacity");
    expect(seal).not.toHaveBeenCalled();
    expect(await readdir(join(root, "repository"))).toEqual([]);
    for (const relative of [
      ["certificates", `${certificate.runId}.json`],
      ["instances", `${certificate.instanceId}.json`],
      ["parts"],
    ])
      await expect(
        readFile(join(root, "repository", ...relative)),
      ).rejects.toThrow();
  });
  it("rejects legacy oversized manifests consistently across all readers before decryption", async () => {
    const repository = await setup();
    const runId = "11111111-1111-4111-8111-111111111111";
    await mkdir(join(root, "repository", "certificates"), { mode: 0o700 });
    await writeFile(
      join(root, "repository", "certificates", `${runId}.json`),
      JSON.stringify({
        part: { bytes: 32 * 1024 * 1024 + 1 },
        certificateDigest: "a".repeat(64),
      }),
    );
    const openPart = jest
      .spyOn(repository, "openPart")
      .mockRejectedValue(Error("decryption_must_not_start"));
    const sink = jest
      .spyOn(repository, "openPartToSink")
      .mockRejectedValue(Error("decryption_must_not_start"));
    await expect(
      repository.loadCertificateInMemory(runId, signal()),
    ).rejects.toThrow("certificate_integrity");
    await expect(
      repository.loadCertificate(runId, root, signal()),
    ).rejects.toThrow("certificate_integrity");
    await expect(
      repository.openCertificate(
        {
          parentRunId: runId,
          certificate: {
            certificateDigest: "a".repeat(64),
          } as BackupCertificate,
        },
        root,
        signal(),
      ),
    ).rejects.toThrow("certificate_integrity");
    expect(openPart).not.toHaveBeenCalled();
    expect(sink).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual(["key", "repository"]);
  });
  it("rejects forged sizes, existing destinations and a wrong recovery key", async () => {
    const repository = await setup();
    const part = await repository.sealPart(
      "11111111-1111-4111-8111-111111111111",
      "base",
      "base.tar",
      Readable.from(["fixture"]),
      signal(),
    );
    await expect(
      repository.openPart({ ...part, bytes: NaN }, join(root, "bad"), signal()),
    ).rejects.toThrow("ciphertext_integrity");
    await writeFile(join(root, "exists"), "preserve");
    await expect(
      repository.openPart(part, join(root, "exists"), signal()),
    ).rejects.toThrow("decryption_failed");
    expect(await readFile(join(root, "exists"), "utf8")).toBe("preserve");
    await writeFile(join(root, "key"), "different-test-only-backup-key\n", {
      mode: 0o600,
    });
    await expect(
      repository.openPart(part, join(root, "wrong"), signal()),
    ).rejects.toThrow();
  });
  it("opens historical ciphertext after key rotation only through an explicitly mounted historical key", async () => {
    const original = await setup();
    const part = await original.sealPart(
      "11111111-1111-4111-8111-111111111111",
      "wal",
      "000000010000000000000001",
      Readable.from(["retained-history"]),
      signal(),
    );
    const rotatedKey = join(root, "key-v2");
    await writeFile(rotatedKey, "synthetic-rotated-test-key\n", {
      mode: 0o600,
    });
    const configuration = {
      repository: join(root, "repository"),
      keyFile: rotatedKey,
      keyId: "rotated-v2",
      gpgBinary: "gpg",
      maximumPartBytes: 1e6,
    };
    const missing = new EncryptedBackupRepository(configuration);
    await expect(
      missing.openPart(part, join(root, "missing-history"), signal()),
    ).rejects.toThrow("historical_key_unavailable");
    const rotated = new EncryptedBackupRepository({
      ...configuration,
      keyFilesById: { "fixture-key": join(root, "key") },
    });
    await rotated.openPart(part, join(root, "historical"), signal());
    expect(await readFile(join(root, "historical"), "utf8")).toBe(
      "retained-history",
    );
    expect(part.keyId).toBe("fixture-key");
  });
  it("fences repository publication and reclaims only a provably dead, source-confirmed owner", async () => {
    const repository = await setup();
    const run = "11111111-1111-4111-8111-111111111111";
    const release = await repository.acquirePublicationLease(run);
    await expect(
      repository.acquirePublicationLease(run, () => Promise.resolve(true)),
    ).rejects.toThrow("conflict");
    await release();
    await writeFile(
      join(root, "repository", ".publication.lock"),
      JSON.stringify({
        runId: run,
        kind: "capture",
        host: hostname(),
        pid: 2147483647,
      }),
      { mode: 0o600 },
    );
    const recovered = await repository.acquirePublicationLease(run, () =>
      Promise.resolve(true),
    );
    await recovered();
    expect(
      await repository.latestCertificate(
        "22222222-2222-4222-8222-222222222222",
        null,
        signal(),
      ),
    ).toBeNull();
  });
  it("authenticates ciphertext even when a corrupted file has a matching transport digest", async () => {
    const repository = await setup();
    const part = await repository.sealPart(
      "11111111-1111-4111-8111-111111111111",
      "base",
      "base.tar",
      Readable.from(["synthetic-integrity-canary"]),
      signal(),
    );
    const corrupted = await readFile(repository.partPath(part));
    corrupted[corrupted.length - 5] = corrupted[corrupted.length - 5]! ^ 1;
    await writeFile(repository.partPath(part), corrupted);
    await expect(
      repository.openPart(
        {
          ...part,
          cipherSha256: createHash("sha256").update(corrupted).digest("hex"),
        },
        join(root, "not-authenticated"),
        signal(),
      ),
    ).rejects.toThrow();
    await expect(readFile(join(root, "not-authenticated"))).rejects.toThrow();
  });
});
