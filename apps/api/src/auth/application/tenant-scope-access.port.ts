export type TenantScopeAccessOutcome = Readonly<{
  outcome:
    | "allowed"
    | "not_found"
    | "inactive"
    | "revoked"
    | "expired"
    | "unavailable"
    | "malformed";
}>;

export interface TenantScopeAccessPort {
  authorize(
    scope: Readonly<{
      organizationId: string;
      userId: string;
      sessionId: string;
      issuedAt: string;
      allowRecovery: boolean;
    }>,
  ): Promise<TenantScopeAccessOutcome>;
}

export const TENANT_SCOPE_ACCESS_PORT = Symbol("TENANT_SCOPE_ACCESS_PORT");
