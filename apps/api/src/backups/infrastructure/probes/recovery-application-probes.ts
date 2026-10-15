import {
  generateKeyPairSync,
  sign,
  type KeyObject,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { lstat, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import {
  emitRecoveryProbeDiagnostic,
  classifyRecoveryStorageFailure,
  recoveryProbeDiagnosticSchema,
  recoveryProbeDiagnosticCodeSchema,
  recoveryProbeProgressSchema,
  traceRecoveryProbe,
  type RecoveryProbeObserver,
} from "./recovery-probe-diagnostics";
import { BackupExecutionError } from "../../application/backup-execution.port";
import { RecoveryCheckFailure } from "../restore/isolated-backup-verifier";
import type { RecoveryApplicationProbes } from "../restore/native-docker-recovery.adapter";

const configurationSchema = z
  .object({
    runtimeRoot: z.string().refine(isAbsolute),
    authImage: z.literal("public.ecr.aws/supabase/gotrue:v2.197.0"),
    restImage: z.literal("public.ecr.aws/supabase/postgrest:v16.3"),
    storageImage: z.literal("public.ecr.aws/supabase/storage-api:v1.77.0"),
    storageTenantPrefix: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9_-]{1,100}$/),
  })
  .strict();
export type RecoveryApplicationProbeConfiguration = z.output<
  typeof configurationSchema
>;
const uuid = z.string().uuid();
const fixtureSchema = z
  .object({
    organizationId: uuid,
    otherOrganizationId: uuid,
    productId: uuid,
    otherProductId: uuid,
    documentId: uuid,
    versionId: uuid,
  })
  .strict();
const checks = [
  "authentication",
  "tenant_isolation",
  "product_isolation",
  "private_evidence_access",
] as const;
const fixtureSql = `select json_build_object('organizationId',v.organization_id,'otherOrganizationId',o.id,'productId',vp.product_id,'otherProductId',p.id,'documentId',v.document_id,'versionId',v.id)::text
from public.evidence_document_versions v join public.evidence_document_version_products vp on vp.organization_id=v.organization_id and vp.version_id=v.id
join public.organizations o on o.id<>v.organization_id and o.is_active
join public.products p on p.organization_id=v.organization_id and p.id<>vp.product_id and p.archived_at is null
where v.processing_state='clean' and v.object_bucket='evidence-documents' and v.actual_size_bytes between 1 and 52428800
and (v.validity_ends_on is null or v.validity_ends_on>=current_date) and not exists(select 1 from public.evidence_document_version_products x where x.organization_id=v.organization_id and x.version_id=v.id and x.product_id=p.id)
order by v.id,o.id,p.id limit 1`;

