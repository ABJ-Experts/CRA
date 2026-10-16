import {
  projectInstalledUpgradeIdentity,
  type InstalledUpgradeIdentity,
} from "./current-installed-upgrade-identity";
import type { UpgradeJournalRecord } from "../../application/upgrade-supervisor.port";
const d = (value: string) => value.repeat(64);
const id = "11111111-1111-4111-8111-111111111111";
const base: InstalledUpgradeIdentity = {
  instanceId: id,
  version: "1.0.0",
  manifestDigest: d("a"),
  schemaDigest: d("b"),
  ledgerDigest: d("c"),
  schemaAlgorithm: "pg-dump-schema-v1",
  sourceImageIds: { api: `sha256:${d("d")}`, web: `sha256:${d("e")}` },
  sourcePlatform: "linux/amd64",
};
const effects = [
  "close-ingress",
  "stop-claims",
  "drain",
  "hold-backup",
  "migrate",
  "start-candidate",
  "verify-candidate",
  "start-workers",
  "open-ingress",
  "verify-activated",
];
const images = (identity: InstalledUpgradeIdentity) =>
  Object.entries(identity.sourceImageIds).map(([service, imageId]) => ({
    service,
    imageId,
    digest: imageId,
    platform: identity.sourcePlatform,
  }));
function transition(
  parent: InstalledUpgradeIdentity,
  next: InstalledUpgradeIdentity,
  runId = "run-1",
  outcome = "success",
  offset = 0,
): UpgradeJournalRecord[] {
  const fingerprint = d("f");
  const rolled = outcome === "rolled-back";
  const record = (
    kind: string,
    data: Record<string, unknown>,
    sequence: number,
  ): UpgradeJournalRecord => ({
    instanceId: id,
    runId,
    kind,
    data,
    sequence: offset + sequence,
    idempotencyKey: `key-${sequence}`,
    previousHash: d("0"),
    hash: d("1"),
  });
  return [
    record(
      "execution",
      {
        phase: rolled ? "rolled-back" : "succeeded",
        fingerprint,
        pendingEffect: null,
        completed: rolled
          ? [...effects.slice(0, 7), "restore-previous"]
          : effects,
        exposurePossible: !rolled,
        reason: null,
      },
      1,
    ),
    record(
      "run",
      {
        run: {
          id: runId,
          instanceId: id,
          state: outcome,
          fromVersion: parent.version,
          toVersion: next.version,
          manifestDigest: next.manifestDigest,
          completedAt: "2026-10-15T00:01:00Z",
          preflight: { fingerprint },
          result: {
            outcome,
            failureCode: null,
            dataRestored: false,
            migrationsReversed: false,
            exposurePossible: !rolled,
            maintenanceRetained: rolled,
          },
        },
        facts: {
          instanceId: id,
          currentVersion: parent.version,
          currentManifestDigest: parent.manifestDigest,
          currentSchemaDigest: parent.schemaDigest,
          ledgerDigest: parent.ledgerDigest,
          expectedLedgerDigest: parent.ledgerDigest,
          manifestDigest: next.manifestDigest,
          targetSchemaDigest: next.schemaDigest,
          platform: parent.sourcePlatform,
          targetPlatform: next.sourcePlatform,
        },
        plan: {
          runId,
          fingerprint,
          previousImages: images(parent),
          candidateImages: images(next),
          targetSchemaDigest: next.schemaDigest,
          expectedLedgerDigest: next.ledgerDigest,
          previousCompatibleAfterCandidateWrites: true,
          migrations: [],
        },
        bundle: {
          manifestDigest: next.manifestDigest,
          manifest: {
            migrations: [],
            version: next.version,
            platform: { os: "linux", architecture: "amd64" },
            images: images(next).map((i) => ({
              service: i.service,
              digest: i.digest,
            })),
            compatibility: {
              sourceVersions: [parent.version],
              sourceManifestDigests: [parent.manifestDigest],
              sourceSchemaDigests: [parent.schemaDigest],
              targetSchemaDigest: next.schemaDigest,
            },
          },
        },
      },
      2,
    ),
  ];
}
const next: InstalledUpgradeIdentity = {
  ...base,
  version: "2.0.0",
  manifestDigest: d("2"),
  schemaDigest: d("3"),
  ledgerDigest: d("4"),
  sourceImageIds: { api: `sha256:${d("5")}`, web: `sha256:${d("6")}` },
};
describe("authenticated journal installed identity projection", () => {
  it("retains signed bootstrap when there are no deployment effects", () => {
    expect(projectInstalledUpgradeIdentity(base, [])).toEqual(base);
  });
  it("supports successive N to N+1 to N+2 without new publisher receipts", () => {
    const last = {
      ...next,
      version: "3.0.0",
      manifestDigest: d("7"),
      schemaDigest: d("8"),
      ledgerDigest: d("9"),
    };
    expect(
      projectInstalledUpgradeIdentity(base, [
        ...transition(base, next),
        ...transition(next, last, "run-2", "success", 2),
      ]),
    ).toEqual(last);
  });
  it("retains expanded schema and ledger after image rollback for next upgrade", () => {
    const rollback = {
      ...base,
      schemaDigest: next.schemaDigest,
      ledgerDigest: next.ledgerDigest,
    };
    expect(
      projectInstalledUpgradeIdentity(
        base,
        transition(base, next, "run-1", "rolled-back"),
      ),
    ).toEqual(rollback);
    const last = { ...next, version: "3.0.0" };
    expect(
      projectInstalledUpgradeIdentity(base, [
        ...transition(base, next, "run-1", "rolled-back"),
        ...transition(rollback, last, "run-2", "success", 2),
      ]),
    ).toEqual(last);
  });
  it("rejects terminal UI records without corresponding execution proof", () => {
    expect(() =>
      projectInstalledUpgradeIdentity(base, transition(base, next).slice(1)),
    ).toThrow();
  });
  it("rejects broken parent chain", () => {
    expect(() =>
      projectInstalledUpgradeIdentity(
        base,
        transition({ ...base, schemaDigest: d("0") }, next),
      ),
    ).toThrow();
  });
  it("rejects uncertain or post-exposure rollback", () => {
    for (const patch of [
      { phase: "blocked" },
      { pendingEffect: "migrate" },
      { exposurePossible: true },
    ]) {
      const records = transition(base, next, "run-1", "rolled-back");
      expect(() =>
        projectInstalledUpgradeIdentity(base, [
          { ...records[0]!, data: { ...records[0]!.data, ...patch } },
          records[1]!,
        ]),
      ).toThrow();
    }
  });
  it("rejects terminal target and source image mismatch", () => {
    const records = transition(base, next);
    const data = records[1]!.data;
    expect(() =>
      projectInstalledUpgradeIdentity(base, [
        records[0]!,
        {
          ...records[1]!,
          data: {
            ...data,
            plan: { ...(data.plan as object), previousImages: images(next) },
          },
        },
      ]),
    ).toThrow();
  });
});

