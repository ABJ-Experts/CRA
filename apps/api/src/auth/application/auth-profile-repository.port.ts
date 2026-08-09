export type VerificationOutcome =
  "verified" | "missing" | "expired" | "attempts_exhausted" | "invalid";

export class AuthProfileRepositoryUnavailableError extends Error {
  constructor() {
    super("auth profile repository unavailable");
    this.name = "AuthProfileRepositoryUnavailableError";
  }
}

export type PasswordResetClaim = Readonly<
  | { outcome: "consumed"; userId: string; authUserId: string }
  | { outcome: "invalid" | "expired" | "profile_missing" }
>;

export type AuthUserProfile = Readonly<{
  id: string;
  authUserId: string | null;
  email: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  emailVerifiedAt: string | null;
}>;

export type AuthMembership = Readonly<{
  role: string;
  organization: Readonly<{ id: string; name: string; slug: string }>;
}>;

export interface AuthProfileRepository {
  readonly isUsernameTaken: (username: string) => Promise<boolean>;
  readonly findByAuthUserId: (
    authUserId: string,
  ) => Promise<AuthUserProfile | null>;
  readonly findById: (userId: string) => Promise<AuthUserProfile | null>;
  readonly findByEmail: (email: string) => Promise<AuthUserProfile | null>;
  readonly resolveUsername: (username: string) => Promise<string | null>;
  readonly listMemberships: (
    userId: string,
  ) => Promise<readonly AuthMembership[]>;
  readonly lockedUntil: (email: string) => Promise<string | null>;
  readonly recordLoginFailure: (
    email: string,
    maxAttempts: number,
    lockMinutes: number,
  ) => Promise<void>;
  readonly clearLoginFailures: (email: string) => Promise<void>;
  readonly bumpSessionEpoch: (userId: string) => Promise<void>;
  readonly supersedeVerification: (userId: string) => Promise<void>;
  readonly storeVerification: (
    artifact: Readonly<{
      userId: string;
      email: string;
      codeHash: string;
      expiresAt: string;
    }>,
  ) => Promise<void>;
  readonly storePasswordReset: (
    artifact: Readonly<{
      userId: string;
      tokenHash: string;
      expiresAt: string;
    }>,
  ) => Promise<void>;
  readonly replaceRecoveryCodes: (
    userId: string,
    codeHashes: readonly string[],
  ) => Promise<void>;
  readonly clearRecoveryCodes: (userId: string) => Promise<void>;
  readonly verifyEmailCode: (
    userId: string,
    codeHash: string,
    maxAttempts: number,
  ) => Promise<VerificationOutcome>;
  readonly consumePasswordReset: (
    tokenHash: string,
  ) => Promise<PasswordResetClaim>;
}
