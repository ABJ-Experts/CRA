export type VerificationOutcome =
  "verified" | "missing" | "expired" | "attempts_exhausted" | "invalid";

export type PasswordResetClaim = Readonly<
  | { outcome: "consumed"; userId: string; authUserId: string }
  | { outcome: "invalid" | "expired" | "profile_missing" }
>;

export interface AuthProfileRepository {
  readonly verifyEmailCode: (
    userId: string,
    codeHash: string,
    maxAttempts: number,
  ) => Promise<VerificationOutcome>;
  readonly consumePasswordReset: (
    tokenHash: string,
  ) => Promise<PasswordResetClaim>;
}
