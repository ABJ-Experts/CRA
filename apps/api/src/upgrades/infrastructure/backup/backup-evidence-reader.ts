import {
  backupPolicySchema,
  backupRunSchema,
} from "@repo/contracts/backups/schemas";
import { z } from "zod";
import { lstat } from "node:fs/promises";
import { NativeBackupProcess } from "../../../backups/infrastructure/capture/native-backup-process";

export interface BackupEvidenceReader {
  assertVerifiedChild(
    captureRunId: string,
    childRunId: string,
    certificateDigest: string,
    signal: AbortSignal,
  ): Promise<void>;
}
const uuid = z.string().uuid();
const result = z.object({ valid: z.literal(true) }).strict();
/** Read-only native connection. Password stays in the executor's private mounted pgpass file. */
export class NativeBackupEvidenceReader implements BackupEvidenceReader {
  constructor(
    private readonly configuration: {
      readonly instanceId: string;
      readonly psqlBinary: string;
      /** Host-mounted connection details; the password is never copied to argv. */
      readonly host: string;
      readonly port: number;
      readonly database: string;
      readonly user: string;
      readonly pgpassFile: string;
    },
    private readonly process = new NativeBackupProcess(),
  ) {}
  async assertVerifiedChild(
    captureRunId: string,
    childRunId: string,
    certificateDigest: string,
    signal: AbortSignal,
  ): Promise<void> {
    const instanceId = uuid.parse(this.configuration.instanceId);
    uuid.parse(captureRunId);
    uuid.parse(childRunId);
    if (
      !/^[a-f0-9]{64}$/.test(certificateDigest) ||
      ![
        this.configuration.host,
        this.configuration.database,
        this.configuration.user,
      ].every((value) => /^[a-zA-Z0-9_.-]{1,100}$/.test(value)) ||
      !Number.isInteger(this.configuration.port) ||
      this.configuration.port < 1 ||
      this.configuration.port > 65535
    )
      throw new Error("upgrade_backup_evidence_invalid");
    const sql = `SELECT json_build_object('valid', EXISTS(SELECT 1 FROM public.backup_runs c JOIN public.backup_runs v ON v.instance_id=c.instance_id AND v.parent_capture_id=c.id WHERE c.instance_id='${instanceId}'::uuid AND c.id='${captureRunId}'::uuid AND v.id='${childRunId}'::uuid AND c.kind='capture' AND c.state='certified' AND c.cleanup_state<>'deleted' AND c.certificate->>'manifestSha256'='${certificateDigest}' AND public.m15_05_certificate_valid(c.certificate,c) AND v.kind='verification' AND v.state='verified' AND v.cleanup_state<>'deleted' AND public.m15_05_verification_valid(v.verification,v.configuration->>'targetProfile')))`;
    const output = await this.query(sql, signal, 4096);
    result.parse(JSON.parse(output));
  }
  async readApprovedEvidence(signal: AbortSignal) {
    const instanceId = uuid.parse(this.configuration.instanceId);
    const sql = `SELECT json_build_object('policy',public.m15_05_policy_json(p),'capture',public.m15_05_run_json(c),'child',public.m15_05_run_json(v)) FROM public.backup_policies p JOIN public.backup_runs c ON c.instance_id=p.instance_id JOIN public.backup_runs v ON v.instance_id=c.instance_id AND v.parent_capture_id=c.id WHERE p.instance_id='${instanceId}'::uuid AND p.is_approved AND c.kind='capture' AND c.state='certified' AND c.cleanup_state='retained' AND public.m15_05_certificate_valid(c.certificate,c) AND v.kind='verification' AND v.state='verified' AND v.cleanup_state='retained' AND public.m15_05_verification_valid(v.verification,v.configuration->>'targetProfile') ORDER BY c.completed_at DESC,c.id DESC,v.completed_at DESC,v.id DESC LIMIT 1`;
    const output = await this.query(sql, signal, 65536);
    return z
      .strictObject({
        policy: backupPolicySchema,
        capture: backupRunSchema,
        child: backupRunSchema,
      })
      .parse(JSON.parse(output));
  }
  private async query(
    statement: string,
    signal: AbortSignal,
    maximumOutput: number,
  ): Promise<string> {
    const file = await lstat(this.configuration.pgpassFile);
    if (!file.isFile() || file.isSymbolicLink() || (file.mode & 0o077) !== 0)
      throw new Error("upgrade_backup_evidence_invalid");
    const connection = `host=${this.configuration.host} port=${this.configuration.port} dbname=${this.configuration.database} user=${this.configuration.user} passfile='${this.configuration.pgpassFile.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
    const output = await this.process.run(
      this.configuration.psqlBinary,
      ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "--dbname", connection],
      AbortSignal.any([signal, AbortSignal.timeout(6000)]),
      `BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; ${statement}; COMMIT;`,
      maximumOutput,
    );
    return output;
  }
}
