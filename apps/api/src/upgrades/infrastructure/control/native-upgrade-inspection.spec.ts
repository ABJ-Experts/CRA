import { preflightUpgrade } from "../../domain/upgrade-preflight";
/* eslint-disable @typescript-eslint/require-await -- Promise-based test doubles model native I/O. */
import { generateKeyPairSync, sign } from "node:crypto";
import {
  verifyInspectionReceipt,
  inspectionDigest,
  NativeUpgradeInspectionBlocker,
} from "./native-upgrade-inspection";
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
function receipt(payload: object, purpose = "installed") {
  const bytes = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return JSON.stringify({
    payload: bytes,
    signature: sign(
      null,
      Buffer.from(`CRA-UPGRADE-${purpose}-V1\0${bytes}`),
      keys.privateKey,
    ).toString("base64url"),
  });
}
describe("native inspection receipts", () => {
  it("authenticates exact bytes with purpose separation", () => {
    const encoded = receipt({ version: "1" });
    expect(verifyInspectionReceipt(encoded, publicKey, "installed")).toEqual({
      version: "1",
    });
    expect(() =>
      verifyInspectionReceipt(encoded, publicKey, "qualification"),
    ).toThrow(NativeUpgradeInspectionBlocker);
  });
  it("rejects tampered, malformed and oversized receipts", () => {
    for (const encoded of [
      "{}",
      "not-json",
      "x".repeat(262145),
      receipt({ a: 1 }).replace('"payload":"', '"payload":"a'),
    ]) {
      expect(() =>
        verifyInspectionReceipt(encoded, publicKey, "installed"),
      ).toThrow(NativeUpgradeInspectionBlocker);
    }
  });
  it("hashes ledger arrays deterministically", () => {
    expect(inspectionDigest(["1", "2"])).toEqual(inspectionDigest(["1", "2"]));
    expect(inspectionDigest(["1", "2"])).not.toEqual(
      inspectionDigest(["2", "1"]),
    );
  });
});

import { createHash } from "node:crypto";
import {
  NativeUpgradeInspection,
  type NativeUpgradeInspectionConfiguration,
} from "./native-upgrade-inspection";
import type { VerifiedUpgradeBundle } from "../media/mounted-upgrade-media";
const d = "a".repeat(64),
  id = "11111111-1111-4111-8111-111111111111";
const schemaDigest = createHash("sha256")
  .update("CREATE TABLE example();")
  .digest("hex");
