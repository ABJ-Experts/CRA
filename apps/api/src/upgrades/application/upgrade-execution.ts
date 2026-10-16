import type {
  DeploymentEffect,
  DeploymentLifecyclePort,
  DeploymentObservation,
  DeploymentPlan,
  ExecutionJournalPort,
  ExecutionPhase,
  ExecutionSnapshot,
} from "./deployment-lifecycle.port";

class EffectFailure extends Error {}
const steps: readonly (readonly [DeploymentEffect, ExecutionPhase])[] = [
  ["close-ingress", "draining"],
  ["stop-claims", "draining"],
  ["drain", "draining"],
  ["hold-backup", "checkpoint"],
  ["migrate", "migrating"],
  ["start-candidate", "candidate"],
  ["verify-candidate", "candidate"],
  ["start-workers", "exposing"],
  ["open-ingress", "exposing"],
  ["verify-activated", "exposing"],
];
const same = (a: readonly string[], b: readonly string[]) =>
  JSON.stringify(a) === JSON.stringify(b);
const safeDrain = (o: DeploymentObservation) =>
  o.maintenance && o.claimsStopped && o.drained && o.effectsCertain;

/** This process must run outside the application deployment; journal lock spans all effects. */
export class UpgradeExecutionEngine {
  constructor(
    private readonly lifecycle: DeploymentLifecyclePort,
    private readonly journal: ExecutionJournalPort,
  ) {}

  execute(plan: DeploymentPlan): Promise<ExecutionSnapshot> {
    return this.journal.withExclusive(async () => {
      await this.lifecycle.assertFresh(plan.fingerprint);
      let state = await this.journal.read(plan.runId);
      if (state && state.fingerprint !== plan.fingerprint)
        throw new Error("Upgrade approval conflict");
      if (state?.pendingEffect) state = await this.reconcileState(plan, state);
      if (
        state &&
        ["blocked", "succeeded", "rolled-back"].includes(state.phase)
      )
        return state;
      state ??= await this.journal.append(
        plan.runId,
        await this.journal.currentVersion(),
        {
          phase: "ready",
          fingerprint: plan.fingerprint,
          pendingEffect: null,
          completed: [],
          exposurePossible: false,
          reason: null,
        },
      );
      for (const [effect, phase] of steps) {
        if (state.completed.includes(effect)) continue;
        if (
          effect === "hold-backup" &&
          !safeDrain(await this.lifecycle.observe())
        ) {
          return this.block(plan, state, "drain-unconfirmed");
        }
        state = await this.save(plan, state, {
          phase,
          pendingEffect: effect,
          exposurePossible:
            state.exposurePossible || effect === "start-workers",
        });
        try {
          await this.perform(effect, plan);
        } catch {
          return this.recover(plan, state);
        }
        if (
          effect === "migrate" &&
          !this.targetMatches(plan, await this.lifecycle.observe())
        )
          return this.block(plan, state, "migration-state-unconfirmed");
        // A journal failure propagates; never perform a new effect without durable authority.
        state = await this.save(plan, state, {
          pendingEffect: null,
          completed: [...state.completed, effect],
        });
      }
      return this.save(plan, state, { phase: "succeeded" });
    });
  }

  reconcile(plan: DeploymentPlan): Promise<ExecutionSnapshot> {
    return this.journal.withExclusive(async () => {
      const state = await this.journal.read(plan.runId);
      if (!state || state.fingerprint !== plan.fingerprint)
        throw new Error("Upgrade run conflict");
      return this.reconcileState(plan, state);
    });
  }

  rollback(plan: DeploymentPlan): Promise<ExecutionSnapshot> {
    return this.journal.withExclusive(async () => {
      const state = await this.journal.read(plan.runId);
      if (!state || state.fingerprint !== plan.fingerprint)
        throw new Error("Upgrade run conflict");
      if (state.phase === "rolled-back") return state;
      const observed = await this.lifecycle.observe();
      if (
        state.exposurePossible ||
        !plan.previousCompatibleAfterCandidateWrites ||
        !safeDrain(observed) ||
        !this.targetMatches(plan, observed)
      )
        return this.block(plan, state, "rollback-not-authorized");
      return this.restore(plan, state);
    });
  }

  private async reconcileState(
    plan: DeploymentPlan,
    state: ExecutionSnapshot,
  ): Promise<ExecutionSnapshot> {
    if (!state.pendingEffect) return state;
    const observed = await this.lifecycle.observe();
    if (state.exposurePossible)
      return this.block(plan, state, "exposure-requires-recovery");
    if (!observed.effectsCertain)
      return this.block(plan, state, "effects-uncertain");
    const effect = state.pendingEffect;
    const proven =
      effect === "close-ingress"
        ? observed.maintenance
        : effect === "stop-claims"
          ? observed.maintenance && observed.claimsStopped
          : effect === "drain"
            ? safeDrain(observed)
            : effect === "migrate"
              ? safeDrain(observed) && this.targetMatches(plan, observed)
              : effect === "start-candidate" || effect === "verify-candidate"
                ? this.targetMatches(plan, observed) &&
                  observed.candidateReady &&
                  this.sameImages(observed, plan.candidateImages)
                : effect === "restore-previous"
                  ? this.targetMatches(plan, observed) &&
                    observed.candidateReady &&
                    this.sameImages(observed, plan.previousImages)
                  : false;
    if (!proven) return this.block(plan, state, "effect-unconfirmed");
    return this.save(plan, state, {
      pendingEffect: null,
      completed: [...state.completed, effect],
      ...(effect === "restore-previous"
        ? { phase: "rolled-back" as const, reason: null }
        : {}),
    });
  }

