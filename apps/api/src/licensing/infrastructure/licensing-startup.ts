import type { OnApplicationBootstrap } from "@nestjs/common";
import { z } from "zod";
import type { LicensePolicySynchronizationPort } from "../application/licensing.port";
import type { LicensingService } from "../application/licensing.service";

export const licensePolicyTenantPageSchema = z
  .object({
    organizationIds: z.array(z.uuid()).max(100),
    nextCursor: z.uuid().nullable(),
  })
  .strict();

/** Nest awaits this barrier before listening, including application-context workers. */
export class LicensingStartup implements OnApplicationBootstrap {
  constructor(
    private readonly repository: LicensePolicySynchronizationPort,
    private readonly service: Pick<LicensingService, "getWorkerPolicy">,
    private readonly loadTrust: () => Promise<unknown>,
    private readonly configuration: { instanceId?: string; trustFile?: string },
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.configuration.trustFile) await this.loadTrust();
    let after: string | null = null;
    for (;;) {
      const page = licensePolicyTenantPageSchema.parse(
        await this.repository.listPolicyTenants(100, after),
      );
      // Normalize UUID case to mirror PostgreSQL ordering and reject cycles/duplicates.
      const ids = page.organizationIds.map((id) => id.toLowerCase());
      const cursor = page.nextCursor?.toLowerCase() ?? null;
      if (
        ids.some((id, index) => id <= (ids[index - 1] ?? after ?? "")) ||
        (cursor !== null && cursor !== ids.at(-1))
      )
        throw new Error("Invalid licence policy tenant pagination");
      if (
        ids.length &&
        (!this.configuration.instanceId || !this.configuration.trustFile)
      )
        throw new Error(
          "Licence configuration is incomplete for persisted tenant licence states",
        );
      // Expired or removed-key licences publish denied proofs, allowing renewal and evidence access.
      // Publication conflicts and unavailable authority reject bootstrap rather than enabling stale policy.
      for (const orgId of ids) await this.service.getWorkerPolicy(orgId);
      if (cursor === null) return;
      after = cursor;
    }
  }
}
