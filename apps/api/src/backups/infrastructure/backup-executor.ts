import { createRecoveryExternalKeyProbe } from "./probes/recovery-external-key-probe";
import { createRecoveryApplicationProbes } from "./probes/recovery-application-probes";
import type { BackupExecutionPort } from "../application/backup-execution.port";
import type { BackupWorkerConfiguration } from "./backup-worker-runtime";
import { NativeBackupCaptureAdapter } from "./capture/native-backup-capture.adapter";
import { IsolatedBackupVerifier } from "./restore/isolated-backup-verifier";
import {
  createDockerRecoveryDependencies,
  type RecoveryApplicationProbes,
  type RecoveryExternalKeyProbe,
} from "./restore/native-docker-recovery.adapter";
export function createBackupExecutor(
  configuration: BackupWorkerConfiguration,
  probes?: RecoveryApplicationProbes,
  externalKeyProbe?: RecoveryExternalKeyProbe,
): BackupExecutionPort {
  const capture = new NativeBackupCaptureAdapter(configuration.runtime);
  const profiles = Object.fromEntries(
    Object.entries(configuration.targetProfiles).map(([alias, profile]) => [
      alias,
      {
        ...profile,
        postgresVersion: "17.6",
        networkInternal: true,
        storageTenantPrefix: "stub/stub",
      },
    ]),
  );
  const verifier = new IsolatedBackupVerifier(
    createDockerRecoveryDependencies(
      configuration.runtime,
      profiles,
      probes ??
        (configuration.applicationProbeRuntime
          ? createRecoveryApplicationProbes(
              configuration.applicationProbeRuntime,
            )
          : undefined),
      externalKeyProbe ??
        createRecoveryExternalKeyProbe([
          ...new Set(
            Object.values(configuration.targetProfiles).flatMap((profile) =>
              Object.keys(profile.externalRecoveryKeys ?? {}),
            ),
          ),
        ]),
    ),
  );
  return {
    stop: () => capture.stop(),
    reconcile: (request, signal) => capture.reconcileAbandoned(request, signal),
    capture: (request, context) => capture.capture(request, context),
    verify: (request, context) => verifier.verify(request, context),
  };
}