import {
  projectInstalledUpgradeState,
  mergeInstalledMigrationFiles,
} from "./current-installed-upgrade-identity";
function patchSaved(
  records: UpgradeJournalRecord[],
  key: string,
  patch: Record<string, unknown>,
): UpgradeJournalRecord[] {
  return [
    records[0]!,
    {
      ...records[1]!,
      data: {
        ...records[1]!.data,
        [key]: { ...(records[1]!.data[key] as object), ...patch },
      },
    },
  ];
}
describe("projection proof refusal and migration continuity", () => {
  it.each([
    ["facts", { currentVersion: "0.0.0" }],
    ["facts", { ledgerDigest: d("0") }],
    ["facts", { manifestDigest: d("0") }],
    ["facts", { targetPlatform: "linux/arm64" }],
    ["plan", { fingerprint: d("0") }],
    ["plan", { candidateImages: images(base) }],
    ["plan", { targetSchemaDigest: d("0") }],
    [
      "plan",
      { migrations: [{ name: "20261015000000_x.sql", sha256: d("0") }] },
    ],
    ["run", { id: "wrong" }],
    ["run", { toVersion: "9.0.0" }],
  ] as const)("rejects inconsistent %s proof", (key, patch) => {
    expect(() =>
      projectInstalledUpgradeIdentity(
        base,
        patchSaved(transition(base, next), key, patch),
      ),
    ).toThrow();
  });
  it("rejects missing final persisted record, blocked runs and nonmonotonic cross-instance records", () => {
    const records = transition(base, next);
    expect(() =>
      projectInstalledUpgradeIdentity(base, records.slice(0, 1)),
    ).toThrow();
    expect(() =>
      projectInstalledUpgradeIdentity(base, [
        { ...records[0]!, sequence: 2 },
        records[1]!,
      ]),
    ).toThrow();
    expect(() =>
      projectInstalledUpgradeIdentity(base, [
        { ...records[0]!, instanceId: "22222222-2222-4222-8222-222222222222" },
      ]),
    ).toThrow();
    expect(() =>
      projectInstalledUpgradeIdentity(base, [
        { ...records[1]!, data: { run: { state: "rollback-required" } } },
      ]),
    ).toThrow();
  });
  it("ignores unrelated audit and staging records; handles identical terminal replay", () => {
    const records = transition(base, next);
    expect(
      projectInstalledUpgradeIdentity(base, [
        { ...records[0]!, sequence: 1, kind: "audit-flushed", data: {} },
        {
          ...records[1]!,
          sequence: 2,
          runId: "staged",
          data: { run: { state: "preflight" } },
        },
        { ...records[0]!, sequence: 3 },
        { ...records[1]!, sequence: 4 },
        { ...records[1]!, sequence: 5 },
      ]),
    ).toEqual(next);
    expect(() =>
      projectInstalledUpgradeIdentity(base, [
        ...records,
        {
          ...records[1]!,
          sequence: 3,
          data: {
            ...records[1]!.data,
            facts: {
              ...(records[1]!.data.facts as object),
              ledgerDigest: d("0"),
            },
          },
        },
      ]),
    ).toThrow();
  });
  it("projects only committed signed migration hashes for subsequent CLI history", () => {
    const migration = { name: "20261015000000_expand.sql", sha256: d("7") };
    const records = transition(base, next);
    const original = records[1]!.data;
    const committed = [
      records[0]!,
      {
        ...records[1]!,
        data: {
          ...original,
          plan: { ...(original.plan as object), migrations: [migration] },
          bundle: {
            ...(original.bundle as object),
            manifest: {
              ...(original.bundle as { manifest: object }).manifest,
              migrations: [migration],
            },
          },
        },
      },
    ];
    const state = projectInstalledUpgradeState(base, committed);
    expect(state.committedMigrations).toEqual({
      [migration.name]: migration.sha256,
    });
    expect(
      mergeInstalledMigrationFiles(
        { "20261014000000_base.sql": d("8") },
        state.committedMigrations,
      ),
    ).toEqual({
      "20261014000000_base.sql": d("8"),
      [migration.name]: migration.sha256,
    });
    expect(() =>
      mergeInstalledMigrationFiles(
        { [migration.name]: d("9") },
        state.committedMigrations,
      ),
    ).toThrow();
  });
});

