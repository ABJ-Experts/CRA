import { NarrowBackupControlClient } from "./backups/infrastructure/backup-control.client";
import { loadOperatorRuntime } from "./operator/operator-runtime";
import { createOperatorApplication } from "./operator/operator-listener";
import { NarrowRegistryClient } from "./operator/operator-registry.client";
import type { INestApplication } from "@nestjs/common";
export async function bootstrapOperator(
  env: NodeJS.ProcessEnv = process.env,
  create: typeof createOperatorApplication = createOperatorApplication,
): Promise<INestApplication | null> {
  const config = await loadOperatorRuntime(env);
  if (!config) return null;
  const app = await create(
    config.listener,
    new NarrowRegistryClient(
      config.databaseUrl,
      config.credential,
      config.projectApiKey,
    ),
    config.backupCredential
      ? new NarrowBackupControlClient(
          config.databaseUrl,
          config.backupCredential,
          config.projectApiKey,
        )
      : undefined,
  );
  app.enableShutdownHooks();
  await app.listen(config.listener.port, config.listener.host);
  return app;
}
/* istanbul ignore next -- executable runtime guard */
if (require.main === module)
  void bootstrapOperator().catch(() => {
    process.stderr.write("Operator listener failed to start\n");
    process.exitCode = 1;
  });
