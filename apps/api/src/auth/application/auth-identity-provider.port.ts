export interface AuthIdentityProvider {
  readonly updatePassword: (
    authUserId: string,
    password: string,
  ) => Promise<void>;
  readonly listMfaFactors: (
    authUserId: string,
  ) => Promise<readonly Readonly<{ id: string }>[]>;
  readonly deleteMfaFactor: (
    authUserId: string,
    factorId: string,
  ) => Promise<void>;
}
