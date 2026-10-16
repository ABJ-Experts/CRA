import { importApprovedUpgradeImages } from "./upgrade-image-admission";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import * as schemas from "@repo/contracts/upgrades/schemas";
import type {
  UpgradeRun,
  UpgradePreflight,
} from "@repo/contracts/upgrades/types";
import type { OperatorIdentity } from "../../operator/domain/operator-grants";
import type {
  UpgradeSupervisorJournal as UpgradeHostJournal,
  UpgradeJournalRecord as JournalRecord,
} from "./upgrade-supervisor.port";
import type { StagedUpgradeBundle as VerifiedUpgradeBundle } from "./upgrade-supervisor.port";
import { UpgradeControlError as UpgradeControlTransportError } from "./upgrade-supervisor.port";
import {
  preflightUpgrade,
  type UpgradePreflightFacts,
} from "../domain/upgrade-preflight";
import type {
  UpgradeActor,
  UpgradeControlAction,
  UpgradeControlPort,
} from "./upgrade-control.port";
import type {
  ExecutionSnapshot,
  DeploymentPlan,
  DeploymentLifecyclePort,
} from "./deployment-lifecycle.port";
import { UpgradeExecutionEngine } from "./upgrade-execution";

export { UpgradeExecutionJournal } from "./upgrade-execution-journal";
import { UpgradeExecutionJournal } from "./upgrade-execution-journal";

export interface PreparedUpgrade {
  facts: UpgradePreflightFacts;
  plan: DeploymentPlan;
  lifecycle: DeploymentLifecyclePort;
  privateObservations?: Readonly<Record<string, number>>;
}
export interface UpgradeSupervisorDependencies {
  instanceId: string;
  readGrants(): Promise<{
    revision: string;
    grants: readonly Omit<OperatorIdentity, "revision">[];
  }>;
  journal: UpgradeHostJournal;
  media: {
    list(): Promise<z.output<typeof schemas.upgradeMediaListSchema>>;
    verify(id: string): Promise<VerifiedUpgradeBundle>;
  };
  flushAudit?(): Promise<void>;
  loadImages?(bundle: VerifiedUpgradeBundle): Promise<void>;
  capabilities(): Promise<z.output<typeof schemas.upgradeCapabilitiesSchema>>;
  prepare(
    bundle: VerifiedUpgradeBundle,
    actor: UpgradeActor,
    runId: string,
    window?: { checkedAt: string; expiresAt: string; fingerprint?: string },
  ): Promise<PreparedUpgrade>;
  resume?(
    bundle: VerifiedUpgradeBundle,
    actor: UpgradeActor,
    plan: DeploymentPlan,
    facts: UpgradePreflightFacts,
  ): Promise<DeploymentLifecyclePort>;
  now?: () => Date;
}
interface SavedRun {
  run: UpgradeRun;
  actor: UpgradeActor;
  bundle?: VerifiedUpgradeBundle;
  facts?: UpgradePreflightFacts;
  plan?: DeploymentPlan;
  privateObservations?: Readonly<Record<string, number>>;
}
const scopes = {
  "capabilities/read": "upgrades.view",
  "media/list": "upgrades.view",
  "media/stage": "upgrades.stage",
  "run/preflight": "upgrades.stage",
  "run/list": "upgrades.view",
  "run/read": "upgrades.view",
  "run/result": "upgrades.view",
  "run/apply": "upgrades.apply",
  "run/reconcile": "upgrades.apply",
  "run/rollback": "upgrades.rollback",
} as const;
const conflict = (): never => {
  throw new UpgradeControlTransportError(409);
};
const phaseState = {
  ready: "awaiting-initiation",
  draining: "draining",
  checkpoint: "backup-verification",
  migrating: "migrating",
  candidate: "checking",
  exposing: "activating",
  succeeded: "success",
  "rolled-back": "rolled-back",
  blocked: "rollback-required",
} as const;

