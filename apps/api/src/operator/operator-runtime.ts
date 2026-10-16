import { readBoundedFile } from "./operator-read-bounds";
import { resolve } from "node:path";
import { z } from "zod";
import type { OperatorListenerConfig } from "./operator-listener";
import type { CollectorTarget } from "./operator-collector";
import { privateAddress } from "./operator-security";
export async function requiredMountedFile(
  path: string | undefined,
  privateFile = false,
): Promise<Buffer> {
  if (!path) throw new Error("Required operator mount absent");
  return readBoundedFile(path, 1024 * 1024, privateFile);
}
export async function loadOperatorRuntime(env: NodeJS.ProcessEnv): Promise<{
  listener: OperatorListenerConfig;
  databaseUrl: string;
  credential: string;
  projectApiKey: string;
  backupCredential?: string;
} | null> {
  if (env.OPERATOR_ENABLED !== "true") return null;
  const instanceId = z.uuid().parse(env.LICENSING_INSTANCE_ID);
  const host = env.OPERATOR_HOST ?? "127.0.0.1";
  if (!privateAddress(host)) throw new Error("Private operator bind required");
  const port = z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .parse(env.OPERATOR_PORT ?? 3444);
  const [key, cert, ca, credential] = await Promise.all([
    requiredMountedFile(env.OPERATOR_TLS_KEY_PATH, true),
    requiredMountedFile(env.OPERATOR_TLS_CERT_PATH),
    requiredMountedFile(env.OPERATOR_CA_CERT_PATH),
    requiredMountedFile(env.OPERATOR_DB_CREDENTIAL_PATH, true),
  ]);
  if (!env.OPERATOR_GRANTS_PATH || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY)
    throw new Error("Operator grants and database mounts required");
  return {
    listener: {
      instanceId,
      host,
      port,
      key,
      cert,
      ca,
      grantsPath: env.OPERATOR_GRANTS_PATH,
      staticRoot: resolve(env.OPERATOR_STATIC_ROOT ?? "../operator/out"),
    },
    databaseUrl: env.SUPABASE_URL,
    projectApiKey: env.SUPABASE_ANON_KEY,
    credential: credential.toString("utf8").trim(),
    ...(env.BACKUP_CONTROL_CREDENTIAL_PATH
      ? {
          backupCredential: (
            await requiredMountedFile(env.BACKUP_CONTROL_CREDENTIAL_PATH, true)
          )
            .toString("utf8")
            .trim(),
        }
      : {}),
  };
}
const targetSchema = z.strictObject({
  instanceId: z.uuid(),
  endpoint: z.url(),
  caPath: z.string().min(1),
  certPath: z.string().min(1),
  keyPath: z.string().min(1),
  cadenceSeconds: z.number().int().min(60).max(86400).default(60),
});
export async function loadWorkerRuntime(env: NodeJS.ProcessEnv): Promise<{
  instanceId: string;
  observeLocal: boolean;
  databaseUrl: string;
  credential: string;
  targets: CollectorTarget[];
} | null> {
  if (
    env.OPERATOR_OBSERVER_ENABLED !== "true" &&
    env.OPERATOR_COLLECTOR_ENABLED !== "true"
  )
    return null;
  const instanceId = z.uuid().parse(env.LICENSING_INSTANCE_ID);
  if (!env.SUPABASE_URL) throw new Error("Worker database endpoint required");
  const credential = (
    await requiredMountedFile(env.OPERATOR_WORKER_CREDENTIAL_PATH, true)
  )
    .toString("utf8")
    .trim();
  let targets: CollectorTarget[] = [];
  if (env.OPERATOR_COLLECTOR_ENABLED === "true") {
    const configs = z
      .array(targetSchema)
      .max(500)
      .refine(
        (items) =>
          new Set(items.map((item) => item.instanceId)).size === items.length,
      )
      .parse(
        JSON.parse(
          (
            await requiredMountedFile(env.OPERATOR_COLLECTOR_TARGETS_PATH)
          ).toString("utf8"),
        ),
      );
    targets = await Promise.all(
      configs.map(async (target) => ({
        instanceId: target.instanceId,
        endpoint: target.endpoint,
        cadenceSeconds: target.cadenceSeconds,
        ca: await requiredMountedFile(target.caPath),
        cert: await requiredMountedFile(target.certPath),
        key: await requiredMountedFile(target.keyPath, true),
      })),
    );
  }
  return {
    instanceId,
    observeLocal: env.OPERATOR_OBSERVER_ENABLED === "true",
    databaseUrl: env.SUPABASE_URL,
    credential,
    targets,
  };
}
