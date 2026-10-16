import { randomUUID } from "node:crypto";
import type { UpgradeSupervisorJournal as UpgradeHostJournal } from "./upgrade-supervisor.port";
import type { UpgradeActor } from "./upgrade-control.port";
import type {
  ExecutionJournalPort,
  ExecutionSnapshot,
} from "./deployment-lifecycle.port";

export class UpgradeExecutionJournal implements ExecutionJournalPort {
  constructor(
    private readonly journal: UpgradeHostJournal,
    private readonly actor?: UpgradeActor,
    private readonly flushAudit?: () => Promise<void>,
  ) {}
  withExclusive<T>(effect: () => Promise<T>) {
    return this.journal.withExclusive(effect);
  }
  async currentVersion() {
    return (await this.journal.read()).length;
  }
  async read(runId: string): Promise<ExecutionSnapshot | null> {
    const records = await this.journal.read();
    const record = records.findLast(
      (r) => r.runId === runId && r.kind === "execution",
    );
    return record
      ? ({
          ...record.data,
          version: records.length,
        } as unknown as ExecutionSnapshot)
      : null;
  }
  async append(
    runId: string,
    expectedVersion: number,
    snapshot: Omit<ExecutionSnapshot, "version">,
  ) {
    const record = await this.journal.append({
      runId,
      expectedVersion,
      idempotencyKey: randomUUID(),
      kind: "execution",
      data: {
        ...snapshot,
        ...(this.actor
          ? {
              audit: {
                actorId: this.actor.principalId,
                action: "upgrade.execution",
                outcome: snapshot.pendingEffect ? "intent" : "completed",
                metadata: {
                  runId,
                  state: snapshot.phase,
                  stage: snapshot.pendingEffect ?? "acknowledged",
                },
              },
            }
          : {}),
      },
    });
    await this.flushAudit?.();
    return {
      ...snapshot,
      version: this.flushAudit ? await this.currentVersion() : record.sequence,
    };
  }
}
