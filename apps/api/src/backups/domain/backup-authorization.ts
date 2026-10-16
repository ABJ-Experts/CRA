import { BackupOriginError, BackupScopeError } from "./backup-errors";
import type { OperatorIdentity } from "../../operator/domain/operator-grants";
import type { BackupAction } from "@repo/contracts/backups/types";
export type { BackupAction } from "@repo/contracts/backups/types";
/** Fresh raw-TLS identity is supplied by ingress; metadata grants confer no execution. */
export function authorizeBackupAction(
  identity: OperatorIdentity,
  mountedInstanceId: string,
  instanceId: string,
  action: BackupAction,
): void {
  if (
    instanceId !== mountedInstanceId ||
    !identity.instanceIds.includes(instanceId) ||
    !identity.backupScopes?.some(
      (scope) =>
        scope.instanceId === instanceId && scope.actions.includes(action),
    )
  ) {
    throw new BackupScopeError();
  }
}
export function assertPrivateMutation(request: {
  method: string;
  headers: {
    origin?: string;
    host?: string;
    "content-type"?: string;
    "sec-fetch-site"?: string;
  };
}): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const { origin, host } = request.headers;
  if (
    !origin ||
    !host ||
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers["content-type"] ?? "",
    ) ||
    request.headers["sec-fetch-site"] === "cross-site"
  )
    throw new BackupOriginError();
  try {
    const parsed = new URL(origin);
    if (
      parsed.protocol !== "https:" ||
      parsed.origin !== origin ||
      origin !== `https://${host}` ||
      parsed.username ||
      parsed.password
    )
      throw new Error();
  } catch {
    throw new BackupOriginError();
  }
}
