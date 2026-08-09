export type AuthTokens = Readonly<{
  accessToken: string;
  refreshToken: string;
}>;

export class AuthIdentityProviderUnavailableError extends Error {
  constructor() {
    super("auth identity provider unavailable");
    this.name = "AuthIdentityProviderUnavailableError";
  }
}

export type AuthenticatedIdentity = Readonly<{
  authUserId: string;
  tokens: AuthTokens;
}>;

export type MfaEnrollment = Readonly<{
  factorId: string;
  qrCode: string;
  secret: string;
  uri: string;
}>;

export type MfaVerification = Readonly<
  | { outcome: "verified"; tokens: AuthTokens }
  | { outcome: "challenge_failed" | "invalid" }
>;

export type UserMfaFactor = Readonly<{
  id: string;
  status: string;
}>;

export interface AuthIdentityProvider {
  readonly register: (
    email: string,
    password: string,
    username: string,
  ) => Promise<
    | Readonly<{ outcome: "created"; identity: AuthenticatedIdentity }>
    | Readonly<{ outcome: "email_taken" | "failed" }>
  >;
  readonly authenticate: (
    email: string,
    password: string,
  ) => Promise<AuthenticatedIdentity | null>;
  readonly refresh: (refreshToken: string) => Promise<AuthTokens | null>;
  readonly signOutGlobally: (accessToken: string) => Promise<void>;
  readonly updatePassword: (
    authUserId: string,
    password: string,
  ) => Promise<boolean>;
  readonly listMfaFactors: (
    authUserId: string,
  ) => Promise<readonly Readonly<{ id: string }>[]>;
  readonly deleteMfaFactor: (
    authUserId: string,
    factorId: string,
  ) => Promise<void>;
  readonly enrollMfa: (accessToken: string) => Promise<MfaEnrollment | null>;
  readonly verifyMfa: (
    accessToken: string,
    factorId: string,
    code: string,
  ) => Promise<MfaVerification>;
  readonly listUserMfaFactors: (
    accessToken: string,
  ) => Promise<readonly UserMfaFactor[] | null>;
  readonly unenrollMfa: (
    accessToken: string,
    factorId: string,
  ) => Promise<boolean>;
}
