import { randomUUID } from "node:crypto";
import type { UpgradeActor } from "./upgrade-control.port";
import type {
  StagedUpgradeBundle,
  UpgradeSupervisorJournal,
} from "./upgrade-supervisor.port";
import type {
  DeploymentLifecyclePort,
  DeploymentPlan,
} from "./deployment-lifecycle.port";

/** Docker mutation is admitted only after fresh apply review under the execution lock. */
export async function importApprovedUpgradeImages(
  deps: {
    journal: UpgradeSupervisorJournal;
    loadImages?: (bundle: StagedUpgradeBundle) => Promise<void>;
    flushAudit?: () => Promise<void>;
  },
  actor: UpgradeActor,
  bundle: StagedUpgradeBundle,
  plan: DeploymentPlan,
  lifecycle: DeploymentLifecyclePort,
  authorize: () => Promise<void>,
) {
  if (!deps.loadImages) return;
  await deps.journal.withExclusive(async () => {
    await authorize();
    await lifecycle.assertFresh(plan.fingerprint);
    const records = await deps.journal.read();
    if (
      records.some(
        (record) =>
          record.runId === plan.runId &&
          record.kind === "image-load-result" &&
          record.data.manifestDigest === bundle.manifestDigest &&
          record.data.fingerprint === plan.fingerprint,
      )
    )
      return;
    await deps.journal.append({
      runId: plan.runId,
      expectedVersion: records.length,
      idempotencyKey: randomUUID(),
      kind: "image-load-intent",
      data: {
        manifestDigest: bundle.manifestDigest,
        fingerprint: plan.fingerprint,
        audit: {
          actorId: actor.principalId,
          action: "upgrade.image_load",
          outcome: "intent",
          metadata: { runId: plan.runId },
        },
      },
    });
    await deps.flushAudit?.();
    await authorize();
    await lifecycle.assertFresh(plan.fingerprint);
    await deps.loadImages!(bundle);
    await deps.journal.append({
      runId: plan.runId,
      expectedVersion: (await deps.journal.read()).length,
      idempotencyKey: randomUUID(),
      kind: "image-load-result",
      data: {
        manifestDigest: bundle.manifestDigest,
        fingerprint: plan.fingerprint,
      },
    });
  });
}
