import { createHash } from "node:crypto";
import { ExportAccessDeniedError } from "../domain/export.errors";
export type PortalExportPrincipal = Readonly<{
  kind: "supplier_session" | "auditor_session";
  sessionDigest: string;
}>;
export function portalExportPrincipal(
  kind: PortalExportPrincipal["kind"],
  token: string | undefined,
): PortalExportPrincipal {
  if (
    !token ||
    token.length < 43 ||
    token.length > 256 ||
    Array.from(token).some((character) => character.charCodeAt(0) <= 32)
  )
    throw new ExportAccessDeniedError();
  return Object.freeze({
    kind,
    sessionDigest: createHash("sha256").update(token).digest("hex"),
  });
}
