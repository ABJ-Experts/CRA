import {
  createUpgradeAuditRuntime,
  upgradeAuditRuntimeConfigurationSchema,
} from "../audit/upgrade-audit-runtime";
import { loadVerifiedUpgradeImages } from "../deployment/load-verified-upgrade-images";
import { NativeFlock } from "../journal/native-flock";
import { OperatorGrantStore } from "../../../operator/operator-security";
import { createHash } from "node:crypto";
import { z } from "zod";
import { UpgradeSupervisor } from "../../application/upgrade-supervisor";
import { matchesApprovedImportReview } from "../../application/upgrade-import-review";
import type { VerifiedUpgradeBundle } from "../media/mounted-upgrade-media";
import {
  preflightUpgrade,
  type UpgradePreflightFacts,
} from "../../domain/upgrade-preflight";
import { UpgradeHostJournal } from "../journal/upgrade-host-journal";
import { NativeLinuxDeploymentHost } from "../deployment/native-linux-deployment-host";
import {
  LinuxDeploymentAdapter,
  ShellFreeCommandRunner,
} from "../deployment/linux-deployment.adapter";
import {
  createUpgradeBackupRuntime,
  upgradeBackupRuntimeConfigurationSchema,
} from "../backup/upgrade-backup-runtime";
import {
  NativeUpgradeInspection,
  nativeUpgradeInspectionConfigSchema,
} from "./native-upgrade-inspection";
import {
  SupervisorMountedMedia,
  type loadUpgradeSupervisorRuntime,
} from "./upgrade-supervisor-runtime";
import { readUpgradeControlKey } from "./local-upgrade-control";
import { mergeInstalledMigrationFiles } from "./current-installed-upgrade-identity";
const path = z.string().startsWith("/");
const env = z.record(z.string(), z.string());
const services = z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).min(1);
export const upgradeSupervisorCompositionSchema = z.strictObject({
  inspection: nativeUpgradeInspectionConfigSchema,
  backup: upgradeBackupRuntimeConfigurationSchema,
  audit: upgradeAuditRuntimeConfigurationSchema,
  host: z.strictObject({
    deployment: z.strictObject({
      dockerExecutable: path,
      composeFile: path,
      project: z.string(),
      cwd: path,
      candidateServices: services,
      workerServices: services,
      serviceRoles: z.record(z.string(), z.enum(["api", "web"])),
      imageVariables: z.strictObject({ api: z.string(), web: z.string() }),
      environment: env,
    }),
    maintenanceDirectory: path,
    acknowledgementDirectory: path,
    selectionDirectory: path,
    selectionKeyPath: path,
    drainServices: services,
    fixedServices: services,
    organizationIds: z.array(z.uuid()).min(1),
    psqlExecutable: path,
    pgDumpExecutable: path,
    databaseEnvironment: env,
    candidateReadinessUrl: z.url(),
    workerReadinessUrl: z.url(),
    migrations: z.strictObject({
      databaseUrl: z.url(),
      cliExecutable: path,
      cwd: path,
      migrationDirectory: path,
      environment: env,
      baselineFiles: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
    }),
  }),
});
export async function composeUpgradeSupervisor(
  mounted: NonNullable<
    Awaited<ReturnType<typeof loadUpgradeSupervisorRuntime>>
  >,
) {
  const { config, controlKey, journalKey } = mounted;
  const runtime = upgradeSupervisorCompositionSchema.parse(config.runtime);
  if (runtime.inspection.instanceId !== config.instanceId)
    throw new Error("upgrade_instance_conflict");
  const lifetime = new AbortController();
  const runner = new ShellFreeCommandRunner();
  const flock = new NativeFlock();
  const journal = new UpgradeHostJournal({
    lock: {
      run: async (path, effect) => {
        lifetime.signal.throwIfAborted();
        return flock.run(path, async (signal) => {
          const lost = () => {
            lifetime.abort();
            runner.abortAll();
          };
          signal.addEventListener("abort", lost, { once: true });
          try {
            return await effect(signal);
          } finally {
            signal.removeEventListener("abort", lost);
          }
        });
      },
    },
    root: config.journalRoot,
    key: journalKey,
    instanceId: config.instanceId,
    minimumSequence: config.minimumJournalSequence,
  });
  await journal.read();
  const audit = await createUpgradeAuditRuntime(runtime.audit, { journal });
  await audit.flush();
  const media = new SupervisorMountedMedia(config, controlKey);
  const backup = await createUpgradeBackupRuntime({
    ...runtime.backup,
    instanceId: config.instanceId,
    journalBinding: createHash("sha256")
      .update(config.journalRoot)
      .digest("hex"),
    hostKey: journalKey,
  });
  const selectionKey = await readUpgradeControlKey(
    runtime.host.selectionKeyPath,
  );

  const importedApproval = async (
    bundle: VerifiedUpgradeBundle,
    runId: string,
    fingerprint?: string,
  ): Promise<UpgradePreflightFacts | undefined> => {
    if (!fingerprint) return undefined;
    const records = await journal.read();
    if (
      !records.some(
        (r) =>
          r.kind === "image-load-result" &&
          r.runId === runId &&
          r.data.manifestDigest === bundle.manifestDigest &&
          r.data.fingerprint === fingerprint,
      )
    )
      return undefined;
    const record = records.findLast(
      (r) => r.kind === "run" && r.runId === runId && r.data.facts,
    );
    const approved = record?.data.facts as UpgradePreflightFacts | undefined;
    if (
      !approved ||
      preflightUpgrade(approved, new Date()).fingerprint !== fingerprint
    )
      throw new Error("upgrade_import_approval_missing");
    return approved;
  };
  const inspection = new NativeUpgradeInspection(runtime.inspection, {
    runner,
    readInstalledRecords: () => journal.read(),
    backup: async (runId) => {
      const hold = await backup.validateExisting(runId, lifetime.signal);
      return {
        certificateDigest: hold.certificateDigest,
        verified: true,
        held: true,
        keysAvailable: true,
      };
    },
  });
  const supervisor: UpgradeSupervisor = new UpgradeSupervisor({
    instanceId: config.instanceId,
    readGrants: () => new OperatorGrantStore(config.grantsPath).read(),
    journal,
    media,
    flushAudit: () => audit.flush(),
    loadImages: async (bundle) => {
      await media.revalidate(bundle);
      await loadVerifiedUpgradeImages(bundle, runner, runtime.host.deployment);
    },
    capabilities: async () => ({
      instanceId: config.instanceId,
      enabled: true,
      actions: [
        "upgrades.view",
        "upgrades.stage",
        "upgrades.apply",
        "upgrades.rollback",
      ],
      platform: {
        os: "linux",
        architecture: process.arch === "arm64" ? "arm64" : "amd64",
      },
      currentVersion: await inspection.installedVersion(),
      supervisorVersion: runtime.inspection.supervisorVersion,
      maintenance: await inspection.maintenanceActive(),
      version: 0,
    }),
    resume: async (bundle, actor, plan, facts) => {
      await media.revalidate(bundle);
      const deployment = {
        ...runtime.host.deployment,
        expectedVersion: bundle.manifest.version,
      };
      const releaseVersions = Object.fromEntries<string>([
        ...plan.previousImages.map((image): readonly [string, string] => [
          image.imageId,
          facts.currentVersion,
        ]),
        ...plan.candidateImages.map((image): readonly [string, string] => [
          image.imageId,
          bundle.manifest.version,
        ]),
      ]);
      const host = new NativeLinuxDeploymentHost(
        {
          ...runtime.host,
          deployment,
          selectionKey,
          releaseVersions,
          migrations: {
            ...runtime.host.migrations,
            cliVersion: "unavailable",
            atomicLedgerQualified: false,
          },
        },
        runner,
        {
          assertFresh: async () => {
            await supervisor.authorize(actor, "run/rollback");
            await media.revalidate(bundle);
          },
          holdVerifiedBackup: async () => {
            await backup.checkpointAfterDrain(plan.runId, lifetime.signal);
          },
        },
      );
      await host.initializeSelection(plan.previousImages);
      return new LinuxDeploymentAdapter(deployment, runner, host);
    },
    prepare: async (bundle, actor, runId, window) => {
      await media.revalidate(bundle);
      const approved = await importedApproval(
        bundle,
        runId,
        window?.fingerprint,
      );
      const inspected = await inspection.inspect(
        bundle,
        actor,
        runId,
        window,
        approved ? { imagesImported: true } : undefined,
      );
      if (
        approved &&
        !matchesApprovedImportReview(
          approved,
          inspected.facts,
          window!.fingerprint!,
          new Date(),
        )
      )
        throw new Error("upgrade_review_stale");
      const observed = approved
        ? {
            ...inspected,
            facts: {
              ...inspected.facts,
              freeBytes: approved.freeBytes,
              requiredBytes: approved.requiredBytes,
            },
            plan: { ...inspected.plan, fingerprint: window!.fingerprint! },
          }
        : inspected;
      const deployment = {
        ...runtime.host.deployment,
        expectedVersion: bundle.manifest.version,
      };
      const releaseVersions = Object.fromEntries<string>([
        ...observed.plan.previousImages.map(
          (image): readonly [string, string] => [
            image.imageId,
            observed.facts.currentVersion,
          ],
        ),
        ...observed.plan.candidateImages.map(
          (image): readonly [string, string] => [
            image.imageId,
            bundle.manifest.version,
          ],
        ),
      ]);
      const host = new NativeLinuxDeploymentHost(
        {
          ...runtime.host,
          deployment,
          selectionKey,
          releaseVersions,
          migrations: {
            ...runtime.host.migrations,
            baselineFiles: mergeInstalledMigrationFiles(
              runtime.host.migrations.baselineFiles,
              observed.committedMigrations,
            ),
            cliVersion: observed.qualification.cliVersion,
            atomicLedgerQualified: observed.qualification.atomicLedger,
          },
        },
        runner,
        {
          assertFresh: async (fingerprint) => {
            await supervisor.authorize(actor, "run/apply");
            await media.revalidate(bundle);
            const approvedImport = await importedApproval(
              bundle,
              runId,
              fingerprint,
            );
            const fresh = await inspection.inspect(
              bundle,
              actor,
              runId,
              {
                checkedAt: observed.facts.checkedAt,
                expiresAt: observed.facts.expiresAt,
              },
              approvedImport ? { imagesImported: true } : undefined,
            );
            const result = preflightUpgrade(fresh.facts, new Date());
            const matches = approvedImport
              ? matchesApprovedImportReview(
                  approvedImport,
                  fresh.facts,
                  fingerprint,
                  new Date(),
                )
              : result.allowed && result.fingerprint === fingerprint;
            if (!matches) throw new Error("upgrade_review_stale");
          },
          holdVerifiedBackup: async () => {
            await backup.checkpointAfterDrain(runId, lifetime.signal);
          },
        },
      );
      await host.initializeSelection(observed.plan.previousImages);
      const lifecycle = new LinuxDeploymentAdapter(deployment, runner, host);
      return { ...observed, lifecycle };
    },
  });
  return supervisor;
}