  private async recover(
    plan: DeploymentPlan,
    state: ExecutionSnapshot,
  ): Promise<ExecutionSnapshot> {
    // A migration timeout is ambiguous even when a transport says it failed.
    if (state.pendingEffect === "migrate")
      return this.reconcileState(plan, state);
    if (state.exposurePossible) {
      // Persist the maintenance intent first; losing this acknowledgement still forbids rollback.
      const closing = await this.save(plan, state, {
        pendingEffect: "close-ingress",
      });
      try {
        await this.lifecycle.closeIngress();
      } catch {
        /* observed uncertainty is retained */
      }
      return this.block(plan, closing, "post-exposure-recovery");
    }
    if (
      !plan.previousCompatibleAfterCandidateWrites ||
      !["start-candidate", "verify-candidate"].includes(
        state.pendingEffect ?? "",
      )
    )
      return this.block(plan, state, "effect-failed");
    if (!this.targetMatches(plan, await this.lifecycle.observe()))
      return this.block(plan, state, "effects-uncertain");
    return this.restore(plan, state);
  }

  private async restore(
    plan: DeploymentPlan,
    state: ExecutionSnapshot,
  ): Promise<ExecutionSnapshot> {
    const restoring = await this.save(plan, state, {
      pendingEffect: "restore-previous",
    });
    try {
      await this.lifecycle.restorePreviousImages(plan.previousImages);
      const observed = await this.lifecycle.observe();
      if (
        !this.targetMatches(plan, observed) ||
        !observed.candidateReady ||
        !this.sameImages(observed, plan.previousImages)
      )
        throw new EffectFailure();
    } catch {
      return this.block(plan, restoring, "rollback-unconfirmed");
    }
    // Maintenance remains closed; a human must explicitly authorize resuming old workers.
    return this.save(plan, restoring, {
      phase: "rolled-back",
      reason: null,
      pendingEffect: null,
      completed: [...state.completed, "restore-previous"],
    });
  }

  private targetMatches(
    plan: DeploymentPlan,
    observed: DeploymentObservation,
  ): boolean {
    return (
      safeDrain(observed) &&
      !!plan.expectedLedgerDigest &&
      !!plan.targetSchemaDigest &&
      observed.ledgerDigest === plan.expectedLedgerDigest &&
      observed.schemaDigest === plan.targetSchemaDigest &&
      same(observed.ledger, [
        ...plan.baselineLedger,
        ...plan.migrations.map((migration) => migration.name.split("_")[0]!),
      ])
    );
  }

  private sameImages(
    observed: DeploymentObservation,
    expected: DeploymentPlan["candidateImages"],
  ): boolean {
    return (
      observed.images.length === expected.length &&
      expected.every((image) =>
        observed.images.some(
          (actual) =>
            actual.service === image.service &&
            actual.digest === image.digest &&
            actual.imageId === image.imageId &&
            actual.platform === image.platform,
        ),
      )
    );
  }
  private block(
    plan: DeploymentPlan,
    state: ExecutionSnapshot,
    reason: string,
  ) {
    return this.save(plan, state, { phase: "blocked", reason });
  }
  private save(
    plan: DeploymentPlan,
    state: ExecutionSnapshot,
    patch: Partial<Omit<ExecutionSnapshot, "version">>,
  ) {
    const { version, ...snapshot } = state;
    return this.journal.append(plan.runId, version, { ...snapshot, ...patch });
  }
  private perform(
    effect: DeploymentEffect,
    plan: DeploymentPlan,
  ): Promise<void> {
    switch (effect) {
      case "close-ingress":
        return this.lifecycle.closeIngress();
      case "stop-claims":
        return this.lifecycle.stopClaims();
      case "drain":
        return this.lifecycle.drain();
      case "hold-backup":
        return this.lifecycle.holdVerifiedBackup();
      case "migrate":
        return this.lifecycle.migrate(plan);
      case "start-candidate":
        return this.lifecycle.startCandidate(plan.candidateImages);
      case "verify-candidate":
        return this.lifecycle.verifyCandidate();
      case "start-workers":
        return this.lifecycle.startWorkers();
      case "open-ingress":
        return this.lifecycle.openIngress();
      case "verify-activated":
        return this.lifecycle.verifyActivated();
      case "restore-previous":
        return this.lifecycle.restorePreviousImages(plan.previousImages);
    }
  }
}
