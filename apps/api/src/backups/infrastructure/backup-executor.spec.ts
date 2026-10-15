import { createBackupExecutor } from "./backup-executor";
import { NativeBackupCaptureAdapter } from "./capture/native-backup-capture.adapter";
import { IsolatedBackupVerifier } from "./restore/isolated-backup-verifier";
import { createDockerRecoveryDependencies } from "./restore/native-docker-recovery.adapter";
import { createRecoveryApplicationProbes } from "./probes/recovery-application-probes";
jest.mock("./probes/recovery-external-key-probe", () => ({
  createRecoveryExternalKeyProbe: jest.fn().mockReturnValue(undefined),
}));
jest.mock("./capture/native-backup-capture.adapter");
jest.mock("./restore/isolated-backup-verifier");
jest.mock("./restore/native-docker-recovery.adapter", () => ({
  createDockerRecoveryDependencies: jest.fn(),
}));
jest.mock(
  "./probes/recovery-application-probes",
  () => ({ createRecoveryApplicationProbes: jest.fn() }),
  { virtual: true },
);
it("composes inward executor ports with mounted-only pinned profiles and explicit application probes", async () => {
  const capture = jest.fn().mockResolvedValue({});
  const verify = jest.fn().mockResolvedValue({});
  const stop = jest.fn().mockResolvedValue(undefined);
  jest.mocked(NativeBackupCaptureAdapter).mockImplementation(
    () =>
      ({
        capture,
        stop,
        reconcileAbandoned: jest.fn().mockResolvedValue(undefined),
      }) as never,
  );
  jest
    .mocked(IsolatedBackupVerifier)
    .mockImplementation(() => ({ verify }) as never);
  const config = {
    runtime: {},
    targetProfiles: {
      isolated: {
        image: "supabase/postgres:17.6.1.156",
        stagingAlias: "private",
        maxExpandedBytes: 1,
        maxEntries: 1,
        deadlineMs: 1000,
        objectVolumeBacking: {
          encryptedAtRest: true,
          daemonId: "docker-daemon_01:profile",
          maximumBytes: 2147483648,
        },
      },
    },
  } as unknown as Parameters<typeof createBackupExecutor>[0];
  const executor = createBackupExecutor(config);
  await executor.capture({} as never, {} as never);
  await executor.verify({} as never, {} as never);
  await executor.stop?.();
  await executor.reconcile?.({} as never, new AbortController().signal);
  expect(capture).toHaveBeenCalled();
  expect(verify).toHaveBeenCalled();
  expect(stop).toHaveBeenCalled();
  expect(createDockerRecoveryDependencies).toHaveBeenCalledWith(
    config.runtime,
    expect.objectContaining({
      isolated: expect.objectContaining({
        networkInternal: true,
        postgresVersion: "17.6",
        objectVolumeBacking:
          config.targetProfiles.isolated!.objectVolumeBacking,
      }) as unknown,
    }),
    undefined,
    undefined,
  );
  createBackupExecutor({
    ...config,
    applicationProbeRuntime: {
      runtimeRoot: "/repo",
      authImage: "public.ecr.aws/supabase/gotrue:v2.197.0",
      restImage: "public.ecr.aws/supabase/postgrest:v16.3",
      storageImage: "public.ecr.aws/supabase/storage-api:v1.77.0",
      storageTenantPrefix: "stub/stub",
    },
  });
  expect(createRecoveryApplicationProbes).toHaveBeenCalled();
  createBackupExecutor(config, jest.fn(), jest.fn());
});
