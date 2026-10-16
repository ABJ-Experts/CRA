import type { LicenseCapability } from "@repo/contracts/licensing";

/** Policy checks happen before claim; source RPCs repeat atomic admission. */
export interface LicensingWorkerPolicy {
  canClaim(
    organizationId: string,
    capability: LicenseCapability,
  ): Promise<boolean>;
}

/** Global queues refresh only bounded source-owned candidate tenant scopes. */
export interface LicensingGlobalWorkerPolicy {
  prepareClaims(capability: LicenseCapability): Promise<void>;
}
