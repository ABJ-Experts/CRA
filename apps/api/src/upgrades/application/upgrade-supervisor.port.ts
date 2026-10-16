import type { UpgradeManifest } from "@repo/contracts/upgrades/types";
export interface UpgradeJournalRecord {
  readonly sequence: number;
  readonly instanceId: string;
  readonly runId: string;
  readonly kind: string;
  readonly idempotencyKey: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly previousHash: string;
  readonly hash: string;
}
export interface UpgradeJournalAppend {
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly runId: string;
  readonly kind: string;
  readonly data: Readonly<Record<string, unknown>>;
}
export interface UpgradeSupervisorJournal {
  read(): Promise<readonly UpgradeJournalRecord[]>;
  append(command: UpgradeJournalAppend): Promise<UpgradeJournalRecord>;
  withExclusive<T>(effect: () => Promise<T>): Promise<T>;
}
export class UpgradeControlError extends Error {
  constructor(readonly status: 401 | 403 | 409 | 503 = 503) {
    super("Upgrade control unavailable");
  }
}

export interface StagedUpgradeBundle {
  readonly manifest: UpgradeManifest;
  readonly manifestDigest: string;
  readonly stagingId: string;
  readonly archivePath: string;
  readonly extractedRoot: string;
}
