import { backupRunSchema } from "@repo/contracts/backups/schemas";
import { BackupScopeError } from "../domain/backup-errors";
import type {
  BackupControlPort,
  BackupControlAction,
} from "./backup-control.port";
import type { OperatorIdentity } from "../../operator/domain/operator-grants";
import {
  authorizeBackupAction,
  type BackupAction,
} from "../domain/backup-authorization";
/** Mounted identity and fresh ingress grants are checked before every control RPC. */
export class BackupUseCases {
  constructor(
    private readonly instanceId: string,
    private readonly control: BackupControlPort,
  ) {}
  execute(
    identity: OperatorIdentity,
    instanceId: string,
    action: BackupControlAction,
    permission: BackupAction,
    input: Readonly<Record<string, unknown>> = {},
  ): Promise<unknown> {
    if (action === "run/cancel") {
      const actions =
        identity.backupScopes?.find((scope) => scope.instanceId === instanceId)
          ?.actions ?? [];
      if (
        !actions.some(
          (action) => action === "backups.run" || action === "backups.verify",
        )
      )
        throw new BackupScopeError();
      authorizeBackupAction(
        identity,
        this.instanceId,
        instanceId,
        actions.includes("backups.run") ? "backups.run" : "backups.verify",
      );
      return this.cancel(identity, instanceId, input);
    }
    authorizeBackupAction(identity, this.instanceId, instanceId, permission);
    return this.control.execute(
      instanceId,
      identity.principalId,
      action,
      input,
    );
  }
  private async cancel(
    identity: OperatorIdentity,
    instanceId: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const run = backupRunSchema.parse(
      await this.control.execute(instanceId, identity.principalId, "run/read", {
        runId: input.runId,
      }),
    );
    authorizeBackupAction(
      identity,
      this.instanceId,
      instanceId,
      run.kind === "verification" ? "backups.verify" : "backups.run",
    );
    return this.control.execute(
      instanceId,
      identity.principalId,
      "run/cancel",
      input,
    );
  }
}
