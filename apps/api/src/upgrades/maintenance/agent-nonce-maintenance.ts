import { Logger } from "@nestjs/common";
import { maintenanceRun } from "./maintenance-gate";
type NonceRepository = Readonly<{ pruneExpiredNonces(): Promise<void> }>;
export async function pruneAgentNonces(
  repository: NonceRepository,
): Promise<void> {
  await maintenanceRun(() => repository.pruneExpiredNonces());
}
export function startAgentNonceMaintenance(
  repository: NonceRepository,
  schedule: typeof setInterval = setInterval,
): NodeJS.Timeout {
  const timer = schedule(() => {
    void pruneAgentNonces(repository).catch(() => {
      new Logger("AgentIngress").warn(
        "Agent nonce maintenance is temporarily unavailable",
      );
    });
  }, 60 * 60_000);
  timer.unref();
  return timer;
}
