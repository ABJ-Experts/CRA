import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { BackupExecutionError } from "../../application/backup-execution.port";
import type { BackupMountedRuntime } from "./backup-mounted-runtime";
import { NativeBackupProcess } from "./native-backup-process";
import { NativeBackupSourceTools } from "./native-backup-source";
import { assertStageOutsideSourceMounts } from "../restore/restore-configuration";

const alias = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const ownerSchema = z.strictObject({
  version: z.literal(1),
  instanceId: z.uuid(),
  runId: z.uuid(),
  sourceAlias: alias,
  repositoryAlias: alias,
  stagingAlias: alias,
  repositoryGeneration: z.uuid(),
  tool: z.string().regex(/^cra-backup-[a-f0-9-]{36}$/),
  sourceContainerId: z.string().regex(/^[a-f0-9]{64}$/),
  sourceSystemIdentifier: z.string().regex(/^\d{1,20}$/),
  ownerHost: z.string().regex(/^[a-f0-9]{64}$/),
  ownerPid: z.number().int().min(1).max(2147483647),
});
type Owner = z.output<typeof ownerSchema>;
const host = () => createHash("sha256").update(hostname()).digest("hex");
function labels(owner: Owner): Readonly<Record<string, string>> {
  return {
    "cra.backup.feature": "m15-05",
    "cra.backup.capture": owner.tool,
    "cra.backup.instance": owner.instanceId,
    "cra.backup.capture-run": owner.runId,
    "cra.backup.capture-owner": createHash("sha256")
      .update(JSON.stringify(owner))
      .digest("hex"),
  };
}
async function privateDirectory(path: string): Promise<void> {
  const stat = await lstat(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    (await realpath(path)) !== resolve(path)
  )
    throw new BackupExecutionError("capture_cleanup_unsafe");
}
async function syncDirectory(path: string): Promise<void> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}

/** Persisted before creating any tool or temporary slot; contains no source credentials. */
export async function recordCaptureResourceOwnership(
  runtime: BackupMountedRuntime,
  input: {
    readonly instanceId: string;
    readonly runId: string;
    readonly sourceAlias: string;
    readonly repositoryAlias: string;
    readonly stagingAlias: string;
    readonly tool: string;
    readonly sourceContainerId: string;
    readonly sourceSystemIdentifier: string;
    readonly ownerPid?: number;
  },
): Promise<{
  readonly path: string;
  readonly labels: Readonly<Record<string, string>>;
}> {
  const repository = runtime.repositories[input.repositoryAlias];
  if (
    !repository ||
    !runtime.sources[input.sourceAlias] ||
    !runtime.staging[input.stagingAlias]
  )
    throw new BackupExecutionError("capture_cleanup_unsafe");
  const { ownerPid, ...identity } = input;
  const owner = ownerSchema.parse({
    ...identity,
    version: 1,
    repositoryGeneration: repository.generation,
    ownerHost: host(),
    ownerPid: ownerPid ?? process.pid,
  });
  await privateDirectory(repository.path);
  const directory = join(repository.path, "capture-owners");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await privateDirectory(directory);
  const path = join(directory, `${owner.tool}.json`);
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(owner));
    await file.sync();
  } finally {
    await file.close();
  }
  await syncDirectory(directory);
  await syncDirectory(repository.path);
  return { path, labels: labels(owner) };
}
export function temporaryCaptureSlotNames(
  tool: string,
): readonly [string, string] {
  if (!/^cra-backup-[a-f0-9-]{36}$/.test(tool))
    throw new BackupExecutionError("capture_cleanup_unsafe");
  const token = tool.slice("cra-backup-".length).replaceAll("-", "");
  return [`cra_backup_hold_${token}`, `cra_backup_recv_${token}`];
}
function deadOwner(owner: Owner): boolean {
  if (owner.ownerHost !== host()) return false;
  try {
    process.kill(owner.ownerPid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}
async function readOwner(path: string): Promise<Owner> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 16384)
      throw new BackupExecutionError("capture_cleanup_unsafe");
    return ownerSchema.parse(JSON.parse(await file.readFile("utf8")));
  } finally {
    await file.close();
  }
}

