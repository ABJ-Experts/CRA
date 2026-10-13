import type { LicenseCapability } from "@repo/contracts/licensing";
import { licenceRouteOperations } from "./licence-route-operations";
import { licenceWorkerOperations } from "./licence-worker-operations";

export type LicenceOperation = Readonly<{
  kind:
    | "customer"
    | "evidence"
    | "security"
    | "protective"
    | "renewal"
    | "regulatory"
    | "mixed"
    | "source"
    | "admission-finalization";
  capability?: LicenseCapability;
  identity: "member" | "source" | "public" | "worker";
  mutation: boolean;
  authority: string;
  evidence: string;
  reason: string;
}>;

/** Unknown operations are not grants; callers must reject an absent entry. */
export function getLicenceRouteOperation(
  controllerName: string,
  handlerName: string,
): LicenceOperation | undefined {
  const key = `${controllerName}.${handlerName}`;
  return Object.hasOwn(licenceRouteOperations, key)
    ? licenceRouteOperations[key]
    : undefined;
}

export function getLicenceWorkerOperation(
  sourcePath: string,
): LicenceOperation | undefined {
  return Object.hasOwn(licenceWorkerOperations, sourcePath)
    ? licenceWorkerOperations[sourcePath]
    : undefined;
}
