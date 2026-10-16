import type { BaseRole } from "@repo/contracts/permissions";
import type { RequestUser } from "../../auth/auth.types";
import { ExportAccessDeniedError } from "../domain/export.errors";

export type ExportPrincipal = Readonly<{
  organizationId: string;
  actorId: string;
  sessionId: string;
  role: BaseRole;
}>;
export function exportPrincipal(user: RequestUser): ExportPrincipal {
  if (!user.isActive || !user.organizationId || !user.sessionId || !user.role)
    throw new ExportAccessDeniedError();
  return Object.freeze({
    organizationId: user.organizationId,
    actorId: user.id,
    sessionId: user.sessionId,
    role: user.role,
  });
}
