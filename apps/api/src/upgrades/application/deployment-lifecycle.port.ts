/** Host-private lifecycle boundary. No executable, Compose path or command comes from media. */
export interface DeploymentImage {
  readonly service: string;
  readonly digest: string;
  readonly imageId: string;
  readonly platform: string;
}
export interface DeploymentMigration {
  readonly name: string;
  readonly sha256: string;
  readonly sql: string;
}
export interface DeploymentPlan {
  readonly runId: string;
  readonly fingerprint: string;
  readonly previousImages: readonly DeploymentImage[];
  readonly candidateImages: readonly DeploymentImage[];
  readonly migrations: readonly DeploymentMigration[];
  readonly baselineLedger: readonly string[];
  readonly expectedLedgerDigest: string;
  readonly targetSchemaDigest: string;
  readonly previousCompatibleAfterCandidateWrites: boolean;
}
export interface DeploymentObservation {
  readonly maintenance: boolean;
  readonly claimsStopped: boolean;
  readonly drained: boolean;
  readonly effectsCertain: boolean;
  readonly images: readonly DeploymentImage[];
  readonly ledger: readonly string[];
  readonly ledgerDigest: string;
  readonly schemaDigest: string;
  readonly candidateReady: boolean;
  readonly workersReady: boolean;
}
export interface DeploymentLifecyclePort {
  observe(): Promise<DeploymentObservation>;
  /** Revalidates all fingerprint inputs including grant/trust, immutable media and backup hold. */
  assertFresh(fingerprint: string): Promise<void>;
  closeIngress(): Promise<void>;
  stopClaims(): Promise<void>;
  drain(): Promise<void>;
  holdVerifiedBackup(): Promise<void>;
  migrate(plan: DeploymentPlan): Promise<void>;
  startCandidate(images: readonly DeploymentImage[]): Promise<void>;
  verifyCandidate(): Promise<void>;
  startWorkers(): Promise<void>;
  openIngress(): Promise<void>;
  verifyActivated(): Promise<void>;
  restorePreviousImages(images: readonly DeploymentImage[]): Promise<void>;
}
export type ExecutionPhase =
  | "ready"
  | "draining"
  | "checkpoint"
  | "migrating"
  | "candidate"
  | "exposing"
  | "succeeded"
  | "rolled-back"
  | "blocked";
export type DeploymentEffect =
  | "close-ingress"
  | "stop-claims"
  | "drain"
  | "hold-backup"
  | "migrate"
  | "start-candidate"
  | "verify-candidate"
  | "start-workers"
  | "open-ingress"
  | "verify-activated"
  | "restore-previous";
export interface ExecutionSnapshot {
  readonly version: number;
  readonly phase: ExecutionPhase;
  readonly fingerprint: string;
  readonly pendingEffect: DeploymentEffect | null;
  readonly completed: readonly DeploymentEffect[];
  readonly exposurePossible: boolean;
  readonly reason: string | null;
}
export interface ExecutionJournalPort {
  withExclusive<T>(effect: () => Promise<T>): Promise<T>;
  read(runId: string): Promise<ExecutionSnapshot | null>;
  currentVersion(): Promise<number>;
  append(
    runId: string,
    expectedVersion: number,
    snapshot: Omit<ExecutionSnapshot, "version">,
  ): Promise<ExecutionSnapshot>;
}
