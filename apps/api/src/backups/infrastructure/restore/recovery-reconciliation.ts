import { createHash } from "node:crypto";
import { hostname } from "node:os";
import {
  lstat,
  realpath,
  rm,
  opendir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { BackupExecutionError } from "../../application/backup-execution.port";
import type { BackupMountedRuntime } from "../capture/backup-mounted-runtime";
import {
  sameRecoveryOwnership,
  ownedRecoveryProbeMembers,
} from "./recovery-probe-reconciliation";
import { assertStageOutsideSourceMounts } from "./restore-configuration";
import { NativeBackupProcess } from "../capture/native-backup-process";
import {
  assertOwnedRecoveryObjectVolume,
  removeOwnedRecoveryObjectVolume,
} from "./recovery-object-volume";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const target = /^cra-backup-restore-[a-f0-9-]{36}$/;
const feature = "m15-05";
const localHost = () => createHash("sha256").update(hostname()).digest("hex");
export function recoveryOwnershipLabels(
  instanceId: string,
  runId: string,
  name: string,
  directory: string,
): Readonly<Record<string, string>> {
  if (
    !uuid.test(instanceId) ||
    !uuid.test(runId) ||
    !target.test(name) ||
    !new RegExp(`^${name}-[A-Za-z0-9]{6}$`).test(directory)
  )
    throw new BackupExecutionError("recovery_cleanup_unsafe");
  return {
    "cra.backup.feature": feature,
    "cra.backup.instance": instanceId,
    "cra.backup.verification-run": runId,
    "cra.backup.restore": name,
    "cra.backup.staging": directory,
    "cra.backup.owner-host": localHost(),
    "cra.backup.owner-pid": String(process.pid),
  };
}
function deadLocalOwner(
  labels: Readonly<Record<string, string>>,
  instanceId: string,
  name: string,
): boolean {
  if (
    labels["cra.backup.feature"] !== feature ||
    labels["cra.backup.instance"] !== instanceId ||
    labels["cra.backup.restore"] !== name ||
    labels["cra.backup.owner-host"] !== localHost() ||
    !uuid.test(labels["cra.backup.verification-run"] ?? "") ||
    !new RegExp(`^${name}-[A-Za-z0-9]{6}$`).test(
      labels["cra.backup.staging"] ?? "",
    )
  )
    return false;
  const pid = Number(labels["cra.backup.owner-pid"]);
  if (!Number.isInteger(pid) || pid <= 0 || pid > 2147483647) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}
function parseLabels(input: string): Readonly<Record<string, string>> | null {
  const value: unknown = JSON.parse(input);
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.values(value).some((item) => typeof item !== "string")
  )
    return null;
  return value as Readonly<Record<string, string>>;
}
async function ownedDirectory(
  runtime: BackupMountedRuntime,
  label: string,
): Promise<string | null> {
  const matches: string[] = [];
  for (const staging of Object.values(runtime.staging)) {
    if (staging.kind !== "encrypted" || !staging.attestedMount) continue;
    const stat = await lstat(staging.path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0 ||
      stat.dev !== staging.mountDevice ||
      (await realpath(staging.path)) !== resolve(staging.path)
    )
      continue;
    const directory = join(staging.path, label);
    try {
      const child = await lstat(directory);
      if (
        child.isDirectory() &&
        !child.isSymbolicLink() &&
        child.dev === staging.mountDevice &&
        (await realpath(directory)) === resolve(directory)
      )
        matches.push(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return matches.length === 1 ? matches[0]! : null;
}
function safeMounts(input: string, directory: string): boolean {
  const mounts: unknown = JSON.parse(input);
  if (!Array.isArray(mounts)) return false;
  return (mounts as readonly unknown[]).every((value) => {
    if (!value || typeof value !== "object") return false;
    const mount = value as Record<string, unknown>;
    if (mount.Type === "tmpfs") return mount.Destination === "/tmp";
    if (
      typeof mount.Source !== "string" ||
      typeof mount.Destination !== "string" ||
      !resolve(mount.Source).startsWith(resolve(directory) + sep)
    )
      return false;
    return [
      "/var/lib/postgresql/data",
      "/restore-wal",
      "/etc/postgresql-custom/pgsodium_root.key",
    ].includes(mount.Destination);
  });
}

const markerName = ".cra-backup-recovery-owner.json";
export async function recordRecoveryStagingOwnership(
  instanceId: string,
  runId: string,
  name: string,
  directory: string,
  ownerPid = process.pid,
): Promise<void> {
  const labels = recoveryOwnershipLabels(
    instanceId,
    runId,
    name,
    basename(directory),
  );
  if (!Number.isInteger(ownerPid) || ownerPid <= 0 || ownerPid > 2147483647)
    throw new BackupExecutionError("recovery_cleanup_unsafe");
  await writeFile(
    join(directory, markerName),
    JSON.stringify({ ...labels, "cra.backup.owner-pid": String(ownerPid) }),
    { mode: 0o600, flag: "wx" },
  );
}
async function reconcileMarkedDirectories(
  runtime: BackupMountedRuntime,
  instanceId: string,
  authorize: (runId: string) => Promise<boolean>,
  signal: AbortSignal,
  run: (args: readonly string[]) => Promise<string>,
  live: ReadonlySet<string>,
): Promise<{ removed: number; retained: number }> {
  let removed = 0,
    retained = 0,
    visited = 0;
  for (const staging of Object.values(runtime.staging)) {
    if (staging.kind !== "encrypted" || !staging.attestedMount) continue;
    const stat = await lstat(staging.path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.dev !== staging.mountDevice ||
      (stat.mode & 0o077) !== 0 ||
      (await realpath(staging.path)) !== resolve(staging.path)
    )
      continue;
    for await (const entry of await opendir(staging.path)) {
      signal.throwIfAborted();
      if (++visited > 1000) return { removed, retained };
      const match = /^(cra-backup-restore-[a-f0-9-]{36})-[A-Za-z0-9]{6}$/.exec(
        entry.name,
      );
      if (!entry.isDirectory() || !match || live.has(match[1]!)) continue;
      try {
        const directory = await ownedDirectory(runtime, entry.name);
        if (!directory) continue;
        const marker = join(directory, markerName),
          markerStat = await lstat(marker);
        if (
          !markerStat.isFile() ||
          markerStat.isSymbolicLink() ||
          (markerStat.mode & 0o077) !== 0 ||
          markerStat.size > 16384
        )
          continue;
        const labels = parseLabels(await readFile(marker, "utf8"));
        if (!labels || !deadLocalOwner(labels, instanceId, match[1]!)) {
          retained += 1;
          continue;
        }
        if (!(await authorize(labels["cra.backup.verification-run"]!))) {
          retained += 1;
          continue;
        }
        await assertStageOutsideSourceMounts(
          directory,
          Object.values(runtime.sources).flatMap((source) => [
            source.databaseContainer,
            source.storageContainer,
          ]),
          (containers) =>
            run(["inspect", "--format", "{{json .Mounts}}", ...containers]),
        );
        await run([
          "run",
          "--pull=never",
          "--rm",
          "--network",
          "none",
          "--mount",
          `type=bind,src=${directory},dst=/restore`,
          "--entrypoint",
          "chown",
          "public.ecr.aws/supabase/postgres:17.6.1.156",
          "-R",
          `${process.getuid?.() ?? 501}:${process.getgid?.() ?? 20}`,
          "/restore",
        ]);
        await rm(directory, { recursive: true, force: true });
        removed += 1;
      } catch {
        signal.throwIfAborted();
        retained += 1;
      }
    }
  }
  return { removed, retained };
}

/** Only abandoned verification scratch is eligible; sealed repository contents are never inspected or removed. */
export async function reconcileStaleRecoveryTargets(
  runtime: BackupMountedRuntime,
  instanceId: string,
  authorize: (runId: string) => Promise<boolean>,
  signal: AbortSignal,
  native = new NativeBackupProcess(),
): Promise<{ readonly removed: number; readonly retained: number }> {
  if (!uuid.test(instanceId))
    throw new BackupExecutionError("recovery_cleanup_unsafe");
  const run = (args: readonly string[]) => native.run("docker", args, signal);
  const filters = [
    "--filter",
    `label=cra.backup.feature=${feature}`,
    "--filter",
    `label=cra.backup.instance=${instanceId}`,
  ];
  const [containerList, networkList, volumeList] = await Promise.all([
    run(["ps", "--all", ...filters, "--format", "{{.Names}}"]),
    run(["network", "ls", ...filters, "--format", "{{.Name}}"]),
    run(["volume", "ls", ...filters, "--format", "{{.Name}}"]),
  ]);
  const containers = new Set(
    containerList.split("\n").filter((name) => target.test(name)),
  );
  const networks = new Set(
    networkList
      .split("\n")
      .filter(
        (name) => name.endsWith("-network") && target.test(name.slice(0, -8)),
      ),
  );
  const volumes = new Set(
    volumeList
      .split("\n")
      .filter(
        (name) => name.endsWith("-objects") && target.test(name.slice(0, -8)),
      ),
  );
  const names = [
    ...new Set([
      ...containers,
      ...[...networks].map((name) => name.slice(0, -8)),
      ...[...volumes].map((name) => name.slice(0, -8)),
    ]),
  ];
  let removed = 0,
    retained = 0;
  for (const name of names) {
    signal.throwIfAborted();
    try {
      const labels = parseLabels(
        await run(
          containers.has(name)
            ? ["inspect", "--format", "{{json .Config.Labels}}", name]
            : networks.has(`${name}-network`)
              ? [
                  "network",
                  "inspect",
                  "--format",
                  "{{json .Labels}}",
                  `${name}-network`,
                ]
              : [
                  "volume",
                  "inspect",
                  "--format",
                  "{{json .Labels}}",
                  `${name}-objects`,
                ],
        ),
      );
      if (!labels || !deadLocalOwner(labels, instanceId, name)) {
        retained += 1;
        continue;
      }
      const directory = await ownedDirectory(
        runtime,
        labels["cra.backup.staging"]!,
      );
      if (!directory) {
        retained += 1;
        continue;
      }
      if (
        containers.has(name) &&
        !safeMounts(
          await run(["inspect", "--format", "{{json .Mounts}}", name]),
          directory,
        )
      ) {
        retained += 1;
        continue;
      }
      if (networks.has(`${name}-network`)) {
        const networkLabels = parseLabels(
          await run([
            "network",
            "inspect",
            "--format",
            "{{json .Labels}}",
            `${name}-network`,
          ]),
        );
        if (!networkLabels || !sameRecoveryOwnership(labels, networkLabels)) {
          retained += 1;
          continue;
        }
      }
      if (volumes.has(`${name}-objects`))
        await assertOwnedRecoveryObjectVolume(`${name}-objects`, labels, run);
      const image =
        Object.values(runtime.sources)[0]?.postgresImage ??
        "public.ecr.aws/supabase/postgres:17.6.1.156";
      if (
        !/^(?:public\.ecr\.aws\/)?supabase\/postgres:17\.6\.\d+\.\d+$/.test(
          image,
        )
      )
        throw new BackupExecutionError("recovery_cleanup_unsafe");
      if (!(await authorize(labels["cra.backup.verification-run"]!))) {
        retained += 1;
        continue;
      }
      await assertStageOutsideSourceMounts(
        directory,
        Object.values(runtime.sources).flatMap((source) => [
          source.databaseContainer,
          source.storageContainer,
        ]),
        (containers) =>
          run(["inspect", "--format", "{{json .Mounts}}", ...containers]),
      );
      const probes = networks.has(`${name}-network`)
        ? await ownedRecoveryProbeMembers(
            `${name}-network`,
            name,
            containers.has(name),
            labels,
            run,
          )
        : [];
      if (!probes) {
        retained += 1;
        continue;
      }
      for (const probe of probes) await run(["rm", "--force", probe]);
      if (containers.has(name)) await run(["rm", "--force", name]);
      if (networks.has(`${name}-network`))
        await run(["network", "rm", `${name}-network`]);
      if (volumes.has(`${name}-objects`))
        await removeOwnedRecoveryObjectVolume(`${name}-objects`, labels, run);
      await run([
        "run",
        "--pull=never",
        "--rm",
        "--network",
        "none",
        "--mount",
        `type=bind,src=${directory},dst=/restore`,
        "--entrypoint",
        "chown",
        image,
        "-R",
        `${process.getuid?.() ?? 501}:${process.getgid?.() ?? 20}`,
        "/restore",
      ]);
      if (basename(directory) !== labels["cra.backup.staging"])
        throw new BackupExecutionError("recovery_cleanup_unsafe");
      await rm(directory, { recursive: true, force: true });
      removed += 1;
    } catch {
      signal.throwIfAborted();
      retained += 1;
    }
  }
  const directories = await reconcileMarkedDirectories(
    runtime,
    instanceId,
    authorize,
    signal,
    run,
    new Set(names),
  );
  return {
    removed: removed + directories.removed,
    retained: retained + directories.retained,
  };
}
