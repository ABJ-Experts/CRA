import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { readBoundedJson } from "../../../operator/operator-read-bounds";
import type {
  JournalRecord,
  UpgradeHostJournal,
} from "../journal/upgrade-host-journal";
import {
  UpgradeAuditAdapter,
  type UpgradeAuditFact,
  type UpgradeAuditRpc,
} from "./upgrade-audit.adapter";

const code = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/i);
export const upgradeAuditPayloadSchema = z.strictObject({
  actorId: z.uuid(),
  action: z.string().regex(/^upgrade\.[a-z][a-z._]{0,99}$/),
  outcome: z.enum(["intent", "completed", "failed", "denied", "cancelled"]),
  metadata: z.strictObject({
    runId: z.uuid().optional(),
    requestId: z.uuid().optional(),
    version: z.number().int().nonnegative().optional(),
    reasonCode: code.optional(),
    stage: code.optional(),
    state: code.optional(),
    status: code.optional(),
    outcome: code.optional(),
    verified: z.boolean().optional(),
    count: z.number().int().nonnegative().optional(),
  }),
});
const localEndpoint = z.url().refine((value) => {
  const url = new URL(value);
  return (
    ["http:", "https:"].includes(url.protocol) &&
    ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.pathname === "/"
  );
}, "Private fixed audit origin required");
export const upgradeAuditRuntimeConfigurationSchema = z.strictObject({
  endpoint: localEndpoint,
  projectApiKey: z.string().min(1).max(16384),
  credentialPath: z.string().startsWith("/").max(4096),
});
export type UpgradeAuditRuntimeConfiguration = z.output<
  typeof upgradeAuditRuntimeConfigurationSchema
>;
const receiptSchema = z.strictObject({
  outcome: z.enum(["inserted", "replayed"]),
  audit_id: z.uuid(),
});
const acknowledgement = z.strictObject({
  auditSequence: z.number().int().positive(),
  auditHash: z.string().regex(/^[a-f0-9]{64}$/),
  auditId: z.uuid(),
});
export interface UpgradeAuditRuntime {
  appendPending(
    record: JournalRecord,
  ): Promise<{ outcome: "inserted" | "replayed"; auditId: string }>;
  flush(): Promise<void>;
}
const unavailable = (): never => {
  throw new Error("upgrade_audit_unavailable");
};
const jwtRole = (value: string): unknown =>
  JSON.parse(
    Buffer.from(value.split(".")[1] ?? "", "base64url").toString("utf8"),
  ) as unknown;

/** Host-private credential, fixed loopback RPC and exact authenticated journal projection. */
export async function createUpgradeAuditRuntime(
  input: UpgradeAuditRuntimeConfiguration,
  authority: { readonly journal: Pick<UpgradeHostJournal, "read" | "append"> },
): Promise<UpgradeAuditRuntime> {
  const config = upgradeAuditRuntimeConfigurationSchema.parse(input);
  const file = await open(
    config.credentialPath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  let credential: string;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 16384)
      return unavailable();
    const bytes = Buffer.alloc(16385);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== stat.size || bytesRead > 16384) return unavailable();
    credential = bytes.subarray(0, bytesRead).toString("utf8").trim();
  } finally {
    await file.close();
  }
  z.object({ role: z.literal("service_role") })
    .passthrough()
    .parse(jwtRole(credential));
  if (!config.projectApiKey.startsWith("sb_publishable_"))
    z.object({ role: z.literal("anon") })
      .passthrough()
      .parse(jwtRole(config.projectApiKey));
  const rpc: UpgradeAuditRpc = {
    rpc: async (name, args) => {
      if (name !== "m13_01_append_audit_event") return unavailable();
      try {
        const response = await fetch(
          `${new URL(config.endpoint).origin}/rest/v1/rpc/m13_01_append_audit_event`,
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(5000),
            headers: {
              apikey: config.projectApiKey,
              Authorization: `Bearer ${credential}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(args),
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          return unavailable();
        }
        const data = z
          .array(receiptSchema)
          .length(1)
          .parse(await readBoundedJson(response, 8192));
        return { data, error: null };
      } catch {
        return unavailable();
      }
    },
  };
  const authenticate = async (fact: UpgradeAuditFact) => {
    const durable = (await authority.journal.read()).find(
      (record) => record.sequence === fact.record.sequence,
    );
    if (!durable || !isDeepStrictEqual(durable, fact.record))
      return unavailable();
    const payload = upgradeAuditPayloadSchema.parse(durable.data.audit);
    if (
      !isDeepStrictEqual(payload, {
        actorId: fact.actorId,
        action: fact.action,
        outcome: fact.outcome,
        metadata: fact.metadata,
      })
    )
      return unavailable();
  };
  const adapter = new UpgradeAuditAdapter(rpc, authenticate);
  const appendPending = async (record: JournalRecord) => {
    const payload = upgradeAuditPayloadSchema.parse(record.data.audit);
    return adapter.append({ record, ...payload });
  };
  return {
    appendPending,
    flush: async () => {
      const records = await authority.journal.read();
      const acknowledged = new Set<number>();
      for (const record of records.filter(
        (record) => record.kind === "audit-ack",
      )) {
        const ack = acknowledgement.parse(record.data);
        const source = records.find(
          (candidate) => candidate.sequence === ack.auditSequence,
        );
        if (
          !source ||
          source.runId !== record.runId ||
          source.hash !== ack.auditHash ||
          source.data.audit === undefined
        )
          return unavailable();
        acknowledged.add(ack.auditSequence);
      }
      for (const record of records.filter(
        (record) =>
          record.data.audit !== undefined && !acknowledged.has(record.sequence),
      )) {
        const receipt = await appendPending(record);
        const current = await authority.journal.read();
        await authority.journal.append({
          expectedVersion: current.length,
          runId: record.runId,
          kind: "audit-ack",
          idempotencyKey: `audit-ack:${record.sequence}:${record.hash}`,
          data: {
            auditSequence: record.sequence,
            auditHash: record.hash,
            auditId: receipt.auditId,
          },
        });
      }
    },
  };
}
