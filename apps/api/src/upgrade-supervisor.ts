import { loadUpgradeSupervisorRuntime } from "./upgrades/infrastructure/control/upgrade-supervisor-runtime";
import { composeUpgradeSupervisor } from "./upgrades/infrastructure/control/upgrade-supervisor-runtime-compose";
import { createUpgradeControlServer } from "./upgrades/infrastructure/control/local-upgrade-control";
export async function bootstrapUpgradeSupervisor(
  env: NodeJS.ProcessEnv = process.env,
) {
  const mounted = await loadUpgradeSupervisorRuntime(env);
  if (!mounted) return null;
  const control = await composeUpgradeSupervisor(mounted);
  return createUpgradeControlServer(
    {
      socketPath: mounted.config.socketPath,
      key: mounted.controlKey,
      instanceId: mounted.config.instanceId,
    },
    control,
  );
}
/* istanbul ignore next -- executable runtime guard */
if (require.main === module)
  void bootstrapUpgradeSupervisor().catch(() => {
    process.stderr.write("Upgrade supervisor failed to start\n");
    process.exitCode = 1;
  });
