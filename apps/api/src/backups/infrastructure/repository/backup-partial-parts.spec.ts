import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BackupEncryptedPart } from "../../application/backup-execution.port";
import {
  BackupPartialParts,
  consumeBackupRepositoryReviewBudget,
  readBackupReviewReceipt,
} from "./backup-partial-parts";

describe("task-owned unpublished ciphertext reconciliation", () => {
  let root: string;
  const instance = "11111111-1111-4111-8111-111111111111",
    run = "22222222-2222-4222-8222-222222222222",
    part = "33333333-3333-4333-8333-333333333333";
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "m15-partial-")));
    await mkdir(join(root, "parts"), { mode: 0o700 });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  it.each([NaN, -1, 0.5, Infinity])(
    "rejects invalid budget increments %s",
    (value) => {
      const current = { metadataBytes: 0, references: 0 };
      expect(() =>
        consumeBackupRepositoryReviewBudget(current, value, 0),
      ).toThrow("cleanup_capacity");
      expect(() =>
        consumeBackupRepositoryReviewBudget(current, 0, value),
      ).toThrow("cleanup_capacity");
      expect(current).toEqual({ metadataBytes: 0, references: 0 });
    },
  );
  it("bounds receipt reads and rejects untrusted manifest sizes before decryption", async () => {
    await mkdir(join(root, "certificates"), { mode: 0o700 });
    const name = `${run}.json`;
    const path = join(root, "certificates", name);
    for (const value of [
      { part: { id: "bad", bytes: 1 } },
      { part: { id: part, bytes: -1 } },
      { part: { id: part, bytes: 0.5 } },
    ]) {
      await writeFile(path, JSON.stringify(value));
      await expect(readBackupReviewReceipt(root, name)).rejects.toThrow(
        "repository_discontinuity",
      );
    }
    await writeFile(path, "x".repeat(8193));
    await expect(readBackupReviewReceipt(root, name)).rejects.toThrow(
      "repository_discontinuity",
    );
  });
  it("accepts sequential 11 MiB manifests when only compact metadata remains in memory", async () => {
    const load = jest.fn(() => Promise.resolve({ parts: [] }));
    const journal = new BackupPartialParts(root, instance, {
      loadCertificateInMemory: load,
    });
    await journal.record(part, run);
    await writeFile(join(root, "parts", `${part}.gpg`), "abandoned");
    await mkdir(join(root, "certificates"), { mode: 0o700 });
    for (let index = 0; index < 5; index++) {
      const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`;
      await writeFile(
        join(root, "certificates", `${id}.json`),
        JSON.stringify({ part: { id, bytes: 11 * 1024 * 1024 } }),
      );
    }
    expect(
      await journal.reconcile(
        () => Promise.resolve(true),
        new AbortController().signal,
      ),
    ).toBe(1);
    expect(load).toHaveBeenCalledTimes(5);
    await expect(
      readFile(join(root, "parts", `${part}.gpg`)),
    ).rejects.toThrow();
  });
  it.each(["manifest", "metadata", "cumulative", "references"])(
    "bounds %s metadata before removing unpublished bytes",
    async (mode) => {
      const load = jest.fn(() =>
        Promise.resolve({
          parts: Array.from(
            { length: mode === "references" ? 25000 : 1 },
            (): BackupEncryptedPart => ({
              id: instance,
              kind: "base",
              name:
                mode === "metadata"
                  ? "x".repeat(17 * 1024 * 1024)
                  : mode === "cumulative"
                    ? "x".repeat(9 * 1024 * 1024)
                    : "base.tar",
              bytes: 1,
              sha256: "a".repeat(64),
              cipherBytes: 1,
              cipherSha256: "b".repeat(64),
            }),
          ),
        }),
      );
      const journal = new BackupPartialParts(root, instance, {
        loadCertificateInMemory: load,
      });
      await journal.record(part, run);
      await writeFile(join(root, "parts", `${part}.gpg`), "preserve");
      await mkdir(join(root, "certificates"), { mode: 0o700 });
      for (const id of [instance, run])
        await writeFile(
          join(root, "certificates", `${id}.json`),
          JSON.stringify({
            part: {
              id: instance,
              bytes: mode === "manifest" ? 33 * 1024 * 1024 : 32 * 1024 * 1024,
            },
          }),
        );
      const authority = jest.fn(() => Promise.resolve(true));
      await expect(
        journal.reconcile(authority, new AbortController().signal),
      ).rejects.toThrow("cleanup_capacity");
      expect(load).toHaveBeenCalledTimes(
        mode === "manifest" ? 0 : mode === "metadata" ? 1 : 2,
      );
      expect(authority).not.toHaveBeenCalled();
      expect(await readFile(join(root, "parts", `${part}.gpg`), "utf8")).toBe(
        "preserve",
      );
      expect(
        await readFile(join(root, "owners", `${part}.json`), "utf8"),
      ).toContain(part);
    },
  );
  it("removes only owned unpublished bytes after exact source terminal proof", async () => {
    const journal = new BackupPartialParts(root, instance, {
      loadCertificateInMemory: jest.fn(),
    });
    await journal.record(part, run);
    await writeFile(join(root, "parts", `${part}.gpg`), "ciphertext", {
      mode: 0o600,
    });
    expect(
      await journal.reconcile(
        () => Promise.resolve(false),
        new AbortController().signal,
      ),
    ).toBe(0);
    expect(await readFile(join(root, "parts", `${part}.gpg`), "utf8")).toBe(
      "ciphertext",
    );
    expect(
      await journal.reconcile(
        () => Promise.resolve(true),
        new AbortController().signal,
      ),
    ).toBe(1);
    await expect(
      readFile(join(root, "parts", `${part}.gpg`)),
    ).rejects.toThrow();
  });
  it("preserves every authenticated retained reference and blocks unknown manifests", async () => {
    const reader = {
      loadCertificateInMemory: jest
        .fn()
        .mockResolvedValue({ parts: [{ id: part }] }),
    };
    const journal = new BackupPartialParts(root, instance, reader);
    await journal.record(part, run);
    await writeFile(join(root, "parts", `${part}.gpg`), "ciphertext");
    await mkdir(join(root, "certificates"), { mode: 0o700 });
    await writeFile(
      join(root, "certificates", `${run}.json`),
      JSON.stringify({ part: { id: part, bytes: 1024 } }),
    );
    expect(
      await journal.reconcile(
        () => Promise.resolve(true),
        new AbortController().signal,
      ),
    ).toBe(0);
    expect(await readFile(join(root, "parts", `${part}.gpg`), "utf8")).toBe(
      "ciphertext",
    );
    await journal.record(part, run);
    reader.loadCertificateInMemory.mockRejectedValue(Error("unavailable"));
    await expect(
      journal.reconcile(
        () => Promise.resolve(true),
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(await readFile(join(root, "parts", `${part}.gpg`), "utf8")).toBe(
      "ciphertext",
    );
  });
  it("treats absent/empty journals as empty and never removes a caller-held publication fence", async () => {
    const journal = new BackupPartialParts(root, instance, {
      loadCertificateInMemory: jest.fn(),
    });
    expect(
      await journal.reconcile(
        () => Promise.resolve(true),
        new AbortController().signal,
      ),
    ).toBe(0);
    await journal.record(part, run);
    await journal.discard([part]);
    expect(
      await journal.reconcile(
        () => Promise.resolve(true),
        new AbortController().signal,
      ),
    ).toBe(0);
    await journal.record(part, run);
    await writeFile(join(root, ".publication.lock"), "held");
    await expect(
      journal.reconcile(
        () => Promise.resolve(true),
        new AbortController().signal,
      ),
    ).rejects.toThrow("conflict");
    expect(
      await journal.reconcile(
        () => Promise.resolve(true),
        new AbortController().signal,
        true,
      ),
    ).toBe(1);
    expect(await readFile(join(root, ".publication.lock"), "utf8")).toBe(
      "held",
    );
  });
  it("rejects malformed identities, cancellation, source changes and unsafe storage entries", async () => {
    const journal = new BackupPartialParts(root, instance, {
      loadCertificateInMemory: jest.fn(),
    });
    await expect(journal.record("../../bad", run)).rejects.toThrow(
      "unsafe_identifier",
    );
    await journal.record(part, run);
    await writeFile(join(root, "parts", `${part}.gpg`), "preserve");
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      journal.reconcile(() => Promise.resolve(true), aborted.signal),
    ).rejects.toThrow();
    let count = 0;
    expect(
      await journal.reconcile(
        () => Promise.resolve(++count === 1),
        new AbortController().signal,
      ),
    ).toBe(0);
    expect(await readFile(join(root, "parts", `${part}.gpg`), "utf8")).toBe(
      "preserve",
    );
    await writeFile(
      join(root, "owners", `${part}.json`),
      JSON.stringify({
        version: 2,
        runId: run,
        partId: part,
        instanceId: instance,
      }),
    );
    await expect(
      journal.reconcile(
        () => Promise.resolve(true),
        new AbortController().signal,
      ),
    ).rejects.toThrow("repository_discontinuity");
  });
  it("preserves another instance and rejects linked partial files without touching their targets", async () => {
    const reader = { loadCertificateInMemory: jest.fn() };
    const journal = new BackupPartialParts(root, instance, reader);
    await journal.record(part, run);
    const other = new BackupPartialParts(
      root,
      "44444444-4444-4444-8444-444444444444",
      reader,
    );
    expect(
      await other.reconcile(
        () => Promise.resolve(true),
        new AbortController().signal,
      ),
    ).toBe(0);
    const outside = join(root, "preserve");
    await writeFile(outside, "safe");
    await symlink(outside, join(root, "parts", `${part}.gpg`));
    await expect(
      journal.reconcile(
        () => Promise.resolve(true),
        new AbortController().signal,
      ),
    ).rejects.toThrow("repository_discontinuity");
    expect(await readFile(outside, "utf8")).toBe("safe");
  });
});
