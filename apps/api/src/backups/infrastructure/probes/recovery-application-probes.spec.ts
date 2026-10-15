/* eslint-disable @typescript-eslint/require-await -- Promise-shaped test doubles intentionally resolve immediately. */
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  symlink,
  realpath,
  readFile,
} from "node:fs/promises";
import { createPublicKey, verify, type JsonWebKey } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRecoveryApplicationProbes } from "./recovery-application-probes";
import type { RecoveryApplicationTarget } from "../restore/native-docker-recovery.adapter";
const auth = "public.ecr.aws/supabase/gotrue:v2.197.0";
const rest = "public.ecr.aws/supabase/postgrest:v16.3";
const storage = "public.ecr.aws/supabase/storage-api:v1.77.0";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fixture = {
  organizationId: id(1),
  otherOrganizationId: id(2),
  productId: id(3),
  otherProductId: id(4),
  documentId: id(5),
  versionId: id(6),
};
describe("production recovery application probes", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await realpath(
      await mkdtemp(join(tmpdir(), "recovery-app-probes-")),
    );
    await mkdir(
      join(directory, "apps/api/dist/backups/infrastructure/probes"),
      { recursive: true },
    );
    await writeFile(
      join(
        directory,
        "apps/api/dist/backups/infrastructure/probes/recovery-probe-runtime.js",
      ),
      "module.exports={}",
    );
    for (const relative of [
      "apps/api/node_modules",
      "node_modules",
      "packages/contracts/dist",
      "packages/contracts/node_modules",
    ])
      await mkdir(join(directory, relative), { recursive: true });
    await writeFile(join(directory, "packages/contracts/package.json"), "{}");
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  function config() {
    return {
      runtimeRoot: directory,
      authImage: auth,
      restImage: rest,
      storageImage: storage,
      storageTenantPrefix: "stub/stub",
    } as const;
  }
  function target() {
    const calls: { args: readonly string[]; input?: string }[] = [];
    let owner = "";
    const run = jest.fn(
      async (args: readonly string[], _signal: AbortSignal, input?: string) => {
        calls.push({ args, input });
        if (args[0] === "network") return "true";
        if (args[0] === "inspect" && args.includes("{{.State.Running}}"))
          return "true\ntrue\ntrue";
        if (args[0] === "inspect")
          return JSON.stringify({
            "cra.backup.probe": owner,
            "cra.backup.feature": "m15-05",
          });
        if (args[0] === "ps")
          return calls
            .filter((call) => call.args.includes("--detach"))
            .map((call) => call.args[call.args.indexOf("--name") + 1])
            .join("\n");
        if (args.includes("--detach")) {
          owner = args[args.indexOf("--label") + 1]!.split("=")[1]!;
          return "container";
        }
        if (args.includes("create"))
          return JSON.stringify({
            ok: true,
            result: { authUserIds: [id(7), id(8)] },
            diagnostics: [],
          });
        if (args.includes("verify"))
          return JSON.stringify({
            ok: true,
            result: {
              checks: [
                "authentication",
                "tenant_isolation",
                "product_isolation",
                "private_evidence_access",
              ],
            },
            diagnostics: [],
          });
        return "";
      },
    );
    const sql = jest.fn(async (query: string) =>
      query.includes("json_build_object")
        ? JSON.stringify(fixture)
        : query.includes("json_agg(id")
          ? JSON.stringify([id(9), id(10)])
          : "",
    );
    const value: RecoveryApplicationTarget = {
      databaseContainer: `cra-backup-restore-${id(11)}`,
      network: `cra-backup-restore-${id(11)}-network`,
      directory,
      objectDirectory: join(directory, "objects"),
      objectVolume: `cra-backup-restore-${id(11)}-objects`,
      databaseName: "postgres",
      databaseUser: "postgres",
      databasePassword: "f".repeat(64),
      ownership: { "cra.backup.feature": "m15-05" },
      sql,
      run,
      cleanupRun: run,
    };
    return { value, calls, run, sql };
  }
  it("starts only pinned target services and executes application code", async () => {
    const t = target();
    await expect(
      createRecoveryApplicationProbes(config())(
        t.value,
        new AbortController().signal,
      ),
    ).resolves.toEqual([
      "authentication",
      "tenant_isolation",
      "product_isolation",
      "private_evidence_access",
    ]);
    const services = t.calls.filter((x) => x.args.includes("--detach"));
    expect(services).toHaveLength(3);
    const storageService = services.find((entry) =>
      entry.args.includes(storage),
    )!;
    expect(storageService.args).toContain(
      `type=volume,src=${t.value.objectVolume},dst=/mnt,readonly`,
    );
    expect(storageService.args.join(" ")).not.toContain(
      t.value.objectDirectory,
    );
    for (const service of services) {
      expect(service.args).toContain(t.value.network);
      expect(service.args).not.toContain("--publish");
      expect(service.args).toContain("--env-file");
      expect(service.args.join(" ")).not.toContain(t.value.databasePassword);
    }
    const runtimeRuns = t.calls.filter((x) => x.args.includes("--init"));
    expect(runtimeRuns).toHaveLength(2);
    for (const run of runtimeRuns) {
      expect(run.args).toContain("cra.backup.feature=m15-05");
      expect(run.args.join(" ")).not.toContain(
        `src=${directory},dst=/runtime,readonly`,
      );
      expect(run.args).toContain(
        `type=bind,src=${directory}/packages/contracts/package.json,dst=/runtime/packages/contracts/package.json,readonly`,
      );
      expect(run.args).toContain(
        `type=bind,src=${directory}/packages/contracts/node_modules,dst=/runtime/packages/contracts/node_modules,readonly`,
      );
      expect(
        run.args.filter((value) => value.startsWith("type=bind,")),
      ).toHaveLength(7);
    }
    expect(t.calls.filter((x) => x.args[0] === "rm")).toHaveLength(3);
    expect(
      t.sql.mock.calls.some(([q]) => q.includes("organization_members")),
    ).toBe(true);
  });
  it("isolates target-only membership provisioning from restored growth admission", async () => {
    const t = target();
    await createRecoveryApplicationProbes(config())(
      t.value,
      new AbortController().signal,
    );
    const provision = t.sql.mock.calls
      .map(([query]) => query)
      .filter((query) =>
        query.includes("insert into public.organization_members"),
      );
    expect(provision).toHaveLength(1);
    expect(provision[0]).toMatch(
      /^begin; set local session_replication_role=replica; insert into public.organization_members/,
    );
    expect(provision[0]).toMatch(/; commit;$/);
    expect(
      t.sql.mock.calls.filter(([query]) =>
        query.includes("session_replication_role"),
      ),
    ).toHaveLength(1);
  });
  it("signs target service and anonymous tokens with the active ES256 key", async () => {
    const t = target();
    const original = t.run.getMockImplementation()!;
    const tokens: string[] = [];
    let publicKey: (JsonWebKey & { kid: string }) | undefined;
    t.run.mockImplementation(async (...args) => {
      if (args[0].includes("--detach") && args[0].includes(storage)) {
        const path = args[0][args[0].indexOf("--env-file") + 1]!;
        const values = Object.fromEntries(
          (await readFile(path, "utf8"))
            .trim()
            .split("\n")
            .map((line) => {
              const index = line.indexOf("=");
              return [line.slice(0, index), line.slice(index + 1)];
            }),
        );
        tokens.push(values.SERVICE_KEY!, values.ANON_KEY!);
        publicKey = (
          JSON.parse(values.JWT_JWKS!) as {
            keys: (JsonWebKey & { kid: string })[];
          }
        ).keys[0];
      }
      return original(...args);
    });
    await createRecoveryApplicationProbes(config())(
      t.value,
      new AbortController().signal,
    );
    expect(tokens).toHaveLength(2);
    for (const [index, token] of tokens.entries()) {
      const [header, payload, signature] = token.split(".") as [
        string,
        string,
        string,
      ];
      const claims = JSON.parse(
        Buffer.from(payload, "base64url").toString(),
      ) as { exp: number; iat: number; role: string; aud: string; iss: string };
      expect(
        JSON.parse(Buffer.from(header, "base64url").toString()),
      ).toMatchObject({ alg: "ES256", kid: publicKey!.kid });
      expect(claims).toMatchObject({
        role: index === 0 ? "service_role" : "anon",
        aud: "authenticated",
        iss: "supabase",
      });
      expect(claims.exp - claims.iat).toBe(600);
      expect(
        verify(
          "sha256",
          Buffer.from(`${header}.${payload}`),
          {
            key: createPublicKey({ key: publicKey!, format: "jwk" }),
            dsaEncoding: "ieee-p1363",
          },
          Buffer.from(signature, "base64url"),
        ),
      ).toBe(true);
    }
  });
  it.each(["latest", "public.ecr.aws/supabase/gotrue:v2.194.0"])(
    "rejects unapproved image %s",
    (image) => {
      expect(() =>
        createRecoveryApplicationProbes({
          ...config(),
          authImage: image as typeof auth,
        }),
      ).toThrow("recovery_probe_configuration");
    },
  );
  it("rejects public networks", async () => {
    const t = target();
    t.run.mockResolvedValue("false");
    await expect(
      createRecoveryApplicationProbes(config())(
        t.value,
        new AbortController().signal,
      ),
    ).rejects.toThrow("recovery_probe_isolation");
  });
  it("rejects a pre-existing or foreign object volume before commands", async () => {
    const t = target();
    await expect(
      createRecoveryApplicationProbes(config())(
        { ...t.value, objectVolume: "original-storage" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("recovery_probe_isolation");
    expect(t.calls).toHaveLength(0);
  });
  it("rejects source-like targets before commands", async () => {
    const t = target();
    await expect(
      createRecoveryApplicationProbes(config())(
        { ...t.value, databaseContainer: "original" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("recovery_probe_isolation");
    expect(t.calls).toHaveLength(0);
  });
  it("fails closed when restored evidence is missing", async () => {
    const t = target();
    t.sql.mockResolvedValue("null");
    await expect(
      createRecoveryApplicationProbes(config())(
        t.value,
        new AbortController().signal,
      ),
    ).rejects.toThrow("recovery_probe_fixture");
    expect(t.calls.filter((x) => x.args.includes("--detach"))).toHaveLength(0);
  });
  it("preserves preceding application checks when private delivery fails", async () => {
    const t = target();
    const original = t.run.getMockImplementation()!;
    t.run.mockImplementation(async (...args) => {
      if (args[0].includes("verify"))
        return JSON.stringify({
          ok: false,
          diagnostics: [],
          code: "recovery_probe_evidence_access",
          progress: {
            completedChecks: [
              "authentication",
              "tenant_isolation",
              "product_isolation",
            ],
            failedCheck: "private_evidence_access",
          },
        });
      return original(...args);
    });
    await expect(
      createRecoveryApplicationProbes(config())(
        t.value,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      completedChecks: [
        "authentication",
        "tenant_isolation",
        "product_isolation",
      ],
      failedCheck: "private_evidence_access",
    });
    expect(t.calls.filter((entry) => entry.args[0] === "rm")).toHaveLength(3);
  });
  it("cleans owned services after runtime failure", async () => {
    const t = target();
    const original = t.run.getMockImplementation()!;
    t.run.mockImplementation(async (...args) => {
      if (args[0].includes("verify")) throw new Error("secret details");
      return original(...args);
    });
    await expect(
      createRecoveryApplicationProbes(config())(
        t.value,
        new AbortController().signal,
      ),
    ).rejects.toThrow("recovery_application_probe_failed");
    expect(t.calls.filter((x) => x.args[0] === "rm")).toHaveLength(3);
  });
  it("reconciles services after an interrupted start acknowledgement", async () => {
    const t = target();
    const original = t.run.getMockImplementation()!;
    let starts = 0;
    t.run.mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[0].includes("--detach") && ++starts === 2)
        throw new Error("aborted acknowledgement");
      return result;
    });
    await expect(
      createRecoveryApplicationProbes(config())(
        t.value,
        new AbortController().signal,
      ),
    ).rejects.toThrow("recovery_application_probe_failed");
    expect(t.calls.filter((x) => x.args[0] === "rm")).toHaveLength(2);
  });
  it("fails fast for dead services and removes named runtime containers on cancellation", async () => {
    const t = target();
    const original = t.run.getMockImplementation()!;
    t.run.mockImplementation(async (...args) => {
      if (args[0].includes("{{.State.Running}}")) return "false\ntrue\ntrue";
      if (args[0][0] === "ps")
        return t.calls
          .filter((call) => call.args.includes("--name"))
          .map((call) => call.args[call.args.indexOf("--name") + 1])
          .join("\n");
      const value = await original(...args);
      if (args[0].includes("create"))
        return new Promise<string>((_resolve, reject) => {
          if (args[1].aborted) reject(new Error("cancelled"));
          else
            args[1].addEventListener(
              "abort",
              () => reject(new Error("cancelled")),
              { once: true },
            );
        });
      return value;
    });
    await expect(
      createRecoveryApplicationProbes(config())(
        t.value,
        new AbortController().signal,
      ),
    ).rejects.toThrow("recovery_application_probe_failed");
    expect(t.calls.filter((call) => call.args[0] === "rm")).toHaveLength(4);
  });
  it("refuses removing services whose ownership label changed", async () => {
    const t = target();
    const original = t.run.getMockImplementation()!;
    t.run.mockImplementation(async (...args) =>
      args[0][0] === "inspect" && !args[0].includes("{{.State.Running}}")
        ? "other-owner"
        : original(...args),
    );
    await expect(
      createRecoveryApplicationProbes(config())(
        t.value,
        new AbortController().signal,
      ),
    ).rejects.toThrow("recovery_cleanup_unsafe");
    expect(t.calls.filter((x) => x.args[0] === "rm")).toHaveLength(0);
  });
  it("rejects symlinked runtime roots", async () => {
    const t = target();
    const linked = directory + "-link";
    await symlink(directory, linked);
    try {
      await expect(
        createRecoveryApplicationProbes({ ...config(), runtimeRoot: linked })(
          t.value,
          new AbortController().signal,
        ),
      ).rejects.toThrow("recovery_probe_configuration");
    } finally {
      await rm(linked);
    }
  });
  it("rejects incomplete runtime receipts", async () => {
    const t = target();
    const original = t.run.getMockImplementation()!;
    t.run.mockImplementation(async (...args) =>
      args[0].includes("verify") ? "{}" : original(...args),
    );
    await expect(
      createRecoveryApplicationProbes(config())(
        t.value,
        new AbortController().signal,
      ),
    ).rejects.toThrow("recovery_application_probe_failed");
  });
});
