import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, readdir, realpath, mkdir, open, link } from "node:fs/promises";
import { join } from "node:path";
import type { DeploymentPlan } from "../../application/deployment-lifecycle.port";
import type { NativeCommandRunner } from "./linux-deployment.adapter";

export interface ExactCliMigrationConfiguration {
  readonly cliExecutable: string;
  readonly cliVersion: string;
  readonly cwd: string;
  readonly migrationDirectory: string;
  /** Password-free explicit target; never infer a local default database. */
  readonly databaseUrl: string;
  readonly environment: Readonly<Record<string, string>>;
  /** Qualification receipt for pinned CLI's transaction+ledger commit behavior. */
  readonly atomicLedgerQualified: boolean;
  /** Host-authorized historical inventory, never supplied by candidate media. */
  readonly baselineFiles: Readonly<Record<string, string>>;
}
/** Uses only a host-owned CLI working directory containing the reviewed complete history. */
export class ExactCliMigrations {
  constructor(
    private readonly config: ExactCliMigrationConfiguration,
    private readonly runner: NativeCommandRunner,
    private readonly readLedger: () => Promise<readonly string[]>,
    private readonly readLedgerDigest: () => Promise<string>,
  ) {}
  async apply(plan: DeploymentPlan): Promise<void> {
    if (!this.config.atomicLedgerQualified)
      throw new Error("upgrade_cli_atomicity_unqualified");
    const target = new URL(this.config.databaseUrl);
    if (
      target.protocol !== "postgresql:" ||
      target.password ||
      !target.username ||
      !target.hostname ||
      !target.port ||
      target.search ||
      target.hash ||
      target.pathname.length < 2
    )
      throw new Error("upgrade_migration_target");
    const audited = await realpath(this.config.migrationDirectory);
    if (
      audited !==
      (await realpath(join(this.config.cwd, "supabase", "migrations")))
    )
      throw new Error("upgrade_migration_workdir");
    const options = {
      cwd: this.config.cwd,
      environment: this.config.environment,
    };
    const baseline = Object.keys(this.config.baselineFiles)
      .sort()
      .map((name) => name.split("_")[0]);
    const pending = plan.migrations.map(
      (migration) => migration.name.split("_")[0]!,
    );
    if (
      JSON.stringify(baseline) !== JSON.stringify(plan.baselineLedger) ||
      JSON.stringify([...pending].sort()) !== JSON.stringify(pending) ||
      new Set(pending).size !== pending.length ||
      pending.some(
        (version) =>
          plan.baselineLedger.includes(version) ||
          (baseline.length > 0 && version <= baseline.at(-1)!),
      )
    )
      throw new Error("upgrade_migration_order");
    await this.inventory(plan);
    const version = (
      await this.runner.run(this.config.cliExecutable, ["--version"], options)
    ).trim();
    if (version !== this.config.cliVersion)
      throw new Error("upgrade_cli_version");
    if (
      JSON.stringify(await this.readLedger()) !==
      JSON.stringify(plan.baselineLedger)
    )
      throw new Error("upgrade_historical_ledger_drift");
    // Exact reviewed inventory and explicit target prevent historical repair or default DB selection.
    // The separately provisioned runner must prove this exact pinned CLI commits each SQL
    // migration and its schema_migrations row atomically before this adapter is enabled.
    await this.runner.run(
      this.config.cliExecutable,
      [
        "--workdir",
        this.config.cwd,
        "migration",
        "up",
        "--db-url",
        this.config.databaseUrl,
      ],
      options,
    );
    const targetLedger = [
      ...plan.baselineLedger,
      ...plan.migrations.map((migration) => migration.name.split("_")[0]),
    ];
    if (
      JSON.stringify(await this.readLedger()) !==
        JSON.stringify(targetLedger) ||
      (await this.readLedgerDigest()) !== plan.expectedLedgerDigest
    )
      throw new Error("upgrade_migration_ack_unconfirmed");
  }
  private async inventory(plan: DeploymentPlan): Promise<void> {
    const directory = await lstat(this.config.migrationDirectory);
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      (directory.mode & 0o022) !== 0
    )
      throw new Error("upgrade_migration_directory");
    const pending = Object.fromEntries(
      plan.migrations.map((migration) => [migration.name, migration.sha256]),
    );
    const expected = { ...this.config.baselineFiles, ...pending };
    if (
      Object.keys(expected).length !==
      Object.keys(this.config.baselineFiles).length + plan.migrations.length
    )
      throw new Error("upgrade_migration_collision");
    const actual = await readdir(this.config.migrationDirectory);
    if (
      actual.some((name) => !Object.hasOwn(expected, name)) ||
      Object.keys(this.config.baselineFiles).some(
        (name) => !actual.includes(name),
      )
    )
      throw new Error("upgrade_migration_inventory");
    for (const [name, digest] of Object.entries(expected)) {
      if (
        !/^\d{14}_[a-z0-9_]+\.sql$/.test(name) ||
        !/^[a-f0-9]{64}$/.test(digest)
      )
        throw new Error("upgrade_migration_identity");
      const signed = plan.migrations.find(
        (migration) => migration.name === name,
      );
      if (signed) {
        if (
          Buffer.byteLength(signed.sql) > 16 * 1024 * 1024 ||
          createHash("sha256").update(signed.sql).digest("hex") !== digest
        )
          throw new Error("upgrade_migration_content");
        if (
          /\b(?:BEGIN|COMMIT|ROLLBACK|VACUUM|CONCURRENTLY|CREATE\s+DATABASE|ALTER\s+SYSTEM|COPY\s+.*PROGRAM)\b/i.test(
            signed.sql,
          )
        )
          throw new Error("upgrade_migration_nontransactional");
      }
      if (!actual.includes(name)) continue;
      await this.verifyFile(name, digest);
    }
    // Validate the complete inventory before publishing any candidate statement.
    for (const migration of plan.migrations) {
      this.runner.assertActive?.();
      if (this.runner.signal?.aborted)
        throw new Error("upgrade_execution_cancelled");
      if (!actual.includes(migration.name)) await this.publish(migration);
    }
    const final = await readdir(this.config.migrationDirectory);
    if (
      JSON.stringify(final.sort()) !==
      JSON.stringify(Object.keys(expected).sort())
    )
      throw new Error("upgrade_migration_inventory");
    for (const [name, digest] of Object.entries(expected))
      await this.verifyFile(name, digest);
  }
  private async verifyFile(name: string, digest: string): Promise<void> {
    const path = join(this.config.migrationDirectory, name);
    const stat = await lstat(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o022) !== 0 ||
      stat.size > 16 * 1024 * 1024
    )
      throw new Error("upgrade_migration_file");
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const content = await file.readFile();
      if (createHash("sha256").update(content).digest("hex") !== digest)
        throw new Error("upgrade_migration_digest");
    } finally {
      await file.close();
    }
  }
  private async publish(
    migration: DeploymentPlan["migrations"][number],
  ): Promise<void> {
    // Retain interrupted staging artifacts outside the CLI inventory; never truncate or replace.
    const staging = join(this.config.cwd, ".cra-upgrade-migration-staging");
    await mkdir(staging, { recursive: true, mode: 0o700 });
    const stat = await lstat(staging);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0
    )
      throw new Error("upgrade_migration_staging");
    const source = join(staging, `${randomUUID()}.sql`);
    const file = await open(
      source,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.writeFile(migration.sql, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await this.syncDirectory(staging);
    this.runner.assertActive?.();
    if (this.runner.signal?.aborted)
      throw new Error("upgrade_execution_cancelled");
    try {
      await link(source, join(this.config.migrationDirectory, migration.name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await this.verifyFile(migration.name, migration.sha256);
    }
    await this.syncDirectory(this.config.migrationDirectory);
  }
  private async syncDirectory(path: string): Promise<void> {
    const directory = await open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}
