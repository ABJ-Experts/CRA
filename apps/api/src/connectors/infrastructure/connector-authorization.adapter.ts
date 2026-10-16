import type { PermissionKey } from "@repo/contracts/permissions";
import { hasAllPermissions } from "@repo/contracts/permissions";
import type { PermissionsService } from "../../permissions/permissions.service";
import type { ConnectorAuthorizationPort } from "../application/connector-authorization.port";
import { ConnectorError } from "../application/connector-errors";
import type { SupabaseConnectorHubRepository } from "./supabase-connector-hub.repository";

/** Effective permissions use the existing merge policy, with an atomic SQL epoch fence. */
export class ConnectorAuthorizationAdapter implements ConnectorAuthorizationPort {
  constructor(
    private readonly repository: Pick<
      SupabaseConnectorHubRepository,
      "actor" | "permissionVersion"
    >,
    private readonly permissions: Pick<
      PermissionsService,
      "effectivePermissions"
    >,
  ) {}

  async authorize(
    orgId: string,
    actorId: string,
    keys: readonly PermissionKey[],
    ownerOnly = false,
  ) {
    const before = await this.repository.permissionVersion(orgId);
    const actor = await this.repository.actor(orgId, actorId);
    if (ownerOnly && actor.role !== "owner")
      throw new ConnectorError("forbidden_by_policy");
    const permissions = await this.permissions.effectivePermissions(
      orgId,
      actorId,
      actor.role,
    );
    if (!hasAllPermissions(permissions, keys))
      throw new ConnectorError("forbidden_by_policy");
    const after = await this.repository.permissionVersion(orgId);
    if (before !== after) throw new ConnectorError("conflict");
    return Object.freeze({
      organizationId: orgId,
      actorId,
      role: actor.role,
      permissionVersion: after,
    });
  }
}