/** No prefix adoption: only exact durable ownership, a dead local executor and fresh terminal authority permit removal. */
export async function reconcileStaleCaptureResources(
  runtime: BackupMountedRuntime,
  instanceId: string,
  authorize: (runId: string) => Promise<boolean>,
  signal: AbortSignal,
  native = new NativeBackupProcess(),
): Promise<{ readonly removed: number; readonly retained: number }> {
  z.uuid().parse(instanceId);
  const tools = new NativeBackupSourceTools(native);
  const run = (args: readonly string[]) => native.run("docker", args, signal);
  let removed = 0,
    retained = 0,
    visited = 0;
  for (const [repositoryAlias, repository] of Object.entries(
    runtime.repositories,
  )) {
    await privateDirectory(repository.path);
    const directory = join(repository.path, "capture-owners");
    let names: string[];
    try {
      await privateDirectory(directory);
      names = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const name of names) {
      signal.throwIfAborted();
      if (++visited > 1000) return { removed, retained };
      if (!/^cra-backup-[a-f0-9-]{36}\.json$/.test(name)) continue;
      try {
        const path = join(directory, name),
          owner = await readOwner(path);
        const source = runtime.sources[owner.sourceAlias],
          staging = runtime.staging[owner.stagingAlias];
        if (
          owner.instanceId !== instanceId ||
          owner.repositoryAlias !== repositoryAlias ||
          owner.repositoryGeneration !== repository.generation ||
          name !== `${owner.tool}.json` ||
          !source ||
          !staging ||
          !deadOwner(owner)
        )
          throw new BackupExecutionError("capture_cleanup_unsafe");
        const assertAuthority = async () => {
          signal.throwIfAborted();
          if (
            !(await authorize(owner.runId)) ||
            (await run([
              "inspect",
              "--format",
              "{{.Id}}",
              source.databaseContainer,
            ])) !== owner.sourceContainerId ||
            (await tools.sql(
              source,
              source.databaseName,
              "SELECT system_identifier::text FROM pg_control_system()",
              signal,
            )) !== owner.sourceSystemIdentifier
          )
            throw new BackupExecutionError("capture_cleanup_unsafe");
        };
        await assertAuthority();
        const names = await run([
          "ps",
          "--all",
          "--filter",
          `name=^/${owner.tool}$`,
          "--format",
          "{{.Names}}",
        ]);
        if (names.split("\n").includes(owner.tool)) {
          const observed: unknown = JSON.parse(
            await run([
              "inspect",
              "--format",
              "{{json .Config.Labels}}",
              owner.tool,
            ]),
          );
          if (
            !observed ||
            typeof observed !== "object" ||
            Object.entries(labels(owner)).some(
              ([key, value]) =>
                (observed as Record<string, unknown>)[key] !== value,
            )
          )
            throw new BackupExecutionError("capture_cleanup_unsafe");
          await assertAuthority();
          await run(["rm", "--force", owner.tool]);
        }
        await assertAuthority();
        const [hold, receiver] = temporaryCaptureSlotNames(owner.tool);
        const count = await tools.sql(
          source,
          source.databaseName,
          `SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots WHERE slot_name IN ('${hold}','${receiver}') AND slot_type='physical' AND database IS NULL AND NOT active; SELECT count(*) FROM pg_replication_slots WHERE slot_name IN ('${hold}','${receiver}');`,
          signal,
        );
        if (count.trim() !== "0")
          throw new BackupExecutionError("capture_cleanup_unsafe");
        if (staging.kind === "encrypted") {
          await privateDirectory(staging.path);
          const stageStat = await lstat(staging.path);
          if (!staging.attestedMount || stageStat.dev !== staging.mountDevice)
            throw new BackupExecutionError("capture_cleanup_unsafe");
          const scratch = join(staging.path, owner.tool);
          try {
            await privateDirectory(scratch);
            await assertStageOutsideSourceMounts(
              scratch,
              [source.databaseContainer, source.storageContainer],
              (containers) =>
                run(["inspect", "--format", "{{json .Mounts}}", ...containers]),
            );
            await assertAuthority();
            await rm(scratch, { recursive: true, force: true });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
        await assertAuthority();
        await rm(path);
        await syncDirectory(directory);
        removed += 1;
      } catch {
        signal.throwIfAborted();
        retained += 1;
      }
    }
  }
  return { removed, retained };
}
