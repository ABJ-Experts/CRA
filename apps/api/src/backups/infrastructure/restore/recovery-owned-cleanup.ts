import { BackupExecutionError } from "../../application/backup-execution.port";
import { removeOwnedRecoveryObjectVolume } from "./recovery-object-volume";

type DockerRun = (args: readonly string[]) => Promise<string>;

function assertOwnership(
  input: string,
  expected: Readonly<Record<string, string>>,
): void {
  let labels: unknown;
  try {
    labels = JSON.parse(input);
  } catch {
    throw new BackupExecutionError("recovery_cleanup_unsafe");
  }
  if (
    !labels ||
    typeof labels !== "object" ||
    Array.isArray(labels) ||
    Object.entries(expected).some(
      ([key, value]) => (labels as Record<string, unknown>)[key] !== value,
    )
  )
    throw new BackupExecutionError("recovery_cleanup_unsafe");
}

/** Creation may succeed even when its CLI acknowledgement is interrupted. */
export async function removeOwnedRecoveryResources(
  state: {
    readonly name: string;
    readonly network: string;
    readonly ownership: Readonly<Record<string, string>>;
    readonly containerAttempted: boolean;
    readonly networkAttempted: boolean;
    readonly objectVolumeAttempted?: boolean;
  },
  run: DockerRun,
): Promise<void> {
  if (state.containerAttempted) {
    const names = await run([
      "ps",
      "--all",
      "--filter",
      `name=^/${state.name}$`,
      "--format",
      "{{.Names}}",
    ]);
    if (names.split("\n").includes(state.name)) {
      assertOwnership(
        await run([
          "inspect",
          "--format",
          "{{json .Config.Labels}}",
          state.name,
        ]),
        state.ownership,
      );
      await run(["rm", "--force", state.name]);
    }
  }
  if (state.networkAttempted) {
    const names = await run([
      "network",
      "ls",
      "--filter",
      `name=^${state.network}$`,
      "--format",
      "{{.Name}}",
    ]);
    if (names.split("\n").includes(state.network)) {
      assertOwnership(
        await run([
          "network",
          "inspect",
          "--format",
          "{{json .Labels}}",
          state.network,
        ]),
        state.ownership,
      );
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await run(["network", "rm", state.network]);
          break;
        } catch {
          if (attempt === 2)
            throw new BackupExecutionError("recovery_cleanup_failed");
          await new Promise<void>((resolve) => setTimeout(resolve, 250));
        }
      }
    }
  }
  if (state.objectVolumeAttempted)
    await removeOwnedRecoveryObjectVolume(
      `${state.name}-objects`,
      state.ownership,
      run,
    );
}
