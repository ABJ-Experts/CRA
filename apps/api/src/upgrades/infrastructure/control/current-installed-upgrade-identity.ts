import { z } from "zod";
import type { UpgradeJournalRecord } from "../../application/upgrade-supervisor.port";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const imageId = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const platform = z.enum(["linux/amd64", "linux/arm64"]);
export const installedUpgradeIdentitySchema = z.strictObject({
  instanceId: z.uuid(),
  version: z.string().min(1),
  manifestDigest: digest,
  schemaDigest: digest,
  ledgerDigest: digest,
  schemaAlgorithm: z.literal("pg-dump-schema-v1"),
  sourceImageIds: z.strictObject({ api: imageId, web: imageId }),
  sourcePlatform: platform,
});
export type InstalledUpgradeIdentity = z.infer<
  typeof installedUpgradeIdentitySchema
>;
const image = z.strictObject({
  service: z.enum(["api", "web"]),
  imageId,
  digest: imageId,
  platform,
});
const imageSet = z
  .array(image)
  .length(2)
  .refine(
    (items) =>
      new Set(items.map((i) => i.service)).size === 2 &&
      items.every((i) => i.imageId === i.digest),
  );
const migration = z
  .object({
    name: z.string().regex(/^\d{14}_[a-z0-9_]+\.sql$/),
    sha256: digest,
  })
  .passthrough();
const executionSchema = z
  .object({
    phase: z.string(),
    fingerprint: digest,
    pendingEffect: z.string().nullable(),
    completed: z.array(z.string()),
    exposurePossible: z.boolean(),
    reason: z.string().nullable(),
  })
  .passthrough();