/** All private artifacts remain in the authenticated host journal, never wire responses. */
export class UpgradeSupervisor implements UpgradeControlPort {
  private readonly stagingJobs = new Set<string>();
  constructor(private readonly deps: UpgradeSupervisorDependencies) {}
  private now() {
    return this.deps.now?.() ?? new Date();
  }
  async authorize(actor: UpgradeActor, action: UpgradeControlAction) {
    schemas.upgradeActorSchema.parse(actor);
    const grants = await this.deps.readGrants();
    const grant = grants.grants.find(
      (g) =>
        g.principalId === actor.principalId &&
        g.fingerprint256 === actor.fingerprint256,
    );
    if (
      grants.revision !== actor.grantRevision ||
      !grant?.instanceIds.includes(this.deps.instanceId) ||
      !grant.upgradeScopes?.some(
        (s) =>
          s.instanceId === this.deps.instanceId &&
          s.actions.includes(scopes[action]),
      )
    )
      throw new UpgradeControlTransportError(403);
  }
  private saved(records: readonly JournalRecord[], runId: string): SavedRun {
    const record = records.findLast(
      (r) => r.runId === runId && r.kind === "run",
    );
    if (!record) return conflict();
    return record.data as unknown as SavedRun;
  }
  private async persist(saved: SavedRun) {
    const version = (await this.deps.journal.read()).length;
    const run = schemas.upgradeRunSchema.parse({
      ...saved.run,
      version: version + 1,
      updatedAt: this.now().toISOString(),
    });
    await this.deps.journal.append({
      expectedVersion: version,
      idempotencyKey: randomUUID(),
      runId: run.id,
      kind: "run",
      data: {
        ...saved,
        run,
        ...(saved.plan
          ? {
              plan: {
                ...saved.plan,
                migrations: saved.plan.migrations.map((m) => ({
                  ...m,
                  sql: "",
                })),
              },
            }
          : {}),
        audit: {
          actorId: saved.actor.principalId,
          action: "upgrade.state",
          outcome: run.failureCode ? "failed" : "completed",
          metadata: { runId: run.id, state: run.state, verified: run.verified },
        },
      },
    });
    await this.deps.flushAudit?.();
    return { ...run, version: (await this.deps.journal.read()).length };
  }
  private project(
    saved: SavedRun,
    records: readonly JournalRecord[],
  ): UpgradeRun {
    const execution = records.findLast(
      (r) => r.runId === saved.run.id && r.kind === "execution",
    );
    const latestRun = records.findLast(
      (r) => r.runId === saved.run.id && r.kind === "run",
    );
    if (
      !execution ||
      (saved.run.result && latestRun && latestRun.sequence > execution.sequence)
    )
      return schemas.upgradeRunSchema.parse({
        ...saved.run,
        version: records.length,
      });
    const state = execution.data as unknown as ExecutionSnapshot;
    return schemas.upgradeRunSchema.parse({
      ...saved.run,
      version: records.length,
      state: phaseState[state.phase],
    });
  }
  async execute(
    instanceId: string,
    actor: UpgradeActor,
    action: UpgradeControlAction,
    input: Readonly<Record<string, unknown>> = {},
  ): Promise<unknown> {
    schemas.upgradeControlActionSchema.parse(action);
    if (instanceId !== this.deps.instanceId)
      throw new UpgradeControlTransportError(403);
    await this.authorize(actor, action);
    const records = await this.deps.journal.read();
    if (action === "capabilities/read") {
      schemas.upgradeEmptyQuerySchema.parse(input);
      return schemas.upgradeCapabilitiesSchema.parse({
        ...(await this.deps.capabilities()),
        version: records.length,
      });
    }
    if (action === "media/list") {
      schemas.upgradeEmptyQuerySchema.parse(input);
      return schemas.upgradeMediaListSchema.parse(await this.deps.media.list());
    }
    if (action === "run/list") {
      const query = schemas.upgradeHistoryQuerySchema.parse(input);
      const ids = [
        ...new Set(records.filter((r) => r.kind === "run").map((r) => r.runId)),
      ].reverse();
      const start = query.cursor ? ids.indexOf(query.cursor) + 1 : 0;
      if (query.cursor && start === 0) return conflict();
      const selected = ids.slice(start, start + query.limit);
      return schemas.upgradeHistorySchema.parse({
        items: selected.map((id) =>
          this.project(this.saved(records, id), records),
        ),
        nextCursor: ids.length > start + query.limit ? selected.at(-1) : null,
      });
    }
    if (action === "run/read" || action === "run/result") {
      const { runId } = z.strictObject({ runId: z.uuid() }).parse(input);
      const run = this.project(this.saved(records, runId), records);
      return action === "run/read"
        ? run
        : schemas.upgradeResultSchema.parse(run.result ?? conflict());
    }
    return this.deps.journal.withExclusive(async () =>
      this.mutate(actor, action, input),
    );
  }
  private async mutate(
    actor: UpgradeActor,
    action: UpgradeControlAction,
    input: Readonly<Record<string, unknown>>,
  ) {
    await this.authorize(actor, action);
    const schema =
      action === "media/stage"
        ? schemas.upgradeStageInputSchema
        : (action === "run/apply"
            ? schemas.upgradeApplyInputSchema
            : schemas.upgradeMutationSchema
          ).extend({ runId: z.uuid() });
    const command = schema.parse(input);
    const records = await this.deps.journal.read();
    if (action === "run/rollback" && "runId" in command) {
      const run = this.project(this.saved(records, command.runId), records);
      // Exposure is monotonic, including a crash before the public result is saved.
      if (
        run.state === "success" ||
        run.result?.exposurePossible ||
        records.some(
          (record) =>
            record.runId === command.runId &&
            record.kind === "execution" &&
            (record.data.exposurePossible === true ||
              record.data.phase === "succeeded"),
        )
      )
        return conflict();
    }
    const duplicate = records.find(
      (r) => r.idempotencyKey === command.idempotencyKey,
    );
    if (duplicate) {
      if (
        JSON.stringify(duplicate.data) !==
        JSON.stringify({ actor, action, input: command })
      )
        return conflict();
      const receipt = records.find(
        (r) =>
          r.kind === "command-result" &&
          r.data.commandId === command.idempotencyKey,
      );
      if (
        receipt &&
        !(
          action === "run/apply" &&
          !records.some(
            (r) => r.runId === duplicate.runId && r.kind === "execution",
          )
        )
      ) {
        const previous = this.saved(records, duplicate.runId);
        if (action === "media/stage" && previous.run.state === "verifying")
          this.startStaging(previous);
        return action === "run/preflight"
          ? schemas.upgradePreflightSchema.parse(receipt.data.value)
          : this.project(previous, records);
      }
    }
    if (!duplicate && command.expectedVersion !== records.length)
      return conflict();
    const runId =
      duplicate?.runId ?? ("runId" in command ? command.runId : randomUUID());
    const saved =
      action === "media/stage" ? undefined : this.saved(records, runId);
    if (
      action === "run/apply" &&
      (!saved?.run.preflight?.eligible ||
        saved.run.state !== "awaiting-initiation" ||
        saved.run.preflight.fingerprint !== input.fingerprint)
    )
      return conflict();
    if (
      action === "run/preflight" &&
      !["preflight", "awaiting-initiation"].includes(saved!.run.state)
    )
      return conflict();
    if (!duplicate)
      await this.deps.journal.append({
        expectedVersion: records.length,
        idempotencyKey: command.idempotencyKey,
        runId,
        kind: "command",
        data: { actor, action, input: command },
      });
    if (action === "media/stage") {
      const now = this.now().toISOString();
      const run = schemas.upgradeRunSchema.parse({
        id: runId,
        instanceId: this.deps.instanceId,
        mediaId: input.mediaId,
        version: 0,
        state: "verifying",
        releaseId: null,
        fromVersion: null,
        toVersion: null,
        manifestDigest: null,
        verified: false,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        failureCode: null,
        preflight: null,
        result: null,
      });
      const initial = { run, actor };
      const output = await this.persist(initial);
      const response = await this.completeCommand(
        runId,
        command.idempotencyKey,
        output,
      );
      this.startStaging(initial);
      return response;
    }
    if (action === "run/preflight") {
      const review = await this.review(saved!, actor);
      return this.completeCommand(runId, command.idempotencyKey, review);
    }
    if (action === "run/apply") {
      const admitted = records.filter((r) => r.kind === "admitted-sequence");
      const floor = Math.max(
        0,
        ...admitted.map((r) => Number(r.data.sequence)),
      );
      const bundle = saved!.bundle!;
      if (
        bundle.manifest.sequence < floor ||
        (bundle.manifest.sequence === floor &&
          !admitted.some(
            (r) =>
              r.data.sequence === floor &&
              r.data.manifestDigest === bundle.manifestDigest,
          ))
      )
        return conflict();
    }
    const prepared =
      action === "run/apply"
        ? await this.deps.prepare(
            saved!.bundle!,
            actor,
            runId,
            saved!.run.preflight ?? undefined,
          )
        : saved?.plan && saved.facts && this.deps.resume
          ? {
              plan: saved.plan,
              facts: saved.facts,
              lifecycle: await this.deps.resume(
                saved.bundle!,
                actor,
                saved.plan,
                saved.facts,
              ),
            }
          : conflict();
    if (
      action === "run/apply" &&
      (!preflightUpgrade(prepared.facts, this.now()).allowed ||
        preflightUpgrade(prepared.facts, this.now()).fingerprint !==
          input.fingerprint)
    )
      return conflict();
    if (action === "run/apply") {
      const head = (await this.deps.journal.read()).length;
      await this.deps.journal.append({
        runId,
        expectedVersion: head,
        idempotencyKey: randomUUID(),
        kind: "admitted-sequence",
        data: {
          sequence: saved!.bundle!.manifest.sequence,
          manifestDigest: saved!.bundle!.manifestDigest,
        },
      });
    }
    const updated = {
      ...saved!,
      actor,
      plan: prepared.plan,
      facts: prepared.facts,
      ...("privateObservations" in prepared
        ? { privateObservations: prepared.privateObservations }
        : {}),
    };
    const run = await this.persist(updated);
    const response = await this.completeCommand(
      runId,
      command.idempotencyKey,
      run,
    );
    const engine = new UpgradeExecutionEngine(
      this.authorizedLifecycle(prepared.lifecycle, actor, action),
      new UpgradeExecutionJournal(
        this.deps.journal,
        actor,
        this.deps.flushAudit ? () => this.deps.flushAudit!() : undefined,
      ),
    );
    setImmediate(() => {
      void this.run(
        engine,
        prepared.plan,
        updated,
        action,
        prepared.lifecycle,
      ).catch(() => undefined);
    });
    return response;
  }
  private async completeCommand<T extends { version: number }>(
    runId: string,
    commandId: string,
    value: T,
  ): Promise<T> {
    const head = (await this.deps.journal.read()).length;
    const response = { ...value, version: head + 1 };
    await this.deps.journal.append({
      runId,
      expectedVersion: head,
      idempotencyKey: randomUUID(),
      kind: "command-result",
      data: { commandId, value: response },
    });
    return response;
  }
  private authorizedLifecycle(
    lifecycle: DeploymentLifecyclePort,
    actor: UpgradeActor,
    action: UpgradeControlAction,
  ): DeploymentLifecyclePort {
    const authorize = () => this.authorize(actor, action);
    const guard =
      <A extends readonly unknown[]>(method: (...args: A) => Promise<void>) =>
      async (...args: A) => {
        await authorize();
        await method(...args);
      };
    return {
      observe: () => lifecycle.observe(),
      assertFresh: guard((fingerprint: string) =>
        lifecycle.assertFresh(fingerprint),
      ),
      // The engine durably journals this fail-closed safety effect under admitted run authority.
      // Revoking forward authority must never prevent emergency ingress closure.
      closeIngress: () => lifecycle.closeIngress(),
      stopClaims: guard(() => lifecycle.stopClaims()),
      drain: guard(() => lifecycle.drain()),
      holdVerifiedBackup: guard(() => lifecycle.holdVerifiedBackup()),
      migrate: guard((plan: DeploymentPlan) => lifecycle.migrate(plan)),
      startCandidate: guard((images: DeploymentPlan["candidateImages"]) =>
        lifecycle.startCandidate(images),
      ),
      verifyCandidate: guard(() => lifecycle.verifyCandidate()),
      startWorkers: guard(() => lifecycle.startWorkers()),
      openIngress: guard(() => lifecycle.openIngress()),
      verifyActivated: guard(() => lifecycle.verifyActivated()),
      restorePreviousImages: guard((images: DeploymentPlan["previousImages"]) =>
        lifecycle.restorePreviousImages(images),
      ),
    };
  }
  private startStaging(saved: SavedRun) {
    if (this.stagingJobs.has(saved.run.id)) return;
    this.stagingJobs.add(saved.run.id);
    setImmediate(() => {
      void this.stage(saved)
        .finally(() => this.stagingJobs.delete(saved.run.id))
        .catch(() => undefined);
    });
  }
  private async stage(saved: SavedRun) {
    try {
      const bundle = await this.deps.media.verify(saved.run.mediaId);
      await this.authorize(saved.actor, "media/stage");
      await this.deps.journal.withExclusive(async () => {
        const records = await this.deps.journal.read();
        const floor = Math.max(
          0,
          ...records
            .filter((r) => r.kind === "admitted-sequence")
            .map((r) => Number(r.data.sequence)),
        );
        if (
          bundle.manifest.sequence < floor ||
          (bundle.manifest.sequence === floor &&
            !records.some(
              (r) =>
                r.kind === "admitted-sequence" &&
                r.data.sequence === floor &&
                r.data.manifestDigest === bundle.manifestDigest,
            ))
        )
          throw new Error("sequence_rejected");
        const verified = {
          ...saved,
          bundle,
          run: {
            ...saved.run,
            verified: true,
            releaseId: bundle.manifest.releaseId,
            toVersion: bundle.manifest.version,
            manifestDigest: bundle.manifestDigest,
          },
        };
        await this.persist(verified);
        await this.persist({
          ...verified,
          run: { ...verified.run, state: "preflight" },
        });
      });
    } catch {
      await this.deps.journal.withExclusive(() =>
        this.persist({
          ...saved,
          run: {
            ...saved.run,
            state: "failed",
            failureCode: "invalid-media",
            completedAt: this.now().toISOString(),
            result: {
              runId: saved.run.id,
              instanceId: saved.run.instanceId,
              outcome: "failed",
              fromVersion: saved.run.fromVersion,
              toVersion: saved.run.toVersion,
              manifestDigest: saved.run.manifestDigest,
              startedAt: saved.run.createdAt,
              checkedAt: null,
              checks: [],
              safeRemediation: ["invalid-media"],
              imageDigests: [],
              completedAt: this.now().toISOString(),
              failureCode: "invalid-media",
              maintenanceRetained: false,
              exposurePossible: false,
              dataRestored: false,
              migrationsReversed: false,
              evidenceId: randomUUID(),
            },
          },
        }),
      );
    }
  }
  private async review(saved: SavedRun, actor: UpgradeActor) {
    const prepared = await this.deps.prepare(
      saved.bundle!,
      actor,
      saved.run.id,
    );
    const result = preflightUpgrade(prepared.facts, this.now());
    const m = saved.bundle!.manifest;
    const review: UpgradePreflight = schemas.upgradePreflightSchema.parse({
      runId: saved.run.id,
      version: (await this.deps.journal.read()).length + 1,
      fingerprint: result.fingerprint,
      checkedAt: prepared.facts.checkedAt,
      expiresAt: prepared.facts.expiresAt,
      eligible: result.allowed,
      summary: {
        fromVersion: prepared.facts.currentVersion,
        toVersion: m.version,
        manifestDigest: saved.bundle!.manifestDigest,
        expectedOutageSeconds: m.expectedOutageSeconds,
        licenseEffects: m.licenseEffects,
        rollback: "compatible-images-before-exposure",
        dataRestored: false,
        migrationsReversed: false,
      },
      checks: Object.entries({
        signature: ["authority"],
        inventory: ["authority", "migration-inventory"],
        platform: ["platform"],
        compatibility: ["source-compatibility"],
        infrastructure: ["fixed-runtime"],
        supervisor: ["supervisor"],
        schema: ["source-compatibility", "migration-atomicity"],
        "migration-ledger": ["migration-ledger", "migration-inventory"],
        backup: ["backup"],
        key: ["keys"],
        disk: ["resources"],
        memory: ["resources"],
        maintenance: ["maintenance", "freshness"],
        writers: ["process-inventory"],
        license: ["licence"],
        rollback: ["previous-image-compatibility"],
      }).map(([code, blockers]) => ({
        code,
        status: blockers.some((blocker) => result.blockers.includes(blocker))
          ? "failed"
          : "passed",
        detail: blockers.some((blocker) => result.blockers.includes(blocker))
          ? "blocked"
          : "verified",
      })),
    });
    await this.persist({
      ...saved,
      actor,
      facts: prepared.facts,
      plan: prepared.plan,
      privateObservations: prepared.privateObservations,
      run: {
        ...saved.run,
        fromVersion: prepared.facts.currentVersion,
        state: result.allowed ? "awaiting-initiation" : "preflight",
        preflight: review,
      },
    });
    return { ...review, version: (await this.deps.journal.read()).length };
  }
  private async observedMaintenance(
    lifecycle: DeploymentLifecyclePort,
  ): Promise<boolean> {
    try {
      return (await lifecycle.observe()).maintenance === true;
    } catch {
      return false;
    } // Unknown closure is never reported as retained maintenance.
  }
  private async run(
    engine: UpgradeExecutionEngine,
    plan: DeploymentPlan,
    saved: SavedRun,
    action: UpgradeControlAction,
    lifecycle: DeploymentLifecyclePort,
  ) {
    try {
      if (action === "run/apply")
        await importApprovedUpgradeImages(
          this.deps,
          saved.actor,
          saved.bundle!,
          plan,
          lifecycle,
          () => this.authorize(saved.actor, "run/apply"),
        );
      const state =
        action === "run/reconcile"
          ? await engine.reconcile(plan)
          : action === "run/rollback"
            ? await engine.rollback(plan)
            : await engine.execute(plan);
      if (!["succeeded", "blocked", "rolled-back"].includes(state.phase))
        return;
      await this.deps.journal.withExclusive(async () => {
        const now = this.now().toISOString();
        const outcome =
          state.phase === "succeeded"
            ? "success"
            : state.phase === "rolled-back"
              ? "rolled-back"
              : "rollback-required";
        await this.persist({
          ...saved,
          run: {
            ...saved.run,
            state: outcome,
            completedAt: now,
            result: {
              instanceId: saved.run.instanceId,
              fromVersion: saved.run.fromVersion,
              toVersion: saved.run.toVersion,
              manifestDigest: saved.run.manifestDigest,
              startedAt: saved.run.createdAt,
              checkedAt: saved.run.preflight?.checkedAt ?? null,
              checks: saved.run.preflight?.checks ?? [],
              imageDigests: [
                ...new Set(plan.candidateImages.map((image) => image.digest)),
              ],
              safeRemediation:
                outcome === "rollback-required"
                  ? ["reconciliation-required"]
                  : [],
              runId: plan.runId,
              outcome,
              completedAt: now,
              failureCode:
                outcome === "rollback-required"
                  ? "reconciliation-required"
                  : null,
              maintenanceRetained: await this.observedMaintenance(lifecycle),
              exposurePossible: state.exposurePossible,
              dataRestored: false,
              migrationsReversed: false,
              evidenceId: randomUUID(),
            },
          },
        });
      });
    } catch {
      await this.deps.journal.withExclusive(async () => {
        const state = await new UpgradeExecutionJournal(this.deps.journal).read(
          plan.runId,
        );
        const now = this.now().toISOString();
        await this.persist({
          ...saved,
          run: {
            ...saved.run,
            state: "rollback-required",
            completedAt: now,
            failureCode: "reconciliation-required",
            result: {
              instanceId: saved.run.instanceId,
              fromVersion: saved.run.fromVersion,
              toVersion: saved.run.toVersion,
              manifestDigest: saved.run.manifestDigest,
              startedAt: saved.run.createdAt,
              checkedAt: saved.run.preflight?.checkedAt ?? null,
              checks: saved.run.preflight?.checks ?? [],
              imageDigests: [
                ...new Set(plan.candidateImages.map((image) => image.digest)),
              ],
              safeRemediation: ["reconciliation-required"],
              runId: plan.runId,
              outcome: "rollback-required",
              completedAt: now,
              failureCode: "reconciliation-required",
              maintenanceRetained: await this.observedMaintenance(lifecycle),
              exposurePossible: state?.exposurePossible ?? false,
              dataRestored: false,
              migrationsReversed: false,
              evidenceId: randomUUID(),
            },
          },
        });
      });
    }
  }
}
