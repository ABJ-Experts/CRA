import { upgradeCapabilitiesSchema } from "@repo/contracts/upgrades/schemas";
import type { OperatorIdentity } from "../../operator/domain/operator-grants";
import type {
  UpgradeControlAction,
  UpgradeControlPort,
} from "./upgrade-control.port";
export class UpgradeScopeError extends Error {}
const permissions = {
  "capabilities/read": "upgrades.view",
  "media/list": "upgrades.view",
  "media/stage": "upgrades.stage",
  "run/preflight": "upgrades.stage",
  "run/list": "upgrades.view",
  "run/read": "upgrades.view",
  "run/apply": "upgrades.apply",
  "run/reconcile": "upgrades.apply",
  "run/rollback": "upgrades.rollback",
  "run/result": "upgrades.view",
} as const;
/** Each call receives the freshly mounted ingress identity, never browser authority. */
export class UpgradeUseCases {
  constructor(
    private readonly mountedInstanceId: string,
    private readonly control: UpgradeControlPort,
  ) {}
  execute(
    identity: OperatorIdentity,
    instanceId: string,
    action: UpgradeControlAction,
    input: Readonly<Record<string, unknown>> = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (
      instanceId !== this.mountedInstanceId ||
      !identity.instanceIds.includes(instanceId) ||
      !identity.upgradeScopes?.some(
        (scope) =>
          scope.instanceId === instanceId &&
          scope.actions.includes(permissions[action]),
      )
    )
      throw new UpgradeScopeError("Upgrade scope unavailable");
    const result = this.control.execute(
      instanceId,
      {
        principalId: identity.principalId,
        fingerprint256: identity.fingerprint256,
        grantRevision: identity.revision,
      },
      action,
      input,
      signal,
    );
    if (action !== "capabilities/read") return result;
    return result.then((value) => {
      const capabilities = upgradeCapabilitiesSchema.parse(value);
      if (capabilities.instanceId !== instanceId)
        throw new UpgradeScopeError("Upgrade scope unavailable");
      const granted =
        identity.upgradeScopes?.find((scope) => scope.instanceId === instanceId)
          ?.actions ?? [];
      return {
        ...capabilities,
        actions: capabilities.actions.filter((permission) =>
          granted.includes(permission),
        ),
      };
    });
  }
}
