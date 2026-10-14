import type {
  SupportDiagnosticJob,
  SupportDiagnosticManifest,
  SupportDiagnosticOmission,
  SupportDiagnosticPayload,
} from "@repo/contracts/support-diagnostics";
export interface DiagnosticClaim {
  job: SupportDiagnosticJob;
  creatorUserId: string;
  sessionId: string;
  permissionVersion: string;
  objectPath: string;
  objectPaths?: string[];
}
export type DiagnosticCleanupClaim = Omit<
  DiagnosticClaim,
  "objectPath" | "objectPaths"
> & {
  objectPath: string | null;
  objectPaths: string[];
};
export interface DiagnosticWorkerRepository {
  claim(signal?: AbortSignal): Promise<DiagnosticClaim | null>;
  authorize(
    claim: DiagnosticClaim,
    signal?: AbortSignal,
  ): Promise<DiagnosticClaim>;
  heartbeat(
    claim: DiagnosticClaim,
    signal?: AbortSignal,
  ): Promise<DiagnosticClaim>;
  checkpoint(
    claim: DiagnosticClaim,
    stage: "collecting" | "redacting" | "packaging",
    completed: number,
    omissions: SupportDiagnosticOmission[],
    signal?: AbortSignal,
  ): Promise<DiagnosticClaim>;
  complete(
    claim: DiagnosticClaim,
    artifact: NonNullable<SupportDiagnosticJob["artifact"]>,
    manifest: SupportDiagnosticManifest,
    signal?: AbortSignal,
  ): Promise<void>;
  fail(
    claim: DiagnosticClaim,
    code: string,
    signal?: AbortSignal,
  ): Promise<void>;
  claimCleanup(signal?: AbortSignal): Promise<DiagnosticCleanupClaim | null>;
  authorizeCleanup(
    claim: DiagnosticCleanupClaim,
    signal?: AbortSignal,
  ): Promise<DiagnosticCleanupClaim>;
  finishCleanup(
    claim: DiagnosticCleanupClaim,
    deleted: boolean,
    signal?: AbortSignal,
  ): Promise<void>;
}
export interface DiagnosticSourcePort {
  collect(
    claim: DiagnosticClaim,
    signal: AbortSignal,
  ): Promise<SupportDiagnosticPayload>;
}
