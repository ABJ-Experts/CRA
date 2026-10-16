import {
  BackupAuthorizationError,
  BackupUnavailableError,
} from "../domain/backup-errors";
import {
  backupAssuranceSchema,
  backupCustomerHistorySchema,
} from "@repo/contracts/backups/schemas";
import type { BackupAssurancePort } from "./backup-assurance.port";
import { z } from "zod";
const response = z.strictObject({
  outcome: z.enum(["ok", "forbidden"]),
  assurance: backupAssuranceSchema.optional(),
  history: backupCustomerHistorySchema.optional(),
});
export class BackupAssuranceUseCases {
  constructor(private readonly repository: BackupAssurancePort) {}
  private async read(
    orgId: string,
    actorId: string,
    limit = 25,
    cursor?: string,
    kind?: "capture" | "verification",
  ) {
    if (!orgId) throw new BackupAuthorizationError();
    const parsed = response.safeParse(
      await this.repository.read(orgId, actorId, limit, cursor, kind),
    );
    if (
      !parsed.success ||
      (parsed.data.outcome === "ok" &&
        (!parsed.data.assurance || !parsed.data.history))
    )
      throw new BackupUnavailableError();
    if (parsed.data.outcome === "forbidden")
      throw new BackupAuthorizationError();
    return { assurance: parsed.data.assurance!, history: parsed.data.history! };
  }
  async summary(orgId: string, actorId: string) {
    try {
      return (await this.read(orgId, actorId)).assurance;
    } catch (error) {
      if (error instanceof BackupAuthorizationError) throw error;
      return backupAssuranceSchema.parse({
        status: "unavailable",
        lastAttempt: null,
        lastCapture: null,
        lastVerification: null,
        lastVerifiedRestoreAt: null,
        recoverablePointAt: null,
        verificationDueAt: null,
        residency: null,
        sourceAt: null,
        observedAt: new Date().toISOString(),
        reasons: ["authority_unavailable"],
      });
    }
  }
  async history(
    orgId: string,
    actorId: string,
    limit: number,
    cursor?: string,
    kind?: "capture" | "verification",
  ) {
    return (await this.read(orgId, actorId, limit, cursor, kind)).history;
  }
}
