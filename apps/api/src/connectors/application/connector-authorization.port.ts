import type { PermissionKey } from "@repo/contracts/permissions";

export type ConnectorAuthorization = Readonly<{
  organizationId: string;
  actorId: string;
  permissionVersion: number;
  role: "owner" | "admin" | "member" | "viewer";
}>;

/** Reuses the existing permission resolver; SQL fences this snapshot atomically. */
export interface ConnectorAuthorizationPort {
  authorize(
    organizationId: string,
    actorId: string,
    permissions: readonly PermissionKey[],
    ownerOnly?: boolean,
  ): Promise<ConnectorAuthorization>;
}
