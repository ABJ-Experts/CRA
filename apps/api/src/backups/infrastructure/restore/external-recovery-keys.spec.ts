import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertRecoveryKeyDependencies,
  prepareExternalRecoveryKeys,
  type ExternalRecoveryKeyMount,
} from "./external-recovery-keys";

describe("external recovery key escrow", () => {
  it("requires a pgsodium canary for Vault dependencies in any restored database", () => {
    for (const name of ["pgsodium", "supabase_vault"]) {
      const databases = { postgres: {}, secondary: { extensions: [{ name }] } };
      expect(() => assertRecoveryKeyDependencies(databases, [])).toThrow(
        "recovery_key_unavailable",
      );
      expect(() =>
        assertRecoveryKeyDependencies(databases, [
          { alias: "pgsodium", canaryPartId: "canary" },
        ]),
      ).not.toThrow();
    }
    expect(() =>
      assertRecoveryKeyDependencies(
        {
          a: null,
          b: true,
          c: { extensions: [null, "untrusted", {}, { name: "plpgsql" }] },
        },
        [],
      ),
    ).not.toThrow();
  });
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "m15-05-key-test-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  it("matches a mounted historical key against an authenticated recovery canary without returning key bytes", async () => {
    const key = join(root, "mounted-key");
    await writeFile(key, "private-root-key", { mode: 0o600 });
    const part = {
      id: "canary",
      kind: "recovery-key" as const,
      name: "key-check",
      sha256: "a".repeat(64),
      bytes: 128,
      cipherSha256: "b".repeat(64),
      cipherBytes: 200,
    };
    const result = await prepareExternalRecoveryKeys(
      { externalKeyChecks: [{ alias: "vault", canaryPartId: "canary" }] },
      [part],
      {
        vault: {
          path: key,
          targetPath: "/etc/postgresql-custom/pgsodium_root.key",
        },
      },
      root,
      async (_part, path) => {
        await writeFile(
          path,
          JSON.stringify({
            alias: "vault",
            sha256: createHash("sha256")
              .update("private-root-key")
              .digest("hex"),
          }),
        );
      },
      AbortSignal.timeout(1000),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.targetPath).toBe(
      "/etc/postgresql-custom/pgsodium_root.key",
    );
    expect(JSON.stringify(result)).not.toContain("private-root-key");
    expect(await readFile(result[0]!.path, "utf8")).toBe("private-root-key");
  });
  it("fails closed for missing or mismatched historical keys and unsafe mount targets", async () => {
    const key = join(root, "mounted-key");
    await writeFile(key, "key", { mode: 0o600 });
    const part = {
      id: "canary",
      kind: "recovery-key" as const,
      name: "key-check",
      sha256: "a".repeat(64),
      bytes: 128,
      cipherSha256: "b".repeat(64),
      cipherBytes: 200,
    };
    const checks = {
      externalKeyChecks: [{ alias: "vault", canaryPartId: "canary" }],
    };
    const unsafeMounts: readonly Readonly<
      Record<string, ExternalRecoveryKeyMount>
    >[] = [{}, { vault: { path: key, targetPath: "/production/key" } }];
    for (const mounts of unsafeMounts)
      await expect(
        prepareExternalRecoveryKeys(
          checks,
          [part],
          mounts,
          root,
          async () => {},
          AbortSignal.timeout(1000),
        ),
      ).rejects.toThrow();
    await expect(
      prepareExternalRecoveryKeys(
        checks,
        [part],
        {
          vault: {
            path: key,
            targetPath: "/etc/postgresql-custom/pgsodium_root.key",
          },
        },
        root,
        async (_part, path) => {
          await writeFile(
            path,
            JSON.stringify({ alias: "vault", sha256: "a".repeat(64) }),
          );
        },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("recovery_key_unavailable");
  });
  it("accepts no external dependencies only when the manifest declares none", async () => {
    expect(
      await prepareExternalRecoveryKeys(
        { externalKeyChecks: [] },
        [],
        {},
        root,
        async () => {},
        AbortSignal.timeout(1000),
      ),
    ).toEqual([]);
  });
});
