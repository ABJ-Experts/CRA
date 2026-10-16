import { z } from "zod";
import {
  LocalUpgradeControlClient,
  readUpgradeControlKey,
} from "./local-upgrade-control";

/** Optional operator wiring; partial configuration is never silently accepted. */
export async function loadUpgradeControlRuntime(env: NodeJS.ProcessEnv) {
  if (!env.UPGRADE_CONTROL_SOCKET_PATH && !env.UPGRADE_CONTROL_KEY_PATH)
    return undefined;
  const socketPath = z
    .string()
    .startsWith("/")
    .max(100)
    .parse(env.UPGRADE_CONTROL_SOCKET_PATH);
  const keyPath = z
    .string()
    .startsWith("/")
    .parse(env.UPGRADE_CONTROL_KEY_PATH);
  const instanceId = z.uuid().parse(env.LICENSING_INSTANCE_ID);
  return new LocalUpgradeControlClient({
    socketPath,
    instanceId,
    key: await readUpgradeControlKey(keyPath),
  });
}
