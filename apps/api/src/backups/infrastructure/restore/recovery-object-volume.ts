import { writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { BackupInventory } from "../../application/backup-execution.port";
import { BackupExecutionError } from "../../application/backup-execution.port";
import { storageObjectPath } from "../capture/native-backup-capture.adapter";

export interface RecoveryObjectVolumeBacking {
  readonly encryptedAtRest: true;
  readonly daemonId: string;
  readonly maximumBytes: number;
}
type Run = (args: readonly string[]) => Promise<string>;
const image = "public.ecr.aws/supabase/storage-api:v1.77.0";

/** Closed, streamed file operations execute only in an owned Linux volume with networking disabled. */
export const RECOVERY_OBJECT_VOLUME_SCRIPT = String.raw`
const fs=require('node:fs'),p=require('node:path'),crypto=require('node:crypto');
(async()=>{
 const [source,target,manifest,mode,limitText,entriesText]=process.argv.slice(1);
 const limit=Number(limitText),maxEntries=Number(entriesText);
 if(!['copy','verify'].includes(mode)||!Number.isSafeInteger(limit)||limit<=0||!Number.isSafeInteger(maxEntries)||maxEntries<=0)throw Error();
 if(fs.statSync(manifest).size>8*1024*1024)throw Error();
 const entries=JSON.parse(fs.readFileSync(manifest,'utf8'));
 if(!Array.isArray(entries)||entries.length>maxEntries)throw Error();
 const expected=new Set();let total=0;
 for(const entry of entries){
  if(!entry||Object.keys(entry).sort().join(',')!=='bytes,path,sha256'||typeof entry.path!=='string'||entry.path.length>16384||entry.path.startsWith('/')||entry.path.includes('\\')||/[\x00-\x1f\x7f]/.test(entry.path)||entry.path.split('/').some(x=>!x||x==='.'||x==='..')||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||typeof entry.sha256!=='string'||!/^[a-f0-9]{64}$/.test(entry.sha256)||expected.has(entry.path))throw Error();
  expected.add(entry.path);total+=entry.bytes;if(!Number.isSafeInteger(total)||total>limit)throw Error();
 }
 if(mode==='copy'){
  if(fs.readdirSync(target).length!==0)throw Error();
  const capacity=fs.statfsSync(target);if(capacity.bavail*capacity.bsize<total+16*1024*1024)throw Error();
 }
 for(const entry of entries){
  const destination=p.join(target,entry.path);
  if(mode==='copy'){
   const input=p.join(source,entry.path);const info=fs.lstatSync(input);
   if(!info.isFile()||info.isSymbolicLink()||info.size!==entry.bytes)throw Error();
   fs.mkdirSync(p.dirname(destination),{recursive:true,mode:0o700});
   await fs.promises.copyFile(input,destination,fs.constants.COPYFILE_EXCL);fs.chmodSync(destination,0o600);
  }
  const info=fs.lstatSync(destination);if(!info.isFile()||info.isSymbolicLink()||info.size!==entry.bytes)throw Error();
  const hash=crypto.createHash('sha256');let bytes=0;
  for await(const chunk of fs.createReadStream(destination,{flags:fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW,highWaterMark:65536})){hash.update(chunk);bytes+=chunk.length;}
  if(bytes!==entry.bytes||hash.digest('hex')!==entry.sha256)throw Error();
  if(mode==='copy'){const file=await fs.promises.open(destination,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{await file.sync();}finally{await file.close();}}
 }
 let observed=0;const pending=[''];let nodes=0;
 while(pending.length){const parent=pending.pop();for(const name of fs.readdirSync(p.join(target,parent))){if(++nodes>maxEntries*32+100)throw Error();const key=parent?parent+'/'+name:name;const info=fs.lstatSync(p.join(target,key));if(info.isSymbolicLink())throw Error();if(info.isDirectory())pending.push(key);else if(info.isFile()&&expected.has(key))observed++;else throw Error();}}
 if(observed!==entries.length)throw Error();
 process.stdout.write(JSON.stringify({ok:true,count:observed,bytes:total}));
})().catch(()=>{process.stderr.write('recovery_object_integrity');process.exitCode=1;});
`;

export async function assertOwnedRecoveryObjectVolume(
  name: string,
  ownership: Readonly<Record<string, string>>,
  run: Run,
): Promise<void> {
  const value = JSON.parse(
    await run(["volume", "inspect", "--format", "{{json .}}", name]),
  ) as Record<string, unknown>;
  const labels = value.Labels;
  if (
    value.Name !== name ||
    value.Driver !== "local" ||
    value.Scope !== "local" ||
    (value.Options !== null &&
      (typeof value.Options !== "object" ||
        Object.keys(value.Options ?? {}).length !== 0)) ||
    !labels ||
    typeof labels !== "object" ||
    Array.isArray(labels) ||
    Object.entries(ownership).some(
      ([key, expected]) =>
        (labels as Record<string, unknown>)[key] !== expected,
    )
  )
    throw new BackupExecutionError("recovery_cleanup_unsafe");
}

export async function prepareRecoveryObjectVolume(
  options: {
    readonly name: string;
    readonly ownership: Readonly<Record<string, string>>;
    readonly backing: RecoveryObjectVolumeBacking | undefined;
    readonly inventory: BackupInventory["objects"];
    readonly directory: string;
    readonly objectDirectory: string;
    readonly prefix: string;
    readonly maximumEntries: number;
    readonly onAttempt: () => void;
  },
  run: Run,
): Promise<void> {
  const backing = options.backing;
  const bytes = options.inventory.reduce(
    (total, object) => total + object.bytes,
    0,
  );
  if (
    !backing ||
    backing.encryptedAtRest !== true ||
    !/^[A-Za-z0-9:_-]{1,200}$/.test(backing.daemonId) ||
    !Number.isSafeInteger(backing.maximumBytes) ||
    backing.maximumBytes <= 0 ||
    !Number.isSafeInteger(bytes) ||
    bytes > backing.maximumBytes ||
    options.inventory.length > options.maximumEntries
  )
    throw new BackupExecutionError("unsafe_plaintext_staging");
  if (
    (await run(["info", "--format", "{{.ID}}"])) !== backing.daemonId ||
    (await run(["info", "--format", "{{.OSType}}"])) !== "linux"
  )
    throw new BackupExecutionError("unsafe_plaintext_staging");
  const existing = await run([
    "volume",
    "ls",
    "--filter",
    `name=^${options.name}$`,
    "--format",
    "{{.Name}}",
  ]);
  if (existing.split("\n").includes(options.name))
    throw new BackupExecutionError("recovery_target_unsafe");
  const manifest = options.inventory.map((object) => ({
    path: relative(
      options.objectDirectory,
      storageObjectPath(
        options.objectDirectory,
        options.prefix,
        object.bucketId,
        object.name,
        object.version,
      ),
    ),
    bytes: object.bytes,
    sha256: object.sha256,
  }));
  const encoded = JSON.stringify(manifest);
  if (Buffer.byteLength(encoded) > 8 * 1024 * 1024)
    throw new BackupExecutionError("insufficient_capacity");
  await writeFile(
    join(options.directory, "object-volume-manifest.json"),
    encoded,
    { flag: "wx", mode: 0o600 },
  );
  options.onAttempt();
  await run([
    "volume",
    "create",
    "--driver",
    "local",
    ...Object.entries(options.ownership).flatMap(([key, value]) => [
      "--label",
      `${key}=${value}`,
    ]),
    options.name,
  ]);
  await assertOwnedRecoveryObjectVolume(options.name, options.ownership, run);
  await checkRecoveryObjectVolume(
    {
      ...options,
      maximumBytes: backing.maximumBytes,
      expectedCount: options.inventory.length,
      expectedBytes: bytes,
    },
    "copy",
    run,
  );
}

export async function checkRecoveryObjectVolume(
  options: {
    readonly name: string;
    readonly directory: string;
    readonly objectDirectory: string;
    readonly ownership: Readonly<Record<string, string>>;
    readonly maximumBytes: number;
    readonly maximumEntries: number;
    readonly expectedCount: number;
    readonly expectedBytes: number;
  },
  mode: "copy" | "verify",
  run: Run,
): Promise<void> {
  await assertOwnedRecoveryObjectVolume(options.name, options.ownership, run);
  const output = await run([
    "run",
    "--pull=never",
    "--rm",
    "--name",
    `${options.name}-check`,
    ...Object.entries(options.ownership).flatMap(([key, value]) => [
      "--label",
      `${key}=${value}`,
    ]),
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--cap-add",
    "DAC_OVERRIDE",
    "--security-opt",
    "no-new-privileges",
    "--memory",
    "128m",
    "--memory-swap",
    "128m",
    "--mount",
    `type=volume,src=${options.name},dst=/objects${mode === "verify" ? ",readonly" : ""}`,
    "--mount",
    `type=bind,src=${options.objectDirectory},dst=/source,readonly`,
    "--mount",
    `type=bind,src=${join(options.directory, "object-volume-manifest.json")},dst=/manifest.json,readonly`,
    "--entrypoint",
    "node",
    image,
    "-e",
    RECOVERY_OBJECT_VOLUME_SCRIPT,
    "/source",
    "/objects",
    "/manifest.json",
    mode,
    String(options.maximumBytes),
    String(options.maximumEntries),
  ]);
  const result = JSON.parse(output) as Record<string, unknown>;
  if (
    result.ok !== true ||
    result.count !== options.expectedCount ||
    result.bytes !== options.expectedBytes
  )
    throw new BackupExecutionError("object_integrity");
}

export async function removeOwnedRecoveryObjectVolume(
  name: string,
  ownership: Readonly<Record<string, string>>,
  run: Run,
): Promise<void> {
  if (!/^cra-backup-restore-[a-f0-9-]{36}-objects$/.test(name))
    throw new BackupExecutionError("recovery_cleanup_unsafe");
  const helper = `${name}-check`;
  const containers = await run([
    "ps",
    "--all",
    "--filter",
    `name=^/${helper}$`,
    "--format",
    "{{.Names}}",
  ]);
  if (containers.split("\n").includes(helper)) {
    const labels = JSON.parse(
      await run(["inspect", "--format", "{{json .Config.Labels}}", helper]),
    ) as Record<string, unknown>;
    if (
      !labels ||
      Object.entries(ownership).some(([key, value]) => labels[key] !== value)
    )
      throw new BackupExecutionError("recovery_cleanup_unsafe");
    await run(["rm", "--force", helper]);
  }
  const volumes = await run([
    "volume",
    "ls",
    "--filter",
    `name=^${name}$`,
    "--format",
    "{{.Name}}",
  ]);
  if (volumes.split("\n").includes(name)) {
    await assertOwnedRecoveryObjectVolume(name, ownership, run);
    await run(["volume", "rm", name]);
  }
}
