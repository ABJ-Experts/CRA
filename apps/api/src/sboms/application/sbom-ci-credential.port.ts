export const SBOM_CI_CREDENTIALS = Symbol("SBOM_CI_CREDENTIALS");

export type SbomCiCredential = Readonly<{
  id: string;
  organizationId: string;
  label: string;
  tokenPrefix: string;
  createdAt: string;
  createdBy: string;
  revokedAt: string | null;
  revokedBy: string | null;
  lastUsedAt: string | null;
}>;

export interface SbomCiCredentialPort {
  authenticate(
    token: string,
  ): Promise<Readonly<{ organizationId: string; credentialId: string }> | null>;
  create(
    organizationId: string,
    input: Readonly<{ actorId: string; label: string; idempotencyKey: string }>,
  ): Promise<
    | Readonly<{ credential: SbomCiCredential; secret: string }>
    | "conflict"
    | "idempotency_mismatch"
  >;
  list(organizationId: string): Promise<readonly SbomCiCredential[]>;
  revoke(
    organizationId: string,
    input: Readonly<{
      credentialId: string;
      actorId: string;
      idempotencyKey: string;
    }>,
  ): Promise<SbomCiCredential | "not_found" | "conflict">;
}