const config: NativeUpgradeInspectionConfiguration = {
  instanceId: id,
  installedReceiptPath: "/installed",
  qualificationReceiptPath: "/qualification",
  receiptPublicKey: publicKey,
  supervisorVersion: "1.0.0",
  trustDigest: d,
  dockerExecutable: "/docker",
  psqlExecutable: "/psql",
  pgDumpExecutable: "/pg_dump",
  cwd: "/host",
  diskRoot: "/disk",
  maintenanceRequestPath: "/maintenance/request.json",
  environment: {},
  sourceNetwork: "source",
  infrastructureContainers: {
    postgres: "postgres",
    auth: "auth",
    rest: "rest",
    storage: "storage",
    supervisor: "supervisor",
  },
  applicationContainers: { api: "api", web: "web" },
  allowedDatabaseApplications: ["api"],
  organizationIds: [id],
};
const manifest = {
  archive: { sha256: d },
  images: [
    { service: "api", digest: `sha256:${d}` },
    { service: "web", digest: `sha256:${d}` },
  ],
  migrations: [
    {
      name: "20261015000000_safe.sql",
      sha256: createHash("sha256").update("SELECT 1;").digest("hex"),
    },
  ],
  artifacts: [],
  compatibility: {
    sourceVersions: ["1.0.0"],
    sourceManifestDigests: [d],
    sourceSchemaDigests: [schemaDigest],
    targetSchemaDigest: d,
    supervisorVersions: ["1.0.0"],
  },
  infrastructure: { postgres: d, auth: d, rest: d, storage: d, supervisor: d },
  requirements: { diskBytes: 1, memoryBytes: 1 },
  platform: { os: "linux", architecture: "amd64" },
  licenseEffects: ["unchanged"],
};
const bundle = {
  manifest,
  manifestDigest: d,
  extractedRoot: "/stage",
  stagingId: id,
  archivePath: "/archive",
} as unknown as VerifiedUpgradeBundle;
function fixture(
  options: {
    extra?: boolean;
    session?: string;
    qualified?: object;
    sql?: string;
    schema?: string;
    license?: object;
    ledger?: string[];
    arch?: string;
    maintenance?: boolean;
    ids?: string;
    missing?: string;
    imageId?: string;
    swappedSource?: boolean;
    dockerFreeBytes?: number;
    admissionRejected?: boolean;
  } = {},
) {
  const run = jest.fn(
    async (
      binary: string,
      args: readonly string[],
      opts: { stdin?: string },
    ) => {
      if (binary === "/pg_dump")
        return options.schema ?? "CREATE TABLE example();";
      if (binary === "/psql") {
        if (opts.stdin?.includes("schema_migrations"))
          return JSON.stringify(
            (options.ledger ?? []).map((version) => ({
              version,
              name: "migration",
              statements: ["SELECT 1;"],
            })),
          );
        if (opts.stdin?.includes("pg_stat_activity"))
          return JSON.stringify([options.session ?? "api"]);
        return JSON.stringify(options.license ?? { total: 1, blocked: 0 });
      }
      if (args[0] === "info")
        return JSON.stringify({
          MemTotal: 1000,
          OSType: "linux",
          Architecture: options.arch ?? "x86_64",
          DockerRootDir: "/docker-data",
        });
      if (args[0] === "ps") return options.ids ?? d;
      if (args[0] === "image")
        return JSON.stringify([
          {
            Id:
              options.imageId ??
              `sha256:${options.swappedSource ? "b".repeat(64) : d}`,
            Os: "linux",
            Architecture: "amd64",
          },
        ]);
      return JSON.stringify(
        [
          ...Object.values(config.infrastructureContainers),
          ...Object.keys(config.applicationContainers),
          ...(options.extra ? ["unknown"] : []),
        ]
          .filter((name) => name !== options.missing)
          .map((name) => ({
            Name: `/${name}`,
            Image: `sha256:${options.swappedSource && ["api", "web"].includes(name) ? "b".repeat(64) : d}`,
            State: { Running: true },
            NetworkSettings: { Networks: { source: {} } },
          })),
      );
    },
  );
  const read = jest.fn(async (path: string) =>
    path === "/installed"
      ? receipt({
          instanceId: id,
          version: "1.0.0",
          manifestDigest: d,
          schemaDigest,
          ledgerDigest: inspectionDigest([]),
          schemaAlgorithm: "pg-dump-schema-v1",
          sourceImageIds: { api: `sha256:${d}`, web: `sha256:${d}` },
          sourcePlatform: "linux/amd64",
        })
      : path === "/qualification"
        ? receipt(
            {
              instanceId: id,
              sourceManifestDigest: d,
              sourceImageIds: { api: `sha256:${d}`, web: `sha256:${d}` },
              sourcePlatform: "linux/amd64",
              candidateManifestDigest: d,
              sourceSchemaDigest: schemaDigest,
              targetSchemaDigest: d,
              targetLedgerDigest: d,
              expiresAt: "2027-01-01T00:00:00Z",
              previousCompatibleAfterCandidateWrites: true,
              atomicLedger: true,
              cliVersion: "2.0.0",
              candidateImageIds: { api: `sha256:${d}`, web: `sha256:${d}` },
              ...options.qualified,
            },
            "qualification",
          )
        : (options.sql ?? "SELECT 1;"),
  );
  const backup = jest.fn(async () => ({
    certificateDigest: d,
    verified: true,
    held: true,
    keysAvailable: true,
  }));
  const importedProof = jest.fn(async () => ({ requiredRemainingBytes: 300 }));
  const inspector = new NativeUpgradeInspection(config, {
    verifyImportedImages: importedProof,
    ...{
      admitImages: async () => {
        if (options.admissionRejected) throw new Error("image_archive_invalid");
      },
    },
    runner: { run },
    read,
    backup,
    now: () => new Date("2026-10-15T00:00:00Z"),
    resources: async (directory) => ({
      freeBytes:
        directory === "/docker-data" ? (options.dockerFreeBytes ?? 1000) : 1000,
      memoryBytes: 2000,
      platform: "linux/amd64",
    }),
    maintenance: async () => options.maintenance ?? false,
  });
  return { inspector, run, backup, importedProof };
}
const actor = { principalId: id, fingerprint256: d, grantRevision: "1" };
describe("readonly inspection collector", () => {
  it("derives facts and exact plan from authenticated receipts and native observations", async () => {
    const f = fixture();
    const result = await f.inspector.inspect(bundle, actor, id);
    expect(result.facts).toMatchObject({
      currentSchemaDigest: schemaDigest,
      memoryBytes: 1,
      processInventoryComplete: true,
      unmanagedWriters: false,
      licenceAllowsUpgrade: true,
    });
    expect(result.plan.candidateImages).toHaveLength(2);
    expect(result.plan.previousImages).toHaveLength(2);
    expect(result.plan.migrations[0]?.sql).toBe("SELECT 1;");
    expect(f.backup).toHaveBeenCalledWith(id);
    expect(
      f.run.mock.calls
        .filter(([binary]) => binary === "/psql")
        .every(([, , options]) =>
          options.stdin?.startsWith("BEGIN READ ONLY;"),
        ),
    ).toBe(true);
  });
  it.each([{ extra: true }, { session: "unknown" }])(
    "rejects unknown writer inventory in preflight facts",
    async (options) => {
      expect(
        (await fixture(options).inspector.inspect(bundle, actor, id)).facts
          .unmanagedWriters,
      ).toBe(true);
    },
  );
  it.each([
    { qualified: { candidateManifestDigest: "b".repeat(64) } },
    { qualified: { instanceId: "22222222-2222-4222-8222-222222222222" } },
    { qualified: { sourceManifestDigest: "b".repeat(64) } },
    { qualified: { sourceSchemaDigest: d } },
    { qualified: { targetSchemaDigest: "b".repeat(64) } },
    { qualified: { expiresAt: "2020-01-01T00:00:00Z" } },
    { schema: "drift" },
    { sql: "tampered" },
  ])("fails closed on proof or source drift", async (options) => {
    await expect(
      fixture(options).inspector.inspect(bundle, actor, id),
    ).rejects.toThrow(NativeUpgradeInspectionBlocker);
  });
  it("preserves review window and flags maintenance, license, ledger and platform failures", async () => {
    const window = {
      checkedAt: "2026-10-15T00:00:00Z",
      expiresAt: "2026-10-15T00:01:00Z",
    };
    const result = await fixture({
      maintenance: true,
      license: { total: 1, blocked: 1 },
      ledger: ["20261015000000"],
      arch: "bad",
    }).inspector.inspect(bundle, actor, id, window);
    expect(result.facts).toMatchObject({
      ...window,
      concurrentMaintenance: true,
      licenceAllowsUpgrade: false,
      platform: "unsupported",
      pendingMigrations: [],
    });
  });
  it("blocks candidate missing role", async () => {
    await expect(
      fixture().inspector.inspect(
        { ...bundle, manifest: { ...bundle.manifest, images: [] } },
        actor,
        id,
      ),
    ).rejects.toThrow(NativeUpgradeInspectionBlocker);
  });
});

