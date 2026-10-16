import { z } from "zod";
import { requiredMountedFile } from "../../operator/operator-runtime";
import type { BackupMountedRuntime } from "./capture/backup-mounted-runtime";
const alias = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const path = z.string().startsWith("/").max(4096);
const named = z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/);
const source = z.strictObject({
  databaseContainer: named,
  databaseName: named,
  databaseUser: named,
  network: named,
  host: named,
  port: z.number().int().min(1).max(65535),
  postgresImage: z.string().max(200),
  pgpassFile: path,
  storageContainer: named,
  storageRoot: path,
  storageTenantPrefix: z.string().max(100),
  externalRecoveryKeys: z
    .record(
      alias,
      z.strictObject({
        containerPath: z.literal("/etc/postgresql-custom/pgsodium_root.key"),
      }),
    )
    .optional(),
});
const repository = z.strictObject({
  path,
  generation: z.uuid(),
  residency: alias,
  offHost: z.literal(true),
});
const staging = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("tmpfs"),
    maximumBytes: z.number().int().positive(),
  }),
  z.strictObject({
    kind: z.literal("encrypted"),
    path,
    maximumBytes: z.number().int().positive(),
    attestedMount: z.literal(true),
    mountDevice: z.number().int().nonnegative(),
  }),
]);
export const backupWorkerConfigurationSchema = z.strictObject({
  instanceId: z.uuid(),
  databaseUrl: z.url(),
  projectApiKey: z.string().min(1),
  controlCredentialPath: path,
  controlSourceAlias: alias.optional(),
  operatorAlerts: z
    .strictObject({ repositoryAlias: alias, keyAlias: alias })
    .optional(),
  runtime: z.strictObject({
    sources: z.record(alias, source),
    repositories: z.record(alias, repository),
    staging: z.record(alias, staging),
    keys: z.record(alias, z.strictObject({ path, keyId: alias })),
    gpgBinary: path,
  }),
  applicationProbeRuntime: z
    .strictObject({
      runtimeRoot: path,
      authImage: z.literal("public.ecr.aws/supabase/gotrue:v2.197.0"),
      restImage: z.literal("public.ecr.aws/supabase/postgrest:v16.3"),
      storageImage: z.literal("public.ecr.aws/supabase/storage-api:v1.77.0"),
      storageTenantPrefix: z.literal("stub/stub"),
    })
    .optional(),
  targetProfiles: z.record(
    alias,
    z.strictObject({
      image: z.string().max(200),
      stagingAlias: alias,
      maxExpandedBytes: z.number().int().positive(),
      maxEntries: z.number().int().positive(),
      deadlineMs: z.number().int().min(1).max(14400000),
      objectVolumeBacking: z.strictObject({
        encryptedAtRest: z.literal(true),
        daemonId: z.string().regex(/^[A-Za-z0-9:_-]{1,200}$/),
        maximumBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      }),
      externalRecoveryKeys: z
        .record(
          alias,
          z.strictObject({
            path,
            targetPath: z.literal("/etc/postgresql-custom/pgsodium_root.key"),
          }),
        )
        .default({}),
    }),
  ),
});
export type BackupWorkerConfiguration = z.output<
  typeof backupWorkerConfigurationSchema
>;
export async function loadBackupWorkerRuntime(env: NodeJS.ProcessEnv): Promise<
  | (BackupWorkerConfiguration & {
      credential: string;
      runtime: BackupMountedRuntime;
    })
  | null
> {
  if (env.BACKUP_WORKER_ENABLED !== "true") return null;
  const mounted = await requiredMountedFile(
    env.BACKUP_WORKER_CONFIGURATION_PATH,
    true,
  );
  const configuration = backupWorkerConfigurationSchema.parse(
    JSON.parse(mounted.toString("utf8")) as unknown,
  );
  if (configuration.instanceId !== env.LICENSING_INSTANCE_ID)
    throw new Error("Backup instance binding invalid");
  const credential = (
    await requiredMountedFile(configuration.controlCredentialPath, true)
  )
    .toString("utf8")
    .trim();
  return { ...configuration, credential };
}
