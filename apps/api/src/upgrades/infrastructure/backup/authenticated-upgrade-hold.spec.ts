import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AuthenticatedUpgradeBackupHold,
  assertUpgradeCleanupAllowed,
  readAuthenticatedUpgradeHolds,
} from "./authenticated-upgrade-hold";
import type { BackupCertificate } from "../../../backups/application/backup-execution.port";

describe("upgrade repository hold", () => {
  let root: string;
  const id = (value: number) =>
    `${value.toString().repeat(8)}-1111-4111-8111-111111111111`;
  const authority = {
    instanceId: id(1),
    hostKey: Buffer.alloc(32, 7),
    journalBinding: "journal-1",
  };
  const input = {
    upgradeRunId: id(2),
    captureRunId: id(3),
    verifiedChildRunId: id(4),
    certificateDigest: "a".repeat(64),
  };
  const certificate = {
    instanceId: id(1),
    runId: id(3),
    certificateDigest: input.certificateDigest,
    baseRunId: id(5),
    keyId: "key-1",
    parts: [{ id: id(6), keyId: "key-2" }],
  } as unknown as BackupCertificate;
  const verified = jest.fn(() => Promise.resolve(undefined));
  const parts = jest.fn(() => Promise.resolve(undefined));
  const adapter = (overrides = {}) =>
    new AuthenticatedUpgradeBackupHold({
      ...authority,
      repositoryPath: root,
      loadCertificate: () => Promise.resolve(certificate),
      assertVerifiedChild: verified,
      authenticateParts: parts,
      ...overrides,
    });
  const signal = new AbortController().signal;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "upgrade-hold-"));
    verified.mockClear();
    parts.mockClear();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  it("pins the exact verified material, dependencies and all historical keys", async () => {
    const hold = await adapter().acquire(input, signal);
    expect(verified).toHaveBeenCalledWith(
      input.captureRunId,
      input.verifiedChildRunId,
      input.certificateDigest,
      signal,
    );
    expect(parts).toHaveBeenCalledWith(certificate, signal);
    expect(hold.dependencyRunIds).toEqual([id(3), id(4), id(5)]);
    expect(hold.keyIds).toEqual(["key-1", "key-2"]);
    expect(await adapter().acquire(input, signal)).toEqual(hold);
    expect(await adapter().assertHeld(id(2), signal)).toEqual(hold);
    await expect(
      assertUpgradeCleanupAllowed(root, id(5), [], authority),
    ).rejects.toThrow("required_dependency");
    await expect(
      assertUpgradeCleanupAllowed(root, id(7), [id(6)], authority),
    ).rejects.toThrow("required_dependency");
    await expect(
      assertUpgradeCleanupAllowed(root, id(7), [], authority),
    ).resolves.toBeUndefined();
    await adapter().release(id(2), signal);
    expect(await readAuthenticatedUpgradeHolds(root)).toEqual([]);
  });
  it("fails closed on missing authority, corrupted authentication and wrong binding", async () => {
    await adapter().acquire(input, signal);
    await expect(readAuthenticatedUpgradeHolds(root)).rejects.toThrow();
    await expect(
      readAuthenticatedUpgradeHolds(root, {
        ...authority,
        journalBinding: "other",
      }),
    ).rejects.toThrow();
    await expect(
      readAuthenticatedUpgradeHolds(root, {
        ...authority,
        hostKey: Buffer.alloc(32, 8),
      }),
    ).rejects.toThrow();
    const path = join(root, "upgrade-holds", `${id(2)}.json`);
    await writeFile(
      path,
      (await readFile(path, "utf8")).replace("key-2", "key-3"),
    );
    await expect(adapter().assertHeld(id(2), signal)).rejects.toThrow();
  });
  it("rejects competing publication, cross-instance, missing verification, unavailable keys and conflicting replay", async () => {
    await writeFile(join(root, ".publication.lock"), "occupied");
    await expect(adapter().acquire(input, signal)).rejects.toThrow("conflict");
    await rm(join(root, ".publication.lock"));
    await expect(
      adapter({ instanceId: id(8) }).acquire(input, signal),
    ).rejects.toThrow();
    await expect(
      adapter({
        assertVerifiedChild: async () => {
          await Promise.resolve();
          throw Error("unverified");
        },
      }).acquire(input, signal),
    ).rejects.toThrow("unverified");
    await expect(
      adapter({
        authenticateParts: async () => {
          await Promise.resolve();
          throw Error("key");
        },
      }).acquire(input, signal),
    ).rejects.toThrow("key");
    await adapter().acquire(input, signal);
    await expect(
      adapter().acquire({ ...input, verifiedChildRunId: id(8) }, signal),
    ).rejects.toThrow();
    await expect(
      adapter().acquire({ ...input, upgradeRunId: "../escape" }, signal),
    ).rejects.toThrow();
  });
  it("blocks unknown files and invalid shapes", async () => {
    await mkdir(join(root, "upgrade-holds"));
    await writeFile(join(root, "upgrade-holds", "unexpected"), "{}");
    await expect(
      readAuthenticatedUpgradeHolds(root, authority),
    ).rejects.toThrow();
  });
});