const savedSchema = z
  .object({
    run: z
      .object({
        id: z.string(),
        instanceId: z.uuid(),
        state: z.enum(["success", "rolled-back"]),
        fromVersion: z.string(),
        toVersion: z.string(),
        manifestDigest: digest,
        completedAt: z.iso.datetime(),
        preflight: z.object({ fingerprint: digest }).passthrough(),
        result: z
          .object({
            outcome: z.enum(["success", "rolled-back"]),
            failureCode: z.null(),
            dataRestored: z.literal(false),
            migrationsReversed: z.literal(false),
            exposurePossible: z.boolean(),
            maintenanceRetained: z.boolean(),
          })
          .passthrough(),
      })
      .passthrough(),
    facts: z
      .object({
        instanceId: z.uuid(),
        currentVersion: z.string(),
        currentManifestDigest: digest,
        currentSchemaDigest: digest,
        ledgerDigest: digest,
        expectedLedgerDigest: digest,
        manifestDigest: digest,
        targetSchemaDigest: digest,
        platform,
        targetPlatform: platform,
      })
      .passthrough(),
    plan: z
      .object({
        runId: z.string(),
        fingerprint: digest,
        previousImages: imageSet,
        candidateImages: imageSet,
        targetSchemaDigest: digest,
        expectedLedgerDigest: digest,
        previousCompatibleAfterCandidateWrites: z.literal(true),
        migrations: z.array(migration),
      })
      .passthrough(),
    bundle: z
      .object({
        manifestDigest: digest,
        manifest: z
          .object({
            version: z.string(),
            platform: z.object({
              os: z.literal("linux"),
              architecture: z.enum(["amd64", "arm64"]),
            }),
            images: z
              .array(
                z
                  .object({ service: z.enum(["api", "web"]), digest: imageId })
                  .passthrough(),
              )
              .length(2),
            migrations: z.array(migration),
            compatibility: z
              .object({
                sourceVersions: z.array(z.string()),
                sourceManifestDigests: z.array(digest),
                sourceSchemaDigests: z.array(digest),
                targetSchemaDigest: digest,
              })
              .passthrough(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();
type Saved = z.infer<typeof savedSchema>;
type Execution = z.infer<typeof executionSchema>;
const fail = (): never => {
  throw new Error("upgrade_installed_identity_unconfirmed");
};
const executionProof = (execution: Execution): string =>
  JSON.stringify({
    phase: execution.phase,
    fingerprint: execution.fingerprint,
    pendingEffect: execution.pendingEffect,
    completed: execution.completed,
    exposurePossible: execution.exposurePossible,
    reason: execution.reason,
  });
const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
function imageIds(
  images: z.infer<typeof imageSet>,
): InstalledUpgradeIdentity["sourceImageIds"] {
  const api = images.find((i) => i.service === "api"),
    web = images.find((i) => i.service === "web");
  if (!api || !web) return fail();
  return { api: api.imageId, web: web.imageId };
}
function corroborate(
  saved: Saved,
  execution: Execution | undefined,
  runId: string,
  instanceId: string,
): void {
  const { run, plan, bundle, facts } = saved;
  const success = run.state === "success";
  const required = success
    ? [
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
      ]
    : ["restore-previous"];
  if (
    !execution ||
    execution.phase !== (success ? "succeeded" : "rolled-back") ||
    execution.pendingEffect !== null ||
    execution.reason !== null ||
    execution.fingerprint !== plan.fingerprint ||
    execution.exposurePossible !== success ||
    !required.every((effect) => execution.completed.includes(effect)) ||
    new Set(execution.completed).size !== execution.completed.length
  )
    fail();
  if (
    run.id !== runId ||
    plan.runId !== runId ||
    run.instanceId !== instanceId ||
    facts.instanceId !== instanceId ||
    run.preflight.fingerprint !== plan.fingerprint ||
    run.result.outcome !== run.state ||
    run.result.exposurePossible !== success ||
    run.result.maintenanceRetained === success
  )
    fail();
  if (
    run.toVersion !== bundle.manifest.version ||
    run.manifestDigest !== bundle.manifestDigest ||
    facts.manifestDigest !== bundle.manifestDigest ||
    plan.targetSchemaDigest !==
      bundle.manifest.compatibility.targetSchemaDigest ||
    facts.targetSchemaDigest !== plan.targetSchemaDigest
  )
    fail();
  if (
    new Set(bundle.manifest.images.map((i) => i.service)).size !== 2 ||
    !plan.candidateImages.every((i) =>
      bundle.manifest.images.some(
        (m) => m.service === i.service && m.digest === i.imageId,
      ),
    )
  )
    fail();
  const candidatePlatform = `${bundle.manifest.platform.os}/${bundle.manifest.platform.architecture}`;
  if (
    facts.targetPlatform !== candidatePlatform ||
    plan.candidateImages.some((i) => i.platform !== candidatePlatform) ||
    plan.previousImages.some((i) => i.platform !== facts.platform)
  )
    fail();
  if (
    !same(
      plan.migrations.map((m) => ({ name: m.name, sha256: m.sha256 })),
      bundle.manifest.migrations.map((m) => ({
        name: m.name,
        sha256: m.sha256,
      })),
    ) ||
    new Set(plan.migrations.map((m) => m.name)).size !== plan.migrations.length
  )
    fail();
}
function advance(
  current: InstalledUpgradeIdentity,
  saved: Saved,
): InstalledUpgradeIdentity {
  const { facts, plan, run, bundle } = saved,
    c = bundle.manifest.compatibility;
  if (
    run.fromVersion !== current.version ||
    facts.currentVersion !== current.version ||
    facts.currentManifestDigest !== current.manifestDigest ||
    facts.currentSchemaDigest !== current.schemaDigest ||
    facts.ledgerDigest !== current.ledgerDigest ||
    facts.expectedLedgerDigest !== current.ledgerDigest ||
    facts.platform !== current.sourcePlatform ||
    !same(imageIds(plan.previousImages), current.sourceImageIds)
  )
    fail();
  if (
    c.sourceVersions.length !== c.sourceManifestDigests.length ||
    c.sourceVersions.length !== c.sourceSchemaDigests.length ||
    !c.sourceVersions.some(
      (version, index) =>
        version === current.version &&
        c.sourceManifestDigests[index] === current.manifestDigest &&
        c.sourceSchemaDigests[index] === current.schemaDigest,
    )
  )
    fail();
  return installedUpgradeIdentitySchema.parse({
    ...current,
    ...(run.state === "success"
      ? {
          version: bundle.manifest.version,
          manifestDigest: bundle.manifestDigest,
          sourceImageIds: imageIds(plan.candidateImages),
          sourcePlatform: facts.targetPlatform,
        }
      : {}),
    schemaDigest: plan.targetSchemaDigest,
    ledgerDigest: plan.expectedLedgerDigest,
  });
}
/** Accept only records returned by the HMAC-verified host journal. Never API/UI data. */
export function projectInstalledUpgradeState(
  anchor: InstalledUpgradeIdentity,
  records: readonly UpgradeJournalRecord[],
): {
  identity: InstalledUpgradeIdentity;
  committedMigrations: Readonly<Record<string, string>>;
} {
  let identity = installedUpgradeIdentitySchema.parse(anchor);
  let executions: Readonly<Record<string, Execution>> = {};
  let applied: Readonly<
    Record<string, { signature: string; phase: string; executionProof: string }>
  > = {};
  let states: Readonly<Record<string, string>> = {};
  let committedMigrations: Readonly<Record<string, string>> = {};
  let previousSequence = 0;
  for (const record of records) {
    if (
      record.instanceId !== anchor.instanceId ||
      !Number.isSafeInteger(record.sequence) ||
      record.sequence <= previousSequence
    )
      fail();
    previousSequence = record.sequence;
    if (record.kind === "execution")
      executions = {
        ...executions,
        [record.runId]: executionSchema.parse(record.data),
      };
    if (record.kind !== "run") continue;
    const state = z
      .object({ run: z.object({ state: z.string() }).passthrough() })
      .passthrough()
      .parse(record.data).run.state;
    states = { ...states, [record.runId]: state };
    if (state !== "success" && state !== "rolled-back") continue;
    const saved = savedSchema.parse(record.data);
    corroborate(
      saved,
      executions[record.runId],
      record.runId,
      anchor.instanceId,
    );
    const signature = JSON.stringify({
      plan: saved.plan,
      facts: saved.facts,
      bundle: saved.bundle.manifest,
      state,
    });
    const prior = applied[record.runId];
    if (prior) {
      if (prior.signature !== signature) fail();
      continue;
    }
    identity = advance(identity, saved);
    for (const migration of saved.plan.migrations) {
      if (
        committedMigrations[migration.name] &&
        committedMigrations[migration.name] !== migration.sha256
      )
        fail();
      committedMigrations = {
        ...committedMigrations,
        [migration.name]: migration.sha256,
      };
    }
    applied = {
      ...applied,
      [record.runId]: {
        signature,
        phase: state === "success" ? "succeeded" : "rolled-back",
        executionProof: executionProof(executions[record.runId]!),
      },
    };
  }
  for (const [runId, execution] of Object.entries(executions))
    if (
      !applied[runId] ||
      execution.phase !== applied[runId].phase ||
      execution.pendingEffect !== null ||
      executionProof(execution) !== applied[runId].executionProof ||
      states[runId] !==
        (execution.phase === "succeeded" ? "success" : "rolled-back")
    )
      fail();
  if (
    Object.values(states).some(
      (state) => state === "rollback-required" || state === "rolling-back",
    )
  )
    fail();
  return { identity, committedMigrations };
}
export function projectInstalledUpgradeIdentity(
  anchor: InstalledUpgradeIdentity,
  records: readonly UpgradeJournalRecord[],
): InstalledUpgradeIdentity {
  return projectInstalledUpgradeState(anchor, records).identity;
}

/** Historical SQL files remain hash-pinned after each committed upgrade. */
export function mergeInstalledMigrationFiles(
  initial: Readonly<Record<string, string>>,
  committed: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  for (const [name, hash] of Object.entries(committed))
    if (initial[name] && initial[name] !== hash) fail();
  return { ...initial, ...committed };
}
