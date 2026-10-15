/* eslint-disable @typescript-eslint/require-await -- Promise-based boundary doubles resolve immediately. */
import {
  mkdtemp,
  mkdir,
  writeFile,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackupMountedRuntime } from "../capture/backup-mounted-runtime";
import { NativeBackupControlTransaction } from "./native-backup-control-transaction";
import {
  NativeBackupCleanupAdapter,
  createCleanupRepositoryFactory,
} from "./native-backup-cleanup.adapter";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const request = {
  instanceId: id(1),
  runId: id(2),
  actor: "operator:verified",
  workerId: "worker",
  expectedVersion: 2,
  reviewFingerprint: "a".repeat(64),
  idempotencyKey: id(3),
  sourceAlias: "source",
  repositoryAlias: "repository",
};
const runtime = {
  sources: {
    source: {
      databaseContainer: "source",
      databaseName: "postgres",
      databaseUser: "postgres",
    },
  },
  repositories: {
    repository: { path: "/encrypted-repository", offHost: true },
  },
} as unknown as BackupMountedRuntime;
describe("reviewed native encrypted backup cleanup", () => {
  afterEach(() => jest.restoreAllMocks());
  function fixture() {
    const order: string[] = [];
    const run: {
      version: number;
      kind: "capture" | "verification";
      certificate: Record<string, never> | null;
    } = { version: 3, kind: "capture", certificate: {} };
    const transaction = {
      execute: jest.fn(
        async (_i: string, _a: string, action: string): Promise<unknown> => {
          order.push(action);
          if (action === "cleanup/authorize")
            return {
              run,
              retainedCaptureRunIds: [id(4), id(5)],
              verifiedBaseRunIds: [id(4), id(5)],
            };
          if (action === "cleanup/review")
            return {
              eligible: true,
              reviewFingerprint: request.reviewFingerprint,
            };
          return run;
        },
      ),
      commit: jest.fn(async () => {
        order.push("sql_commit");
      }),
      rollback: jest.fn(async () => {
        order.push("sql_rollback");
      }),
      close: jest.fn(async () => {
        order.push("close");
      }),
    };
    jest
      .spyOn(NativeBackupControlTransaction, "open")
      .mockResolvedValue(
        transaction as unknown as NativeBackupControlTransaction,
      );
    const plan = {
      commit: jest.fn(async () => {
        order.push("delete_ciphertext");
      }),
      rollback: jest.fn(async () => {
        order.push("restore_ciphertext");
      }),
    };
    const repository = {
      prepare: jest.fn(
        async (
          _input: unknown,
          _signal: AbortSignal,
          authority: () => Promise<void>,
        ) => {
          order.push("prepare");
          await authority();
          return plan;
        },
      ),
    };
    return {
      order,
      transaction,
      plan,
      repository,
      adapter: new NativeBackupCleanupAdapter(runtime, () => repository),
    };
  }
  it("holds database authority through reversible retirement and commits audit before final deletion", async () => {
    const t = fixture();
    await expect(
      t.adapter.cleanup(request, new AbortController().signal),
    ).resolves.toEqual({ version: 3, kind: "capture", certificate: {} });
    expect(t.order).toEqual([
      "cleanup/authorize",
      "prepare",
      "cleanup/review",
      "cleanup/review",
      "cleanup/finish",
      "sql_commit",
      "delete_ciphertext",
      "close",
    ]);
    expect(t.repository.prepare).toHaveBeenCalledWith(
      {
        instanceId: id(1),
        runId: id(2),
        retainedCaptureRunIds: [id(4), id(5)],
        verifiedBaseRunIds: [id(4), id(5)],
      },
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(t.plan.rollback).not.toHaveBeenCalled();
  });
  it("restores ciphertext if database finish or COMMIT fails", async () => {
    for (const phase of ["finish", "commit"]) {
      const t = fixture();
      if (phase === "finish") {
        const original = t.transaction.execute.getMockImplementation()!;
        t.transaction.execute.mockImplementation(async (...args) => {
          if (args[2] === "cleanup/finish")
            throw new Error("audit unavailable");
          return original(...args);
        });
      } else
        t.transaction.commit.mockRejectedValue(new Error("connection lost"));
      await expect(
        t.adapter.execute(request, new AbortController().signal),
      ).rejects.toThrow("cleanup_failed");
      expect(t.plan.rollback).toHaveBeenCalled();
      expect(t.plan.commit).not.toHaveBeenCalled();
      expect(t.transaction.rollback).toHaveBeenCalled();
    }
  });
  it("fails closed when review authority changes", async () => {
    const t = fixture();
    const original = t.transaction.execute.getMockImplementation()!;
    t.transaction.execute.mockImplementation(async (...args) =>
      args[2] === "cleanup/review"
        ? { eligible: false, reviewFingerprint: request.reviewFingerprint }
        : original(...args),
    );
    await expect(
      t.adapter.execute(request, new AbortController().signal),
    ).rejects.toThrow("cleanup_failed");
    expect(t.transaction.commit).not.toHaveBeenCalled();
    expect(t.plan.commit).not.toHaveBeenCalled();
  });
  it.each(["verification", "uncertified"])(
    "retires %s metadata without inventing a repository artifact",
    async (kind) => {
      const t = fixture();
      const original = t.transaction.execute.getMockImplementation()!;
      t.transaction.execute.mockImplementation(async (...args) => {
        const value = await original(...args);
        return args[2] === "cleanup/authorize"
          ? {
              retainedCaptureRunIds: [id(4), id(5)],
              verifiedBaseRunIds: [id(4), id(5)],
              run: {
                version: 3,
                kind:
                  kind === "verification"
                    ? ("verification" as const)
                    : ("capture" as const),
                certificate: null,
              },
            }
          : value;
      });
      await t.adapter.cleanup(request, new AbortController().signal);
      expect(t.repository.prepare).not.toHaveBeenCalled();
      expect(t.transaction.commit).toHaveBeenCalled();
      expect(t.plan.commit).not.toHaveBeenCalled();
    },
  );
  it("rejects forged aliases and malformed versions before database work", async () => {
    const t = fixture();
    await expect(
      t.adapter.execute(
        { ...request, sourceAlias: "unknown" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("cleanup_configuration");
    await expect(
      t.adapter.execute(
        { ...request, expectedVersion: -1 },
        new AbortController().signal,
      ),
    ).rejects.toThrow("cleanup_configuration");
    expect(NativeBackupControlTransaction.open).not.toHaveBeenCalled();
  });
  it("does not roll back an acknowledged database tombstone if final trash removal fails", async () => {
    const t = fixture();
    t.plan.commit.mockRejectedValue(new Error("repository unavailable"));
    await expect(
      t.adapter.execute(request, new AbortController().signal),
    ).rejects.toThrow("cleanup_failed");
    expect(t.plan.rollback).not.toHaveBeenCalled();
    expect(t.transaction.rollback).not.toHaveBeenCalled();
    expect(t.transaction.close).toHaveBeenCalled();
  });
});

describe("private mounted cleanup repository factory", () => {
  let root: string;
  beforeEach(async () => {
    root = await realpath(
      await mkdtemp(join(tmpdir(), "backup-cleanup-mounts-")),
    );
    await mkdir(join(root, "repository"), { mode: 0o700 });
    await writeFile(join(root, "key"), "dedicated-secret", { mode: 0o600 });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  function mounted() {
    return {
      ...runtime,
      gpgBinary: "/usr/local/bin/gpg",
      repositories: {
        repository: {
          path: join(root, "repository"),
          generation: id(20),
          residency: "local",
          offHost: true,
        },
      },
      keys: { current: { path: join(root, "key"), keyId: "key-one" } },
    };
  }
  it("constructs only an off-host private repository with separately mounted historical keys", async () => {
    const factory = createCleanupRepositoryFactory(mounted());
    await expect(factory("repository")).resolves.toHaveProperty("prepare");
    await expect(factory("unknown")).rejects.toThrow("cleanup_configuration");
    new NativeBackupCleanupAdapter(mounted());
  });
  it("rejects absent keys and symlinked repository mounts", async () => {
    await expect(
      createCleanupRepositoryFactory({ ...mounted(), keys: {} })("repository"),
    ).rejects.toThrow("cleanup_configuration");
    await symlink(join(root, "repository"), join(root, "link"));
    await expect(
      createCleanupRepositoryFactory({
        ...mounted(),
        repositories: {
          repository: {
            ...mounted().repositories.repository,
            path: join(root, "link"),
          },
        },
      })("repository"),
    ).rejects.toThrow("cleanup_configuration");
  });
  it("rejects credentials colocated with ciphertext and symlinked keys", async () => {
    await writeFile(join(root, "repository/key"), "secret", { mode: 0o600 });
    await expect(
      createCleanupRepositoryFactory({
        ...mounted(),
        keys: { current: { path: join(root, "repository/key"), keyId: "old" } },
      })("repository"),
    ).rejects.toThrow("cleanup_configuration");
    await symlink(join(root, "key"), join(root, "key-link"));
    await expect(
      createCleanupRepositoryFactory({
        ...mounted(),
        keys: { current: { path: join(root, "key-link"), keyId: "old" } },
      })("repository"),
    ).rejects.toThrow("cleanup_configuration");
  });
});
