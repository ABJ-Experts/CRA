import type {
  UpgradeActor,
  UpgradeControlAction,
} from "@repo/contracts/upgrades/types";
export type {
  UpgradeActor,
  UpgradeControlAction,
} from "@repo/contracts/upgrades/types";
export interface UpgradeControlPort {
  execute(
    instanceId: string,
    actor: UpgradeActor,
    action: UpgradeControlAction,
    input?: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<unknown>;
}
