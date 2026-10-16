import { createHash, createPublicKey, verify } from "node:crypto";
import { constants } from "node:fs";
import { open, statfs } from "node:fs/promises";
import { freemem, platform, arch } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { UpgradeActor } from "../../application/upgrade-control.port";
import type { DeploymentPlan } from "../../application/deployment-lifecycle.port";
import {
  preflightUpgrade,
  type UpgradePreflightFacts,
} from "../../domain/upgrade-preflight";
import type { VerifiedUpgradeBundle } from "../media/mounted-upgrade-media";
import {
  ShellFreeCommandRunner,
  type NativeCommandRunner,
} from "../deployment/linux-deployment.adapter";

import {
  admitVerifiedUpgradeImages,
  verifyImportedUpgradeImages,
} from "../deployment/load-verified-upgrade-images";

import {
  installedUpgradeIdentitySchema,
  projectInstalledUpgradeState,
} from "./current-installed-upgrade-identity";
import type { UpgradeJournalRecord } from "../../application/upgrade-supervisor.port";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const absolute = z.string().startsWith("/");
const alias = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
export const nativeUpgradeInspectionConfigSchema = z.strictObject({
  instanceId: z.uuid(),
  installedReceiptPath: absolute,
  qualificationReceiptPath: absolute,
  receiptPublicKey: z.string().min(1),
  supervisorVersion: z.string().min(1),
  trustDigest: digest,
  dockerExecutable: absolute,
  psqlExecutable: absolute,
  pgDumpExecutable: absolute,
  cwd: absolute,
  diskRoot: absolute,
  maintenanceRequestPath: absolute,
  environment: z.record(z.string(), z.string()),
  sourceNetwork: alias,
  infrastructureContainers: z.strictObject({
    postgres: alias,
    auth: alias,
    rest: alias,
    storage: alias,
    supervisor: alias,
  }),
  applicationContainers: z.record(alias, z.enum(["api", "web"])),
  allowedDatabaseApplications: z.array(z.string().min(1)).min(1),
  organizationIds: z.array(z.uuid()).min(1),
});
export type NativeUpgradeInspectionConfiguration = z.infer<
  typeof nativeUpgradeInspectionConfigSchema
