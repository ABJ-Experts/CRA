import { createHash } from "node:crypto";
import {
  mkdtemp,
  writeFile,
  rm,
  symlink,
  mkdir,
  readFile,
  readdir,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ExactCliMigrations,
  type ExactCliMigrationConfiguration,
} from "./exact-cli-migrations";
import type { DeploymentPlan } from "../../application/deployment-lifecycle.port";
const hash = (sql: string) => createHash("sha256").update(sql).digest("hex");
describe("exact pinned CLI migrations", () => {
  let directory: string;
  let config: ExactCliMigrationConfiguration;
  let plan: DeploymentPlan;
  const run = jest.fn();
  const ledger = jest.fn();
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "upgrade-migrations-"));
    config = {
      cliExecutable: "/private/supabase",
      cliVersion: "2.0.0",
      cwd: directory,
      migrationDirectory: join(directory, "supabase", "migrations"),
      databaseUrl: "postgresql://postgres@127.0.0.1:54322/postgres",
      environment: {},
      atomicLedgerQualified: true,
      baselineFiles: { "20261014000000_old.sql": hash("select 1;") },
    };
    await mkdir(config.migrationDirectory, { recursive: true, mode: 0o700 });
    plan = {
      runId: "run",
      fingerprint: "review",
      previousImages: [],
      candidateImages: [],
      baselineLedger: ["20261014000000"],
      expectedLedgerDigest: "target-ledger",
      targetSchemaDigest: "target-schema",
      migrations: [
        {
          name: "20261015000000_add.sql",
          sha256: hash("alter table things add column extra text;"),
          sql: "alter table things add column extra text;",
        },
      ],
      previousCompatibleAfterCandidateWrites: true,
    };
    await writeFile(
      join(config.migrationDirectory, "20261014000000_old.sql"),
      "select 1;",
      {
        mode: 0o600,
      },
    );
    await writeFile(
      join(config.migrationDirectory, plan.migrations[0]!.name),
      plan.migrations[0]!.sql,
      { mode: 0o600 },
    );
    run.mockReset().mockResolvedValue("2.0.0");
    ledger
      .mockReset()
      .mockResolvedValueOnce(plan.baselineLedger)
      .mockResolvedValue(["20261014000000", "20261015000000"]);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });
  const adapter = () =>
    new ExactCliMigrations(config, { run }, ledger, () =>
      Promise.resolve("target-ledger"),
    );
  it("executes only after exact full historical+pending inventory validation", async () => {
    await adapter().apply(plan);
    expect(run).toHaveBeenNthCalledWith(
      2,
      config.cliExecutable,
      [
        "--workdir",
        config.cwd,
        "migration",
        "up",
        "--db-url",
        config.databaseUrl,
      ],
      expect.any(Object),
    );
  });
  it("blocks unqualified atomic ledger behavior before invoking CLI", async () => {
    config = { ...config, atomicLedgerQualified: false };
    await expect(adapter().apply(plan)).rejects.toThrow("atomicity");
    expect(run).not.toHaveBeenCalled();
  });
  it("rejects CLI version mismatch", async () => {
    run.mockResolvedValue("2.1.0");
    await expect(adapter().apply(plan)).rejects.toThrow("version");
  });
  it("rejects broad historical drift", async () => {
    ledger.mockReset().mockResolvedValue([]);
    await expect(adapter().apply(plan)).rejects.toThrow("historical");
  });
  it("rejects unknown files and altered content", async () => {
    await writeFile(
      join(config.migrationDirectory, "unknown.sql"),
      "select 1;",
    );
    await expect(adapter().apply(plan)).rejects.toThrow("inventory");
  });
  it("rejects changed signed bytes", async () => {
    await writeFile(
      join(config.migrationDirectory, plan.migrations[0]!.name),
      "select 9;",
    );
    await expect(adapter().apply(plan)).rejects.toThrow("digest");
  });
  it("rejects symlinks", async () => {
    await rm(join(config.migrationDirectory, plan.migrations[0]!.name));
    await symlink(
      join(config.migrationDirectory, "20261014000000_old.sql"),
      join(config.migrationDirectory, plan.migrations[0]!.name),
    );
    await expect(adapter().apply(plan)).rejects.toThrow("file");
  });
  it("does not claim success on missing ledger commit", async () => {
    ledger.mockReset().mockResolvedValue(plan.baselineLedger);
    await expect(adapter().apply(plan)).rejects.toThrow("ack_unconfirmed");
  });
  it.each([
    "COMMIT;",
    "VACUUM things;",
    "CREATE INDEX CONCURRENTLY idx on things(id);",
  ])("rejects nontransactional %s", async (sql) => {
    plan = {
      ...plan,
      migrations: [{ ...plan.migrations[0]!, sql, sha256: hash(sql) }],
    };
    await writeFile(
      join(config.migrationDirectory, plan.migrations[0]!.name),
      sql,
    );
    await expect(adapter().apply(plan)).rejects.toThrow("nontransactional");
  });
  it("rejects plan content differing from signed on-disk bytes", async () => {
    plan = {
      ...plan,
      migrations: [{ ...plan.migrations[0]!, sql: "select 9;" }],
    };
    await expect(adapter().apply(plan)).rejects.toThrow("content");
  });
  it("rejects pending versions older than fixed baseline", async () => {
    plan = {
      ...plan,
      migrations: [{ ...plan.migrations[0]!, name: "20261013000000_bad.sql" }],
    };
    await expect(adapter().apply(plan)).rejects.toThrow("order");
  });
  it("rejects an audited directory outside the explicit CLI project before invoking it", async () => {
    config = { ...config, migrationDirectory: directory };
    await expect(adapter().apply(plan)).rejects.toThrow("workdir");
    expect(run).not.toHaveBeenCalled();
  });
  it("rejects credentials or implicit ports in target URLs", async () => {
    config = {
      ...config,
      databaseUrl: "postgresql://postgres:secret@127.0.0.1/postgres",
    };
    await expect(adapter().apply(plan)).rejects.toThrow("target");
    expect(run).not.toHaveBeenCalled();
  });
  it("rejects successful CLI with wrong full target ledger contents", async () => {
    await expect(
      new ExactCliMigrations(config, { run }, ledger, () =>
        Promise.resolve("wrong-statements"),
      ).apply(plan),
    ).rejects.toThrow("ack_unconfirmed");
  });
  it("materializes verified SQL when the host contains only its baseline", async () => {
    const path = join(config.migrationDirectory, plan.migrations[0]!.name);
    await rm(path);
    run.mockImplementation(async (_exe: string, args: readonly string[]) => {
      expect(await readFile(path, "utf8")).toBe(plan.migrations[0]!.sql);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect((await readdir(config.migrationDirectory)).sort()).toEqual([
        "20261014000000_old.sql",
        plan.migrations[0]!.name,
      ]);
      return args[0] === "--version" ? "2.0.0" : "";
    });
    await adapter().apply(plan);
  });
  it("retains interrupted publication artifacts and safely retries without overwriting", async () => {
    const path = join(config.migrationDirectory, plan.migrations[0]!.name);
    await rm(path);
    const fs =
      jest.requireActual<typeof import("node:fs/promises")>("node:fs/promises");
    const publish = jest
      .spyOn(fs, "link")
      .mockRejectedValueOnce(new Error("publication interrupted"));
    await expect(adapter().apply(plan)).rejects.toThrow(
      "publication interrupted",
    );
    expect(run).not.toHaveBeenCalled();
    expect(ledger).not.toHaveBeenCalled();
    publish.mockRestore();
    await adapter().apply(plan);
    const original = await stat(path);
    ledger
      .mockReset()
      .mockResolvedValueOnce(plan.baselineLedger)
      .mockResolvedValue(["20261014000000", "20261015000000"]);
    await adapter().apply(plan);
    expect((await stat(path)).ino).toBe(original.ino);
    expect(
      (await readdir(join(directory, ".cra-upgrade-migration-staging"))).length,
    ).toBe(2);
  });
  it("validates baseline and every signed pending statement before publication or database commands", async () => {
    const path = join(config.migrationDirectory, plan.migrations[0]!.name);
    await rm(path);
    await writeFile(
      join(config.migrationDirectory, "20261014000000_old.sql"),
      "changed",
    );
    await expect(adapter().apply(plan)).rejects.toThrow("digest");
    expect(run).not.toHaveBeenCalled();
    expect(ledger).not.toHaveBeenCalled();
    expect(await readdir(config.migrationDirectory)).toEqual([
      "20261014000000_old.sql",
    ]);
  });
  it("rejects a later invalid pending statement before publishing an earlier valid one", async () => {
    await rm(join(config.migrationDirectory, plan.migrations[0]!.name));
    plan = {
      ...plan,
      migrations: [
        ...plan.migrations,
        {
          name: "20261016000000_bad.sql",
          sql: "COMMIT;",
          sha256: hash("COMMIT;"),
        },
      ],
    };
    await expect(adapter().apply(plan)).rejects.toThrow("nontransactional");
    expect(await readdir(config.migrationDirectory)).toEqual([
      "20261014000000_old.sql",
    ]);
    expect(run).not.toHaveBeenCalled();
    expect(ledger).not.toHaveBeenCalled();
  });
  it("preserves partial private staging files while publishing a complete new file", async () => {
    await rm(join(config.migrationDirectory, plan.migrations[0]!.name));
    const staging = join(directory, ".cra-upgrade-migration-staging");
    await mkdir(staging, { mode: 0o700 });
    await writeFile(join(staging, "interrupted.sql"), "partial", {
      mode: 0o600,
    });
    await adapter().apply(plan);
    expect(await readFile(join(staging, "interrupted.sql"), "utf8")).toBe(
      "partial",
    );
    expect(
      await readFile(
        join(config.migrationDirectory, plan.migrations[0]!.name),
        "utf8",
      ),
    ).toBe(plan.migrations[0]!.sql);
  });
});
