import {
  AuthenticatedUpgradeBackupHold,
  type UpgradeHoldAuthority,
} from "../../../upgrades/infrastructure/backup/authenticated-upgrade-hold";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  rename,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  BackupCertificate,
  BackupEncryptedPart,
} from "../../application/backup-execution.port";
import { EncryptedBackupRepository } from "./encrypted-backup.repository";
import { ReviewedBackupRepositoryCleanup } from "./reviewed-backup-cleanup";

describe("reviewed repository cleanup", () => {
  let root: string;
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
  ];
  const instanceId = "44444444-4444-4444-8444-444444444444";
  const part = (id: string): BackupEncryptedPart => ({
    id,
    kind: "base",
    name: "base.tar",
    sha256: "a".repeat(64),
    bytes: 1,
    cipherSha256: "b".repeat(64),
    cipherBytes: 1,
  });
  let certificates: BackupCertificate[];
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "m15-cleanup-")));
    await mkdir(join(root, "parts"), { mode: 0o700 });
    await mkdir(join(root, "certificates"), { mode: 0o700 });
    certificates = ids.map((runId, index) => ({
      formatVersion: 1,
      instanceId,
      runId,
      repositoryGeneration: "generation",
      configurationRevision: 1,
      keyId: "key",
      capturedAt: "2026-10-14T00:00:00Z",
      checkpoint: {
        systemIdentifier: "123",
        timeline: 1,
        lsn: "0/1000000",
        postgresVersion: "17.6",
        restorePoint: "test",
      },
      parts: [part(ids[index]!)],
      inventoryDigest: "a".repeat(64),
      auditHeadsDigest: "b".repeat(64),
      certificateDigest: String(index).repeat(64),
    }));
    for (const certificate of certificates) {
      await writeFile(
        join(root, "parts", `${certificate.parts[0]!.id}.gpg`),
        "x",
        { mode: 0o600 },
      );
      await writeFile(
        join(root, "certificates", `${certificate.runId}.json`),
        JSON.stringify({ part: { id: certificate.runId, bytes: 1024 } }),
        { mode: 0o600 },
      );
    }
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const input = () => ({
    runId: ids[0]!,
    instanceId,
    retainedCaptureRunIds: ids.slice(1),
    verifiedBaseRunIds: ids.slice(1),
  });
  function cleanup(upgradeHoldAuthority?: UpgradeHoldAuthority) {
    return new ReviewedBackupRepositoryCleanup({
      repositoryPath: root,
      upgradeHoldAuthority,
      keyRepositories: [
        {
          loadCertificateInMemory: async (id: string) => {
            await Promise.resolve();
            const cert = certificates.find((c) => c.runId === id);
            if (!cert) throw Error();
            return cert;
          },
          partPath: (p: { id: string }) => join(root, "parts", `${p.id}.gpg`),
          openPartToSink: (p: { id: string }) =>
            readFile(join(root, "parts", `${p.id}.gpg`)).then(() => undefined),
        } as unknown as EncryptedBackupRepository,
      ],
    });
  }
  const authority = () => ({
    instanceId,
    journalBinding: "upgrade-journal",
    hostKey: Buffer.alloc(32, 7),
  });
  async function hold() {
    return new AuthenticatedUpgradeBackupHold({
      ...authority(),
      repositoryPath: root,
      loadCertificate: () => Promise.resolve(certificates[0]!),
      assertVerifiedChild: () => Promise.resolve(undefined),
      authenticateParts: () => Promise.resolve(undefined),
    }).acquire(
      {
        upgradeRunId: "55555555-5555-4555-8555-555555555555",
        captureRunId: ids[0]!,
        verifiedChildRunId: "66666666-6666-4666-8666-666666666666",
        certificateDigest: certificates[0]!.certificateDigest,
      },
      new AbortController().signal,
    );
  }
  it("protects verification metadata through its SQL commit and releases publication authority", async () => {
    await hold();
    await expect(
      cleanup(authority()).prepareProtection(
        "66666666-6666-4666-8666-666666666666",
        new AbortController().signal,
      ),
    ).rejects.toThrow("required_dependency");
    const protection = await cleanup(authority()).prepareProtection(
      "77777777-7777-4777-8777-777777777777",
      new AbortController().signal,
    );
    await expect(hold()).rejects.toThrow("conflict");
    await protection.commit(new AbortController().signal);
    await protection.commit(new AbortController().signal);
    const rolledBack = await cleanup(authority()).prepareProtection(
      "77777777-7777-4777-8777-777777777777",
      new AbortController().signal,
    );
    await rolledBack.rollback(new AbortController().signal);
    await rolledBack.rollback(new AbortController().signal);
    await expect(readFile(join(root, ".publication.lock"))).rejects.toThrow();
  });
  it("blocks held capture and unknown hold authority before prepare", async () => {
    await hold();
    await expect(
      cleanup(authority()).prepare(
        input(),
        new AbortController().signal,
        async () => {},
      ),
    ).rejects.toThrow("required_dependency");
    await expect(
      cleanup().prepare(input(), new AbortController().signal, async () => {}),
    ).rejects.toThrow("upgrade_hold_authority_unknown");
    expect(await readFile(join(root, "parts", `${ids[0]}.gpg`), "utf8")).toBe(
      "x",
    );
  });
  it("refuses a held recovery commit and preserves interrupted staged bytes", async () => {
    const prepared = await cleanup(authority()).prepare(
      input(),
      new AbortController().signal,
      async () => {},
    );
    // Simulates a host restart after staging, followed by an independently authenticated pin.
    await rm(join(root, ".publication.lock"));
    await hold();
    await expect(
      cleanup(authority()).recover(ids[0]!, true, new AbortController().signal),
    ).rejects.toThrow("required_dependency");
    await prepared.rollback(new AbortController().signal);
    expect(await readFile(join(root, "parts", `${ids[0]}.gpg`), "utf8")).toBe(
      "x",
    );
  });
  it("rechecks holds immediately before a prepared deletion commits", async () => {
    const prepared = await cleanup(authority()).prepare(
      input(),
      new AbortController().signal,
      async () => {},
    );
    await rm(join(root, ".publication.lock"));
    await hold();
    await expect(prepared.commit(new AbortController().signal)).rejects.toThrow(
      "required_dependency",
    );
    await prepared.rollback(new AbortController().signal);
  });
  it("stages reversible task-owned renames and preserves shared parts", async () => {
    certificates[1] = {
      ...certificates[1]!,
      parts: [...certificates[1]!.parts, certificates[0]!.parts[0]!],
    };
    const prepared = await cleanup().prepare(
      input(),
      new AbortController().signal,
      async () => {},
    );
    expect(await readFile(join(root, "parts", `${ids[0]}.gpg`), "utf8")).toBe(
      "x",
    );
    await prepared.rollback(new AbortController().signal);
    expect(
      await readFile(join(root, "certificates", `${ids[0]}.json`), "utf8"),
    ).toContain(ids[0]);
  });
  it("removes only unreferenced ciphertext after durable commit and keeps a digest tombstone", async () => {
    const prepared = await cleanup().prepare(
      input(),
      new AbortController().signal,
      async () => {},
    );
    await expect(
      readFile(join(root, "parts", `${ids[0]}.gpg`)),
    ).rejects.toThrow();
    await prepared.commit(new AbortController().signal);
    expect(await readFile(join(root, "parts", `${ids[1]}.gpg`), "utf8")).toBe(
      "x",
    );
  });
  it("blocks unknown manifests, insufficient independent verified bases and lost authority", async () => {
    await expect(
      cleanup().prepare(
        { ...input(), verifiedBaseRunIds: [] },
        new AbortController().signal,
        async () => {},
      ),
    ).rejects.toThrow("last_recoverable_chain");
    await expect(
      cleanup().prepare(
        {
          ...input(),
          retainedCaptureRunIds: [
            ...ids.slice(1),
            "55555555-5555-4555-8555-555555555555",
          ],
        },
        new AbortController().signal,
        async () => {},
      ),
    ).rejects.toThrow("repository_discontinuity");
    await expect(
      cleanup().prepare(input(), new AbortController().signal, async () => {
        await Promise.resolve();
        throw Error("revoked");
      }),
    ).rejects.toThrow("revoked");
  });
  it("rolls back an interrupted partial rename before returning failure", async () => {
    const extra = "55555555-5555-4555-8555-555555555555";
    certificates[0] = {
      ...certificates[0]!,
      parts: [
        ...certificates[0]!.parts,
        { ...part(extra), kind: "objects", name: "objects/extra" },
      ],
    };
    await writeFile(join(root, "parts", `${extra}.gpg`), "preserve", {
      mode: 0o600,
    });
    let checks = 0;
    await expect(
      cleanup().prepare(input(), new AbortController().signal, async () => {
        await Promise.resolve();
        checks += 1;
        if (checks === 4) throw Error("revoked");
      }),
    ).rejects.toThrow("revoked");
    expect(await readFile(join(root, "parts", `${ids[0]}.gpg`), "utf8")).toBe(
      "x",
    );
    expect(await readFile(join(root, "parts", `${extra}.gpg`), "utf8")).toBe(
      "preserve",
    );
  });
  it("blocks the latest authority checkpoint and unauthenticated repository inventory", async () => {
    await mkdir(join(root, "instances"), { mode: 0o700 });
    await writeFile(
      join(root, "instances", `${instanceId}.json`),
      JSON.stringify({ runId: ids[0] }),
    );
    await expect(
      cleanup().prepare(input(), new AbortController().signal, async () => {}),
    ).rejects.toThrow("required_dependency");
    await expect(
      new ReviewedBackupRepositoryCleanup({
        repositoryPath: root,
        keyRepositories: [],
      }).prepare(input(), new AbortController().signal, async () => {}),
    ).rejects.toThrow("repository_discontinuity");
  });
  it.each([false, true])(
    "recovers a task-owned interrupted intent using durable SQL committed=%s",
    async (committed) => {
      const transaction = join(
        root,
        "cleanup",
        `${ids[0]}-66666666-6666-4666-8666-666666666666`,
      );
      await mkdir(transaction, { recursive: true, mode: 0o700 });
      await rename(
        join(root, "parts", `${ids[0]}.gpg`),
        join(transaction, `${ids[0]}.gpg`),
      );
      await rename(
        join(root, "certificates", `${ids[0]}.json`),
        join(transaction, "receipt.json"),
      );
      await writeFile(
        join(transaction, "intent.json"),
        JSON.stringify({
          version: 1,
          runId: ids[0],
          certificateDigest: "a".repeat(64),
          parts: [ids[0]],
          receipt: true,
        }),
      );
      await writeFile(
        join(root, ".publication.lock"),
        JSON.stringify({ runId: ids[0], kind: "cleanup" }),
      );
      await cleanup().recover(ids[0]!, committed, new AbortController().signal);
      if (committed) {
        await expect(
          readFile(join(root, "parts", `${ids[0]}.gpg`)),
        ).rejects.toThrow();
        expect(
          await readFile(join(root, "tombstones", `${ids[0]}.json`), "utf8"),
        ).toContain("a".repeat(64));
      } else
        expect(
          await readFile(join(root, "parts", `${ids[0]}.gpg`), "utf8"),
        ).toBe("x");
    },
  );
  it("preserves WAL archive references and makes completion idempotent", async () => {
    const wal = "55555555-5555-4555-8555-555555555555";
    certificates[0] = {
      ...certificates[0]!,
      parts: [
        ...certificates[0]!.parts,
        { ...part(wal), kind: "wal", name: "000000010000000000000001" },
      ],
    };
    await writeFile(join(root, "parts", `${wal}.gpg`), "wal", { mode: 0o600 });
    const prepared = await cleanup().prepare(
      input(),
      new AbortController().signal,
      async () => {},
    );
    await prepared.commit(new AbortController().signal);
    await prepared.commit(new AbortController().signal);
    await prepared.rollback(new AbortController().signal);
    expect(await readFile(join(root, "parts", `${wal}.gpg`), "utf8")).toBe(
      "wal",
    );
    await expect(
      cleanup().prepare(
        { ...input(), runId: "../../bad" },
        new AbortController().signal,
        async () => {},
      ),
    ).rejects.toThrow("unsafe_identifier");
  });
  it("handles empty recovery, rejects malformed intents and preserves unrelated directories", async () => {
    await cleanup().recover(ids[0]!, false, new AbortController().signal);
    await mkdir(join(root, "cleanup", "unrelated"), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(join(root, "cleanup", "unrelated", "preserve"), "keep");
    await cleanup().recover(ids[0]!, false, new AbortController().signal);
    expect(
      await readFile(join(root, "cleanup", "unrelated", "preserve"), "utf8"),
    ).toBe("keep");
    const transaction = join(
      root,
      "cleanup",
      `${ids[0]}-66666666-6666-4666-8666-666666666666`,
    );
    await mkdir(transaction, { mode: 0o700 });
    await writeFile(
      join(transaction, "intent.json"),
      JSON.stringify({ version: 2, runId: ids[0], parts: [] }),
    );
    await expect(
      cleanup().recover(ids[0]!, false, new AbortController().signal),
    ).rejects.toThrow("repository_discontinuity");
  });
  it("refuses a simultaneous retirement and makes rollback idempotent", async () => {
    const prepared = await cleanup().prepare(
      input(),
      new AbortController().signal,
      async () => {},
    );
    await expect(
      cleanup().prepare(input(), new AbortController().signal, async () => {}),
    ).rejects.toThrow("conflict");
    await prepared.rollback(new AbortController().signal);
    await prepared.rollback(new AbortController().signal);
    await prepared.commit(new AbortController().signal);
  });
  it("never counts a missing retained base as a recoverable independent chain", async () => {
    await rm(join(root, "parts", `${ids[1]}.gpg`));
    await expect(
      cleanup().prepare(input(), new AbortController().signal, async () => {}),
    ).rejects.toThrow("last_recoverable_chain");
    expect(await readFile(join(root, "parts", `${ids[0]}.gpg`), "utf8")).toBe(
      "x",
    );
  });
  it("reviews several large inventory manifests while retaining only compact certificates", async () => {
    for (const runId of ids)
      await writeFile(
        join(root, "certificates", `${runId}.json`),
        JSON.stringify({ part: { id: runId, bytes: 11 * 1024 * 1024 } }),
      );
    const prepared = await cleanup().prepare(
      input(),
      new AbortController().signal,
      async () => {},
    );
    await prepared.rollback(new AbortController().signal);
    for (const runId of ids)
      expect(await readFile(join(root, "parts", `${runId}.gpg`), "utf8")).toBe(
        "x",
      );
  });
  it.each(["manifest", "metadata", "cumulative", "references"])(
    "bounds %s metadata before staging any retirement",
    async (mode) => {
      for (const runId of ids)
        await writeFile(
          join(root, "certificates", `${runId}.json`),
          JSON.stringify({
            part: {
              id: runId,
              bytes: mode === "manifest" ? 33 * 1024 * 1024 : 32 * 1024 * 1024,
            },
          }),
        );
      const load = jest.fn((runId: string) =>
        Promise.resolve({
          ...certificates[0]!,
          runId,
          parts: Array.from(
            { length: mode === "references" ? 25000 : 1 },
            () => ({
              ...certificates[0]!.parts[0]!,
              name:
                mode === "metadata"
                  ? "x".repeat(17 * 1024 * 1024)
                  : mode === "cumulative"
                    ? "x".repeat(9 * 1024 * 1024)
                    : "base.tar",
            }),
          ),
        }),
      );
      const authority = jest.fn(() => Promise.resolve());
      const adapter = new ReviewedBackupRepositoryCleanup({
        repositoryPath: root,
        keyRepositories: [
          {
            loadCertificateInMemory: load,
            openPartToSink: () => Promise.resolve(),
          } as unknown as EncryptedBackupRepository,
        ],
      });
      await expect(
        adapter.prepare(input(), new AbortController().signal, authority),
      ).rejects.toThrow("cleanup_capacity");
      expect(load).toHaveBeenCalledTimes(
        mode === "manifest" ? 0 : mode === "metadata" ? 1 : 2,
      );
      expect(authority).toHaveBeenCalledTimes(1);
      expect(await readFile(join(root, "parts", `${ids[0]}.gpg`), "utf8")).toBe(
        "x",
      );
      expect(
        await readFile(join(root, "certificates", `${ids[0]}.json`), "utf8"),
      ).toContain(ids[0]);
    },
  );
});