>;
export class NativeUpgradeInspectionBlocker extends Error {
  constructor(
    readonly code:
      | "receipt"
      | "source"
      | "inventory"
      | "backup-checkpoint-unavailable" = "source",
  ) {
    super(`upgrade_inspection_${code}`);
  }
}
export function inspectionDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
/** Canonical schema identity shared by preflight and restart reconciliation. */
export function normalizedSchemaDigest(dump: string): string {
  // PostgreSQL 17+ random restriction tokens change with each dump invocation.
  return createHash("sha256")
    .update(
      dump
        .split("\n")
        .filter(
          (line) =>
            !line.startsWith("\\restrict ") &&
            !line.startsWith("\\unrestrict ") &&
            !line.startsWith("--"),
        )
        .join("\n"),
    )
    .digest("hex");
}
export function verifyInspectionReceipt(
  encoded: string,
  publicKey: string,
  purpose: "installed" | "qualification",
): unknown {
  try {
    if (Buffer.byteLength(encoded) > 262144) throw new Error();
    const envelope = z
      .strictObject({
        payload: z.string().regex(/^[A-Za-z0-9_-]+$/),
        signature: z.string().regex(/^[A-Za-z0-9_-]+$/),
      })
      .parse(JSON.parse(encoded));
    const key = createPublicKey(publicKey);
    const signature = Buffer.from(envelope.signature, "base64url");
    const bytes = Buffer.from(envelope.payload, "base64url");
    if (
      key.asymmetricKeyType !== "ed25519" ||
      signature.toString("base64url") !== envelope.signature ||
      bytes.toString("base64url") !== envelope.payload ||
      !verify(
        null,
        Buffer.from(`CRA-UPGRADE-${purpose}-V1\0${envelope.payload}`),
        key,
        signature,
      )
    )
      throw new Error();
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new NativeUpgradeInspectionBlocker("receipt");
  }
}
const sourceImageIdsSchema = z.strictObject({
  api: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  web: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
const sourcePlatformSchema = z.enum(["linux/amd64", "linux/arm64"]);
const installedSchema = installedUpgradeIdentitySchema;
const qualificationSchema = z.strictObject({
  instanceId: z.uuid(),
  sourceManifestDigest: digest,
  sourceImageIds: sourceImageIdsSchema,
  sourcePlatform: sourcePlatformSchema,
  candidateManifestDigest: digest,
  sourceSchemaDigest: digest,
  targetSchemaDigest: digest,
  targetLedgerDigest: digest,
  expiresAt: z.iso.datetime(),
  previousCompatibleAfterCandidateWrites: z.literal(true),
  atomicLedger: z.literal(true),
  cliVersion: z.string().min(1),
  candidateImageIds: z.record(
    z.enum(["api", "web"]),
    z.string().regex(/^sha256:[a-f0-9]{64}$/),
  ),
});
export interface InspectionBackupEvidence {
  readonly certificateDigest: string;
  readonly verified: boolean;
  readonly held: boolean;
  readonly keysAvailable: boolean;
}
export interface InspectionDependencies {
  /** Production callback reads only the authenticated host journal. */
  readonly readInstalledRecords?: () => Promise<
    readonly UpgradeJournalRecord[]
  >;
  /** Test seam for the concrete read-only bounded archive admission boundary. */
  readonly admitImages?: (bundle: VerifiedUpgradeBundle) => Promise<void>;
  readonly verifyImportedImages?: (
    bundle: VerifiedUpgradeBundle,
  ) => Promise<{ requiredRemainingBytes: number }>;
  readonly runner?: NativeCommandRunner;
  /** Must authenticate certificate, verified child and encrypted parts, then acquire/revalidate durable hold. */
  readonly backup: (runId: string) => Promise<InspectionBackupEvidence>;
  readonly now?: () => Date;
  readonly read?: (path: string, limit: number) => Promise<string>;
  readonly maintenance?: () => Promise<boolean>;
  readonly resources?: (directory: string) => Promise<{
    freeBytes: number;
    memoryBytes: number;
    platform: string;
  }>;
}
export async function readInspectionFile(
  path: string,
  limit: number,
): Promise<string> {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o022) !== 0 || stat.size > limit)
      throw new NativeUpgradeInspectionBlocker();
    const bytes = await file.readFile();
    if (bytes.length !== stat.size) throw new NativeUpgradeInspectionBlocker();
    return bytes.toString("utf8");
  } finally {
    await file.close();
  }
}
/** Read-only host observation. No migrations, Docker mutations or licence synchronization RPCs. */
export class NativeUpgradeInspection {
  private readonly config: NativeUpgradeInspectionConfiguration;
  private readonly runner: NativeCommandRunner;
  constructor(
    config: NativeUpgradeInspectionConfiguration,
    private readonly dependencies: InspectionDependencies,
  ) {
    this.config = nativeUpgradeInspectionConfigSchema.parse(config);
    this.runner = dependencies.runner ?? new ShellFreeCommandRunner();
  }
  private run(executable: string, args: readonly string[], stdin?: string) {
    return this.runner.run(executable, args, {
      cwd: this.config.cwd,
      environment: this.config.environment,
      stdin,
    });
  }
  private async sql(query: string): Promise<unknown> {
    return JSON.parse(
      (
        await this.run(
          this.config.psqlExecutable,
          ["-XAt", "-v", "ON_ERROR_STOP=1"],
          `BEGIN READ ONLY; SET LOCAL statement_timeout = '10000'; ${query}; COMMIT;`,
        )
      )
        .split("\n")
        .filter((line) => line.startsWith("[") || line.startsWith("{"))
        .join("\n"),
    );
  }
  private async installedState() {
    const read = this.dependencies.read ?? readInspectionFile;
    const receipt = installedSchema.parse(
      verifyInspectionReceipt(
        await read(this.config.installedReceiptPath, 262144),
        this.config.receiptPublicKey,
        "installed",
      ),
    );
    if (receipt.instanceId !== this.config.instanceId)
      throw new NativeUpgradeInspectionBlocker("receipt");
    return projectInstalledUpgradeState(
      receipt,
      await (this.dependencies.readInstalledRecords?.() ?? Promise.resolve([])),
    );
  }
  async installedVersion(): Promise<string> {
    return (await this.installedState()).identity.version;
  }
  async maintenanceActive(): Promise<boolean> {
    if (this.dependencies.maintenance) return this.dependencies.maintenance();
    try {
      const raw = await readInspectionFile(
        this.config.maintenanceRequestPath,
        4096,
      );
      return z
        .strictObject({
          version: z.literal(1),
          generation: z.uuid(),
          closed: z.boolean(),
        })
        .parse(JSON.parse(raw)).closed;
    } catch {
      throw new NativeUpgradeInspectionBlocker("source");
    }
  }
  async inspect(
    bundle: VerifiedUpgradeBundle,
    actor: UpgradeActor,
    runId: string,
    reviewWindow?: { checkedAt: string; expiresAt: string },
    phase?: { imagesImported: true },
  ): Promise<{
    facts: UpgradePreflightFacts;
    plan: DeploymentPlan;
    qualification: z.infer<typeof qualificationSchema>;
    committedMigrations: Readonly<Record<string, string>>;
    privateObservations: {
      freeBytes: number;
      memoryBytes: number;
      dockerMemoryBytes: number;
      dockerFreeBytes: number;
    };
  }> {
    const c = this.config,
      m = bundle.manifest,
      now = this.dependencies.now?.() ?? new Date();
    const read = this.dependencies.read ?? readInspectionFile;
    const installedState = await this.installedState();
    const installed = installedState.identity;
    const qualification = qualificationSchema.parse(
      verifyInspectionReceipt(
        await read(c.qualificationReceiptPath, 262144),
        c.receiptPublicKey,
        "qualification",
      ),
    );
    if (
      installed.instanceId !== c.instanceId ||
      qualification.instanceId !== c.instanceId ||
      qualification.sourceManifestDigest !== installed.manifestDigest ||
      qualification.candidateManifestDigest !== bundle.manifestDigest ||
      qualification.sourceSchemaDigest !== installed.schemaDigest ||
      qualification.sourcePlatform !== installed.sourcePlatform ||
      qualification.sourceImageIds.api !== installed.sourceImageIds.api ||
      qualification.sourceImageIds.web !== installed.sourceImageIds.web ||
      qualification.targetSchemaDigest !== m.compatibility.targetSchemaDigest ||
      Date.parse(qualification.expiresAt) <= now.getTime()
    )
      throw new NativeUpgradeInspectionBlocker("receipt");
    const admissionConfig = {
      dockerExecutable: c.dockerExecutable,
      cwd: c.cwd,
      environment: c.environment,
    };
    let requiredBytes = m.requirements.diskBytes;
    if (phase?.imagesImported) {
      const imported = await (this.dependencies.verifyImportedImages?.(
        bundle,
      ) ?? verifyImportedUpgradeImages(bundle, this.runner, admissionConfig));
      requiredBytes = imported.requiredRemainingBytes;
      if (!Number.isSafeInteger(requiredBytes) || requiredBytes <= 0)
        throw new NativeUpgradeInspectionBlocker("inventory");
    } else {
      await (this.dependencies.admitImages?.(bundle) ??
        admitVerifiedUpgradeImages(bundle, this.runner, admissionConfig));
    }
    const resources = await (this.dependencies.resources?.(c.diskRoot) ??
      statfs(c.diskRoot).then((s) => ({
        freeBytes: s.bavail * s.bsize,
        memoryBytes: freemem(),
        platform: `${platform()}/${arch() === "x64" ? "amd64" : arch()}`,
      })));
    const info = z
      .object({
        MemTotal: z.number().int().positive(),
        OSType: z.literal("linux"),
        Architecture: z.string(),
        DockerRootDir: absolute,
      })
      .passthrough()
      .parse(
        JSON.parse(
          await this.run(c.dockerExecutable, [
            "info",
            "--format",
            "{{json .}}",
          ]),
        ),
      );
    const dockerResources = await (this.dependencies.resources?.(
      info.DockerRootDir,
    ) ??
      statfs(info.DockerRootDir).then((s) => ({
        freeBytes: s.bavail * s.bsize,
      })));
    const ids = (
      await this.run(c.dockerExecutable, ["ps", "--quiet", "--no-trunc"])
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (ids.length === 0 || ids.some((id) => !/^[a-f0-9]{64}$/.test(id)))
      throw new NativeUpgradeInspectionBlocker("inventory");
    const containers = z
      .array(
        z
          .object({
            Name: z.string(),
            Image: z.string().regex(/^sha256:[a-f0-9]{64}$/),
            State: z.object({ Running: z.boolean() }).passthrough(),
            NetworkSettings: z
              .object({ Networks: z.record(z.string(), z.unknown()) })
              .passthrough(),
          })
          .passthrough(),
      )
      .parse(
        JSON.parse(await this.run(c.dockerExecutable, ["inspect", ...ids])),
      );
    const expected = [
      ...Object.values(c.infrastructureContainers),
      ...Object.keys(c.applicationContainers),
    ];
    const relevant = containers.filter(
      (item) =>
        Object.hasOwn(item.NetworkSettings.Networks, c.sourceNetwork) ||
        expected.includes(item.Name.replace(/^\//, "")),
    );
    const complete = expected.every((name) =>
      relevant.some((item) => item.Name === `/${name}` && item.State.Running),
    );
    const runtimeDigests = Object.fromEntries(
      Object.entries(c.infrastructureContainers).map(([role, name]) => [
        role,
        relevant.find((item) => item.Name === `/${name}`)?.Image.slice(7) ??
          "missing",
      ]),
    );
    const ledgerRows = z
      .array(
        z
          .object({
            version: z.string().regex(/^\d{14}$/),
            name: z.string().nullable(),
            statements: z.array(z.string()).nullable(),
          })
          .strict(),
      )
      .parse(
        await this.sql(
          "SELECT coalesce(json_agg(json_build_object('version',version,'name',name,'statements',statements) ORDER BY version), '[]'::json) FROM supabase_migrations.schema_migrations",
        ),
      );
    const ledger = ledgerRows.map((row) => row.version);
    const dump = await this.run(c.pgDumpExecutable, [
      "--schema-only",
      "--no-owner",
      "--no-privileges",
    ]);
    const schemaDigest = normalizedSchemaDigest(dump);
    const sessions = z
      .array(z.string())
      .parse(
        await this.sql(
          "SELECT coalesce(json_agg(DISTINCT application_name), '[]'::json) FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend' AND pid <> pg_backend_pid()",
        ),
      );
    // Only aggregate counts cross this boundary. Fixed private organization IDs scope every licence read.
    const license = z
      .object({ total: z.number(), blocked: z.number() })
      .parse(
        await this.sql(
          `SELECT json_build_object('total', count(*), 'blocked', count(*) FILTER (WHERE clock_rollback_detected OR verified_claims IS NULL OR verified_claims->>'expiresAt' IS NULL OR verified_claims->>'startsAt' IS NULL OR (verified_claims->>'startsAt')::timestamptz > now() OR (verified_claims->>'expiresAt')::timestamptz + interval '30 days' <= now())) FROM public.organization_license_states WHERE organization_id IN (${c.organizationIds.map((id) => `'${id}'::uuid`).join(",")})`,
        ),
      );
    const migrations = await Promise.all(
      m.migrations.map(async (item) => {
        const sql = await read(
          join(bundle.extractedRoot, item.name),
          16 * 1024 * 1024,
        );
        if (createHash("sha256").update(sql).digest("hex") !== item.sha256)
          throw new NativeUpgradeInspectionBlocker();
        return { name: item.name, sha256: item.sha256, sql };
      }),
    );
    const backup = await this.dependencies.backup(runId);
    const concurrentMaintenance = await this.maintenanceActive();
    const window = reviewWindow ?? {
      checkedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 300000).toISOString(),
    };
    const facts: UpgradePreflightFacts = {
      instanceId: c.instanceId,
      manifestDigest: bundle.manifestDigest,
      stagedInventoryDigest: inspectionDigest({
        archive: m.archive,
        images: m.images,
        migrations: m.migrations,
        artifacts: m.artifacts,
        qualification,
      }),
      currentVersion: installed.version,
      currentManifestDigest: installed.manifestDigest,
      currentSchemaDigest: schemaDigest,
      ...m.compatibility,
      supervisorVersion: c.supervisorVersion,
      runtimeDigests,
      requiredRuntimeDigests: m.infrastructure,
      freeBytes: Math.min(
        resources.freeBytes,
        dockerResources.freeBytes,
        requiredBytes,
      ),
      requiredBytes,
      memoryBytes: Math.min(
        resources.memoryBytes,
        info.MemTotal,
        m.requirements.memoryBytes,
      ),
      requiredMemoryBytes: m.requirements.memoryBytes,
      platform:
        info.Architecture === "x86_64" || info.Architecture === "amd64"
          ? resources.platform === "linux/amd64"
            ? resources.platform
            : "mismatch"
          : info.Architecture === "aarch64" || info.Architecture === "arm64"
            ? resources.platform === "linux/arm64"
              ? resources.platform
              : "mismatch"
            : "unsupported",
      targetPlatform: `${m.platform.os}/${m.platform.architecture}`,
      ledgerDigest: inspectionDigest(ledgerRows),
      expectedLedgerDigest: installed.ledgerDigest,
      pendingMigrations: migrations
        .filter((item) => !ledger.includes(item.name.slice(0, 14)))
        .map((item) => item.name),
      signedMigrations: migrations.map((item) => item.name),
      migrationsTransactional:
        qualification.atomicLedger &&
        migrations.every(
          (item) =>
            !/\b(?:BEGIN|COMMIT|ROLLBACK|VACUUM|CONCURRENTLY|CREATE\s+DATABASE|ALTER\s+SYSTEM)\b/i.test(
              item.sql,
            ),
        ),
      previousCompatibleAfterCandidateWrites:
        qualification.previousCompatibleAfterCandidateWrites,
      backupCertificateDigest: backup.certificateDigest,
      backupVerified: backup.verified,
      backupHeld: backup.held,
      requiredKeysAvailable: backup.keysAvailable,
      licenceAllowsUpgrade:
        license.total === c.organizationIds.length &&
        license.blocked === 0 &&
        m.licenseEffects.length === 1 &&
        m.licenseEffects[0] === "unchanged",
      processInventoryComplete: complete,
      unmanagedWriters:
        relevant.some(
          (item) => !expected.includes(item.Name.replace(/^\//, "")),
        ) ||
        sessions.some((name) => !c.allowedDatabaseApplications.includes(name)),
      concurrentMaintenance,
      authorityDigest: inspectionDigest(actor),
      trustDigest: c.trustDigest,
      ...window,
    };
    if (schemaDigest !== installed.schemaDigest)
      throw new NativeUpgradeInspectionBlocker("source");
    const plan: DeploymentPlan = {
      runId,
      fingerprint: preflightUpgrade(facts, now).fingerprint,
      baselineLedger: ledger,
      expectedLedgerDigest: qualification.targetLedgerDigest,
      targetSchemaDigest: qualification.targetSchemaDigest,
      migrations,
      previousCompatibleAfterCandidateWrites:
        facts.previousCompatibleAfterCandidateWrites,
      previousImages: await Promise.all(
        [...new Set(Object.values(c.applicationContainers))].map(
          async (role) => {
            const matching = Object.entries(c.applicationContainers)
              .filter(([, value]) => value === role)
              .map(
                ([name]) =>
                  relevant.find((item) => item.Name === `/${name}`)?.Image,
              );
            const imageId = matching[0];
            if (
              !imageId ||
              imageId !== installed.sourceImageIds[role] ||
              installed.sourcePlatform !== resources.platform ||
              matching.some((image) => image !== imageId)
            )
              throw new NativeUpgradeInspectionBlocker("inventory");
            const inspected = z
              .array(
                z
                  .object({
                    Id: z.string(),
                    Os: z.string(),
                    Architecture: z.string(),
                  })
                  .passthrough(),
              )
              .length(1)
              .parse(
                JSON.parse(
                  await this.run(c.dockerExecutable, [
                    "image",
                    "inspect",
                    imageId,
                  ]),
                ),
              )[0]!;
            const digest = inspected.Id;
            if (
              inspected.Id !== imageId ||
              `${inspected.Os}/${inspected.Architecture}` !== resources.platform
            )
              throw new NativeUpgradeInspectionBlocker("inventory");
            return {
              service: role,
              imageId,
              digest,
              platform: resources.platform,
            };
          },
        ),
      ),
      candidateImages: [...new Set(Object.values(c.applicationContainers))].map(
        (role) => {
          const image = m.images.find((item) => item.service === role);
          if (!image || image.digest !== qualification.candidateImageIds[role])
            throw new NativeUpgradeInspectionBlocker("inventory");
          return {
            service: role,
            imageId: qualification.candidateImageIds[role],
            digest: image.digest,
            platform: facts.targetPlatform,
          };
        },
      ),
    };
    return {
      facts,
      plan,
      qualification,
      committedMigrations: installedState.committedMigrations,
      privateObservations: {
        freeBytes: resources.freeBytes,
        memoryBytes: resources.memoryBytes,
        dockerMemoryBytes: info.MemTotal,
        dockerFreeBytes: dockerResources.freeBytes,
      },
    };
  }
}

// The reference runner consumes these exact native receipt boundaries.
export {
  installedSchema as installedUpgradeReceiptSchema,
  qualificationSchema as upgradeQualificationReceiptSchema,
};