it("projects confirmed rollback after a lost migration acknowledgement", () => {
  const records = transition(base, next, "run-1", "rolled-back");
  const recovered = {
    ...records[0]!,
    sequence: 2,
    data: { ...records[0]!.data, completed: ["restore-previous"] },
  };
  const blocked = {
    ...records[0]!,
    sequence: 1,
    data: {
      ...records[0]!.data,
      phase: "blocked",
      reason: "effect-unconfirmed",
      pendingEffect: "migrate",
      completed: [],
    },
  };
  expect(
    projectInstalledUpgradeIdentity(base, [
      blocked,
      recovered,
      { ...records[1]!, sequence: 3 },
    ]),
  ).toEqual({
    ...base,
    schemaDigest: next.schemaDigest,
    ledgerDigest: next.ledgerDigest,
  });
});

import { generateKeyPairSync, sign } from "node:crypto";
import {
  NativeUpgradeInspection,
  type NativeUpgradeInspectionConfiguration,
} from "./native-upgrade-inspection";
it("uses journal-derived version for capabilities after authenticating the bootstrap receipt", async () => {
  const key = generateKeyPairSync("ed25519");
  const payload = Buffer.from(JSON.stringify(base)).toString("base64url");
  const signed = JSON.stringify({
    payload,
    signature: sign(
      null,
      Buffer.from(`CRA-UPGRADE-installed-V1\0${payload}`),
      key.privateKey,
    ).toString("base64url"),
  });
  const config: NativeUpgradeInspectionConfiguration = {
    instanceId: id,
    installedReceiptPath: "/installed",
    qualificationReceiptPath: "/qualification",
    receiptPublicKey: key.publicKey
      .export({ format: "pem", type: "spki" })
      .toString(),
    supervisorVersion: "1",
    trustDigest: d("a"),
    dockerExecutable: "/docker",
    psqlExecutable: "/psql",
    pgDumpExecutable: "/pg_dump",
    cwd: "/host",
    diskRoot: "/disk",
    maintenanceRequestPath: "/maintenance",
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
  const inspector = new NativeUpgradeInspection(config, {
    read: () => Promise.resolve(signed),
    readInstalledRecords: () => Promise.resolve(transition(base, next)),
    backup: () => Promise.reject(new Error("must not capture")),
  });
  expect(await inspector.installedVersion()).toBe(next.version);
  const invalid = new NativeUpgradeInspection(config, {
    read: () => Promise.resolve(signed.replace('"payload":"', '"payload":"x')),
    readInstalledRecords: () => Promise.resolve(transition(base, next)),
    backup: () => Promise.reject(new Error("must not capture")),
  });
  await expect(invalid.installedVersion()).rejects.toThrow();
});
