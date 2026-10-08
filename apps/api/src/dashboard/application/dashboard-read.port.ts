export type DashboardEndpoint =
  "overview" | "posture" | "obligations" | "readiness" | "ingestion";
export type DashboardCursorScope = Readonly<{
  organizationId: string;
  actorId: string;
  sessionId: string;
  permissionFingerprint: string;
  endpoint: string;
  filters: Readonly<Record<string, unknown>>;
}>;
export interface DashboardTokens {
  seal(
    scope: DashboardCursorScope,
    position: Readonly<Record<string, unknown>>,
  ): string;
  open(
    token: string,
    scope: DashboardCursorScope,
  ): Readonly<Record<string, unknown>>;
  fingerprint(value: unknown): string;
}
export interface DashboardReadPort {
  read(
    orgId: string,
    input: Readonly<{
      actorId: string;
      endpoint: DashboardEndpoint;
      filters: Readonly<Record<string, unknown>>;
    }>,
  ): Promise<unknown>;
}
export interface DashboardPermissionsPort {
  snapshot(
    orgId: string,
    actorId: string,
    role: import("@repo/contracts/permissions").BaseRole,
  ): Promise<
    Readonly<{
      version: number;
      permissions: Readonly<
        import("@repo/contracts/permissions").PermissionSet
      >;
    }>
  >;
}
export class DashboardInvalidCursorError extends Error {}
export class DashboardUnavailableError extends Error {}
export class DashboardNotFoundError extends Error {}
export class DashboardForbiddenError extends Error {}

export interface DashboardDiagnosticsPort {
  readUnavailable?(
    endpoint: DashboardEndpoint,
    phase: "permission_snapshot" | "response_validation",
  ): void;
  sectionUnavailable(
    source: string,
    classification: "provider_contract_invalid",
  ): void;
}