import {
  mkdtemp,
  writeFile,
  mkdir,
  symlink,
  rm,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readInspectionFile } from "./native-upgrade-inspection";
describe("native private file boundary", () => {
  it("reads bounded regular files and rejects writable, large, directory and symlink inputs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "upgrade-inspection-"));
    try {
      const file = join(dir, "file");
      await writeFile(file, "abc", { mode: 0o600 });
      expect(await readInspectionFile(file, 3)).toBe("abc");
      await expect(readInspectionFile(file, 2)).rejects.toThrow();
      await mkdir(join(dir, "directory"));
      await expect(
        readInspectionFile(join(dir, "directory"), 100),
      ).rejects.toThrow();
      await symlink(file, join(dir, "link"));
      await expect(
        readInspectionFile(join(dir, "link"), 100),
      ).rejects.toThrow();
      await writeFile(join(dir, "public"), "abc", { mode: 0o666 });
      await chmod(join(dir, "public"), 0o666);
      await expect(
        readInspectionFile(join(dir, "public"), 100),
      ).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("reports installed version and maintenance without application state mutation", async () => {
    const f = fixture();
    expect(await f.inspector.installedVersion()).toBe("1.0.0");
    expect(await f.inspector.maintenanceActive()).toBe(false);
  });
  it("rejects noncanonical base64 and unsupported receipt keys", () => {
    const key = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .publicKey.export({ type: "spki", format: "pem" })
      .toString();
    expect(() =>
      verifyInspectionReceipt(receipt({ a: 1 }), key, "installed"),
    ).toThrow();
    const payload = JSON.parse(receipt({ a: 1 })) as {
      payload: string;
      signature: string;
    };
    payload.signature = "a";
    expect(() =>
      verifyInspectionReceipt(JSON.stringify(payload), publicKey, "installed"),
    ).toThrow();
    payload.payload = "a";
    expect(() =>
      verifyInspectionReceipt(JSON.stringify(payload), publicKey, "installed"),
    ).toThrow();
  });
});

describe("native observation refusal", () => {
  it.each([
    { ids: "" },
    { ids: "invalid" },
    { missing: "api" },
    { imageId: "bad" },
  ])("rejects absent or mismatched image inventories", async (options) => {
    await expect(
      fixture(options).inspector.inspect(bundle, actor, id),
    ).rejects.toThrow();
  });
  it.each(["aarch64", "arm64", "amd64"])(
    "checks daemon architecture %s",
    async (arch) => {
      const r = await fixture({ arch }).inspector.inspect(bundle, actor, id);
      expect(r.facts.platform).toBe(
        arch === "amd64" ? "linux/amd64" : "mismatch",
      );
    },
  );
  it("checks default filesystem maintenance existence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "upgrade-maintenance-"));
    try {
      const inspector = new NativeUpgradeInspection(
        { ...config, maintenanceRequestPath: join(dir, "request") },
        {
          backup: async () => ({
            certificateDigest: d,
            verified: false,
            held: false,
            keysAvailable: false,
          }),
        },
      );
      await expect(inspector.maintenanceActive()).rejects.toThrow();
      await writeFile(join(dir, "request"), "{}", { mode: 0o600 });
      await expect(inspector.maintenanceActive()).rejects.toThrow();
      await writeFile(
        join(dir, "request"),
        JSON.stringify({ version: 1, generation: id, closed: false }),
      );
      expect(await inspector.maintenanceActive()).toBe(false);
      await writeFile(
        join(dir, "request"),
        JSON.stringify({ version: 1, generation: id, closed: true }),
      );
      expect(await inspector.maintenanceActive()).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("qualified target reconciliation proof", () => {
  it("requires authenticated target ledger identity", async () => {
    await expect(
      fixture({
        qualified: { targetLedgerDigest: undefined },
      }).inspector.inspect(bundle, actor, id),
    ).rejects.toThrow();
  });
  it("binds generated plan to both signed target identities", async () => {
    const result = await fixture().inspector.inspect(bundle, actor, id);
    expect(result.plan.expectedLedgerDigest).toBe(d);
    expect(result.plan.targetSchemaDigest).toBe(d);
  });
});

it("invalidates review fingerprint when authenticated target ledger qualification changes", async () => {
  const before = await fixture().inspector.inspect(bundle, actor, id);
  const after = await fixture({
    qualified: { targetLedgerDigest: "b".repeat(64) },
  }).inspector.inspect(bundle, actor, id);
  expect(after.plan.fingerprint).not.toBe(before.plan.fingerprint);
});

it("rejects swapped source images despite unchanged installed version and database", async () => {
  await expect(
    fixture({ swappedSource: true }).inspector.inspect(bundle, actor, id),
  ).rejects.toThrow();
});

it.each([
  { sourceImageIds: { api: `sha256:${"b".repeat(64)}`, web: `sha256:${d}` } },
  { sourcePlatform: "linux/arm64" },
  { sourceImageIds: undefined },
])("rejects missing or mismatched qualified source set", async (qualified) => {
  await expect(
    fixture({ qualified }).inspector.inspect(bundle, actor, id),
  ).rejects.toThrow();
});

it("preflights unloaded candidate identities without inspecting or loading candidate images", async () => {
  const candidateId = `sha256:${"c".repeat(64)}`;
  const f = fixture({
    qualified: { candidateImageIds: { api: candidateId, web: candidateId } },
  });
  const candidate = {
    ...bundle,
    manifest: {
      ...bundle.manifest,
      images: bundle.manifest.images.map((image) => ({
        ...image,
        digest: candidateId,
      })),
    },
  };
  const result = await f.inspector.inspect(candidate, actor, id);
  expect(
    result.plan.candidateImages.every((image) => image.imageId === candidateId),
  ).toBe(true);
  expect(
    f.run.mock.calls.some(
      ([, args]) => args.includes("load") || args.includes(candidateId),
    ),
  ).toBe(false);
});

it("checks actual Docker root filesystem capacity separately from staging", async () => {
  const result = await fixture({ dockerFreeBytes: 0 }).inspector.inspect(
    bundle,
    actor,
    id,
  );
  expect(result.facts.freeBytes).toBe(0);
  expect(result.privateObservations).toMatchObject({
    freeBytes: 1000,
    dockerFreeBytes: 0,
  });
});

it("refuses candidate plan when bounded archive admission rejects identity or expansion", async () => {
  await expect(
    fixture({ admissionRejected: true }).inspector.inspect(bundle, actor, id),
  ).rejects.toThrow("image_archive_invalid");
});

it("uses verified remaining resource admission after import without re-reserving import expansion", async () => {
  const f = fixture({ admissionRejected: true, dockerFreeBytes: 400 });
  const candidate = {
    ...bundle,
    manifest: {
      ...bundle.manifest,
      requirements: { ...bundle.manifest.requirements, diskBytes: 1000 },
    },
  };
  await expect(f.inspector.inspect(candidate, actor, id)).rejects.toThrow(
    "image_archive_invalid",
  );
  const observed = await f.inspector.inspect(candidate, actor, id, undefined, {
    imagesImported: true,
  });
  expect(f.importedProof).toHaveBeenCalledWith(candidate);
  expect(observed.facts).toMatchObject({ freeBytes: 300, requiredBytes: 300 });
  expect(
    preflightUpgrade(observed.facts, new Date("2026-10-15T00:00:01Z")).allowed,
  ).toBe(true);
  f.importedProof.mockResolvedValueOnce({ requiredRemainingBytes: 0 });
  await expect(
    f.inspector.inspect(candidate, actor, id, undefined, {
      imagesImported: true,
    }),
  ).rejects.toThrow();
});