/** Mounted configuration only. All generated credentials and memberships belong to the disposable target. */
export function createRecoveryApplicationProbes(
  configuration: RecoveryApplicationProbeConfiguration,
  observer: RecoveryProbeObserver = traceRecoveryProbe,
): RecoveryApplicationProbes {
  const parsed = configurationSchema.safeParse(configuration);
  if (!parsed.success)
    throw new BackupExecutionError("recovery_probe_configuration");
  const config = parsed.data;
  return async (target, signal) => {
    const targetPattern = /^cra-backup-restore-[0-9a-f-]{36}$/;
    if (
      !targetPattern.test(target.databaseContainer) ||
      target.objectVolume !== `${target.databaseContainer}-objects` ||
      target.network !== `${target.databaseContainer}-network` ||
      (await target.run(
        ["network", "inspect", "--format", "{{.Internal}}", target.network],
        signal,
      )) !== "true"
    )
      throw new BackupExecutionError("recovery_probe_isolation");
    const runtimeMounts = await validateRuntime(config.runtimeRoot);
    const fixture = fixtureSchema.safeParse(
      JSON.parse((await target.sql(fixtureSql, signal)) || "null"),
    );
    if (
      !fixture.success ||
      fixture.data.organizationId === fixture.data.otherOrganizationId ||
      fixture.data.productId === fixture.data.otherProductId
    )
      throw new BackupExecutionError("recovery_probe_fixture");
    const owner = `cra-backup-probe-${randomUUID()}`;
    const directory = join(target.directory, owner);
    const names = {
      auth: `${owner}-auth`,
      rest: `${owner}-rest`,
      storage: `${owner}-storage`,
      runtimeCreate: `${owner}-runtime-create`,
      runtimeVerify: `${owner}-runtime-verify`,
    };
    const ownership = { ...target.ownership, "cra.backup.probe": owner };
    const labels = [
      ["cra.backup.probe", owner],
      ...Object.entries(target.ownership).filter(
        ([key]) => key !== "cra.backup.probe",
      ),
    ].flatMap(([key, value]) => ["--label", `${key}=${value}`]);
    await mkdir(directory, { mode: 0o700 });
    try {
      const secret = randomBytes(48).toString("base64url");
      const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const privateKey = {
        ...key.privateKey.export({ format: "jwk" }),
        kid: randomUUID(),
        use: "sig",
        alg: "ES256",
        key_ops: ["sign", "verify"],
      };
      const publicKey = {
        ...key.publicKey.export({ format: "jwk" }),
        kid: privateKey.kid,
        use: "sig",
        alg: "ES256",
        key_ops: ["verify"],
      };
      const jwks = JSON.stringify({ keys: [publicKey] });
      const serviceKey = serviceToken(key.privateKey, privateKey.kid);
      const passwords = {
        auth: randomBytes(32).toString("hex"),
        rest: randomBytes(32).toString("hex"),
        storage: randomBytes(32).toString("hex"),
      };
      await target.sql(
        `begin; alter role supabase_auth_admin login password '${passwords.auth}'; alter role authenticator login password '${passwords.rest}'; alter role supabase_storage_admin login password '${passwords.storage}'; commit;`,
        signal,
      );
      const connection = (role: string, password: string) =>
        `postgresql://${role}:${password}@${target.databaseContainer}:5432/${target.databaseName}?sslmode=disable`;
      const envs = {
        auth: {
          GOTRUE_API_HOST: "0.0.0.0",
          GOTRUE_API_PORT: "9999",
          API_EXTERNAL_URL: `http://${names.auth}:9999`,
          GOTRUE_SITE_URL: "http://recovery.invalid",
          GOTRUE_DB_DRIVER: "postgres",
          GOTRUE_DB_DATABASE_URL: connection(
            "supabase_auth_admin",
            passwords.auth,
          ),
          GOTRUE_JWT_SECRET: secret,
          GOTRUE_JWT_KEYS: JSON.stringify([privateKey]),
          GOTRUE_JWT_AUD: "authenticated",
          GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated",
          GOTRUE_JWT_ADMIN_ROLES: "service_role",
          GOTRUE_DISABLE_SIGNUP: "true",
          GOTRUE_EXTERNAL_EMAIL_ENABLED: "true",
          GOTRUE_MAILER_AUTOCONFIRM: "true",
          GOTRUE_LOG_LEVEL: "error",
          GOTRUE_SMTP_HOST: "notifications-disabled.invalid",
          GOTRUE_SMTP_PORT: "1",
        },
        rest: {
          PGRST_DB_URI: connection("authenticator", passwords.rest),
          PGRST_DB_SCHEMAS: "public",
          PGRST_DB_ANON_ROLE: "anon",
          PGRST_JWT_SECRET: jwks,
          PGRST_LOG_LEVEL: "crit",
          PGRST_DB_MAX_ROWS: "100",
        },
        storage: {
          DATABASE_URL: connection("supabase_storage_admin", passwords.storage),
          AUTH_JWT_SECRET: secret,
          JWT_JWKS: jwks,
          ANON_KEY: serviceToken(key.privateKey, privateKey.kid, "anon"),
          SERVICE_KEY: serviceKey,
          STORAGE_BACKEND: "file",
          FILE_STORAGE_BACKEND_PATH: "/mnt",
          TENANT_ID: config.storageTenantPrefix.split("/")[0]!,
          GLOBAL_S3_BUCKET: config.storageTenantPrefix.split("/")[1]!,
          FILE_SIZE_LIMIT: "52428800",
          DB_MIGRATIONS_FREEZE_AT: "drop-bucketid-objname-index",
          ENABLE_IMAGE_TRANSFORMATION: "false",
          S3_PROTOCOL_ENABLED: "false",
          VECTOR_BUCKETS_ENABLED: "false",
          LOG_LEVEL: "error",
        },
      };
      const images = {
        auth: config.authImage,
        rest: config.restImage,
        storage: config.storageImage,
      };
      for (const kind of ["auth", "rest", "storage"] as const) {
        const envFile = join(directory, `${kind}.env`);
        await writeFile(
          envFile,
          Object.entries(envs[kind])
            .map(([name, value]) => `${name}=${value}`)
            .join("\n") + "\n",
          { mode: 0o600, flag: "wx" },
        );
        await target.run(
          [
            "run",
            "--pull=never",
            "--detach",
            "--name",
            names[kind],
            ...labels,
            "--network",
            target.network,
            "--dns",
            "127.0.0.1",
            "--dns-search",
            ".",
            "--security-opt",
            "no-new-privileges",
            "--cap-drop",
            "ALL",
            "--env-file",
            envFile,
            ...(kind === "storage"
              ? [
                  "--mount",
                  `type=volume,src=${target.objectVolume},dst=/mnt,readonly`,
                ]
              : []),
            images[kind],
          ],
          signal,
        );
      }
      const runtimeConfig = {
        fixture: fixture.data,
        serviceKey,
        endpoints: {
          auth: `http://${names.auth}:9999`,
          rest: `http://${names.rest}:3000`,
          storage: `http://${names.storage}:5000`,
        },
        identities: [0, 1].map(() => ({
          email: `${randomUUID()}@recovery.invalid`,
          password: randomBytes(32).toString("base64url"),
        })),
      };
      const configPath = join(directory, "probe.json");
      await writeFile(configPath, JSON.stringify(runtimeConfig), {
        mode: 0o600,
        flag: "wx",
      });
      const invoke = async (phase: "create" | "verify") => {
        emitRecoveryProbeDiagnostic(observer, {
          stage: "runtime",
          code: phase === "create" ? "create_started" : "verify_started",
        });
        const finish = new AbortController();
        const phaseSignal = AbortSignal.any([
          signal,
          AbortSignal.timeout(30000),
          finish.signal,
        ]);
        const execution = target.run(
          [
            "run",
            "--pull=never",
            "--rm",
            "--init",
            "--name",
            phase === "create" ? names.runtimeCreate : names.runtimeVerify,
            ...labels,
            "--network",
            target.network,
            "--dns",
            "127.0.0.1",
            "--dns-search",
            ".",
            "--read-only",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            ...runtimeMounts.flatMap((mount) => ["--mount", mount]),
            "--mount",
            `type=bind,src=${configPath},dst=/probe.json,readonly`,
            "--entrypoint",
            "node",
            config.storageImage,
            "-e",
            "const diagnostics=[];const helpers=require('/runtime/apps/api/dist/backups/infrastructure/probes/recovery-probe-diagnostics.js');const finish=v=>process.stdout.write(JSON.stringify(v),()=>process.exit(0));require('/runtime/apps/api/dist/backups/infrastructure/probes/recovery-probe-runtime.js').runRecoveryProbe(process.argv[1], '/probe.json',event=>{if(diagnostics.length<64)diagnostics.push(event)}).then(result=>finish({ok:true,result,diagnostics})).catch(error=>finish({ok:false,code:helpers.recoveryProbeFailureCode(error),progress:helpers.recoveryProbeFailureProgress(error),diagnostics}))",
            phase,
          ],
          phaseSignal,
        );
        const monitor = (async () => {
          while (!phaseSignal.aborted) {
            const running = await target.run(
              [
                "inspect",
                "--format",
                "{{.State.Running}}",
                names.auth,
                names.rest,
                names.storage,
              ],
              phaseSignal,
            );
            running.split("\n").forEach((value, index) =>
              emitRecoveryProbeDiagnostic(observer, {
                stage: "service",
                service: (["auth", "rest", "storage"] as const)[index],
                running: value === "true",
              }),
            );
            if (
              running.split("\n").filter((value) => value === "true").length !==
              3
            )
              throw new BackupExecutionError(
                "recovery_probe_service_unavailable",
              );
            await delayProbe(250, phaseSignal);
          }
          throw new BackupExecutionError("recovery_probe_service_unavailable");
        })();
        try {
          const output = await Promise.race([execution, monitor]);
          const envelope = z
            .object({
              ok: z.boolean(),
              result: z.unknown().optional(),
              code: recoveryProbeDiagnosticCodeSchema.optional(),
              diagnostics: z.array(recoveryProbeDiagnosticSchema).max(64),
              progress: recoveryProbeProgressSchema.optional(),
            })
            .strict()
            .parse(JSON.parse(output));
          envelope.diagnostics.forEach((event) =>
            emitRecoveryProbeDiagnostic(observer, event),
          );
          if (!envelope.ok) {
            emitRecoveryProbeDiagnostic(observer, {
              stage: "runtime",
              code: envelope.code ?? "unexpected_failure",
            });
            if (envelope.progress)
              throw new RecoveryCheckFailure(
                envelope.progress.failedCheck,
                envelope.progress.completedChecks,
              );
            throw new BackupExecutionError("recovery_application_probe_failed");
          }
          return JSON.stringify(envelope.result);
        } finally {
          finish.abort();
          await Promise.allSettled([execution, monitor]);
        }
      };
      const initialized = z
        .object({ authUserIds: z.tuple([uuid, uuid]) })
        .strict()
        .parse(JSON.parse(await invoke("create")));
      const ids = initialized.authUserIds.map((id) => `'${id}'`).join(",");
      const profiles = z
        .tuple([uuid, uuid])
        .parse(
          JSON.parse(
            await target.sql(
              `select json_agg(id order by array_position(array[${ids}]::uuid[],auth_user_id))::text from public.users where auth_user_id=any(array[${ids}]::uuid[])`,
              signal,
            ),
          ),
        );
      // Only fresh target probe memberships bypass restored licence-growth admission.
      // Historical integrity was checked before this callback; all subsequent HTTP,
      // RLS and M8 authorization execute normally with triggers enabled.
      await target.sql(
        `begin; set local session_replication_role=replica; insert into public.organization_members(organization_id,user_id,role) values('${fixture.data.organizationId}','${profiles[0]}','owner'),('${fixture.data.otherOrganizationId}','${profiles[1]}','member'); commit;`,
        signal,
      );
      await writeFile(
        configPath,
        JSON.stringify({ ...runtimeConfig, profileIds: profiles }),
        { mode: 0o600 },
      );
      const result = z
        .object({
          checks: z.tuple([
            z.literal(checks[0]),
            z.literal(checks[1]),
            z.literal(checks[2]),
            z.literal(checks[3]),
          ]),
        })
        .strict()
        .parse(JSON.parse(await invoke("verify")));
      return result.checks;
    } catch (error) {
      try {
        const diagnostics = await target.cleanupRun(
          ["logs", "--tail", "20", names.storage],
          AbortSignal.timeout(5000),
        );
        emitRecoveryProbeDiagnostic(observer, {
          stage: "service",
          service: "storage",
          code: classifyRecoveryStorageFailure(diagnostics),
        });
      } catch {
        // Unavailable provider diagnostics never alter the recovery verdict.
      }
      if (error instanceof RecoveryCheckFailure) throw error;
      throw new BackupExecutionError("recovery_application_probe_failed");
    } finally {
      const cleanupSignal = AbortSignal.timeout(30000);
      const owned = (
        await target.cleanupRun(
          [
            "ps",
            "--all",
            "--filter",
            `label=cra.backup.probe=${owner}`,
            "--format",
            "{{.Names}}",
          ],
          cleanupSignal,
        )
      )
        .split("\n")
        .filter(Boolean);
      for (const name of owned.reverse()) {
        assertProbeOwnership(
          Object.values(names).includes(name) ? owner : "unexpected",
          owner,
        );
        const label = await target.cleanupRun(
          ["inspect", "--format", "{{json .Config.Labels}}", name],
          cleanupSignal,
        );
        assertProbeLabels(label, ownership);
        await target.cleanupRun(["rm", "--force", name], cleanupSignal);
      }
      await rm(directory, { recursive: true, force: true });
    }
  };
}
async function validateRuntime(root: string) {
  const stat = await lstat(root);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (await realpath(root)) !== resolve(root)
  )
    throw new BackupExecutionError("recovery_probe_configuration");
  const allowed = [
    "apps/api/dist",
    "apps/api/node_modules",
    "node_modules",
    "packages/contracts/dist",
    "packages/contracts/node_modules",
    "packages/contracts/package.json",
  ];
  for (const relative of allowed) {
    const path = join(root, relative);
    const info = await lstat(path);
    if (
      info.isSymbolicLink() ||
      (await realpath(path)) !== resolve(path) ||
      (relative.endsWith(".json") ? !info.isFile() : !info.isDirectory())
    )
      throw new BackupExecutionError("recovery_probe_configuration");
  }
  const runtime = await lstat(
    join(
      root,
      "apps/api/dist/backups/infrastructure/probes/recovery-probe-runtime.js",
    ),
  );
  if (!runtime.isFile() || runtime.isSymbolicLink())
    throw new BackupExecutionError("recovery_probe_configuration");
  return allowed.map(
    (relative) =>
      `type=bind,src=${join(root, relative)},dst=/runtime/${relative},readonly`,
  );
}
function serviceToken(key: KeyObject, kid: string, role = "service_role") {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const issuedAt = Math.floor(Date.now() / 1000);
  const input = `${encode({ alg: "ES256", typ: "JWT", kid })}.${encode({ role, aud: "authenticated", iss: "supabase", iat: issuedAt, exp: issuedAt + 600 })}`;
  return `${input}.${sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

function assertProbeOwnership(label: string, owner: string) {
  if (label !== owner)
    throw new BackupExecutionError("recovery_cleanup_unsafe");
}

function assertProbeLabels(
  raw: string,
  expected: Readonly<Record<string, string>>,
) {
  let labels: unknown;
  try {
    labels = JSON.parse(raw);
  } catch {
    throw new BackupExecutionError("recovery_cleanup_unsafe");
  }
  const parsed = z.record(z.string(), z.string()).safeParse(labels);
  if (
    !parsed.success ||
    Object.entries(expected).some(([key, value]) => parsed.data[key] !== value)
  )
    throw new BackupExecutionError("recovery_cleanup_unsafe");
}
function delayProbe(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("cancelled"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("cancelled"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}
