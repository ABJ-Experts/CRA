export type MfaRecoveryStatus =
  "claimed" | "factors_removed" | "completed" | "failed";

export type MfaRecoveryClaim = Readonly<
  | { outcome: "invalid" }
  | {
      outcome: "claimed" | "resumed" | "in_progress";
      operationId: string;
      authUserId: string;
      status: MfaRecoveryStatus;
    }
>;

export interface MfaRecoveryRepository {
  readonly claim: (
    userId: string,
    codeHash: string,
  ) => Promise<MfaRecoveryClaim>;
  readonly status: (
    operationId: string,
    userId: string,
  ) => Promise<MfaRecoveryStatus>;
  readonly markFactorsRemoved: (
    operationId: string,
    userId: string,
  ) => Promise<void>;
  readonly complete: (operationId: string, userId: string) => Promise<void>;
  readonly fail: (
    operationId: string,
    userId: string,
    errorCode: string,
  ) => Promise<void>;
}
